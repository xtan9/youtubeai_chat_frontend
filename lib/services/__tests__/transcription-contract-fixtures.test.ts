import { afterEach, describe, expect, it, vi } from "vitest";
import fixturesJson from "../../../test-fixtures/transcription-contract/v1/cases.json";
import {
  CaptionExtractionError,
  extractCaptions,
} from "../caption-extractor";
import { fetchVpsMetadata } from "../vps-metadata";
import {
  transcribeViaVps,
  VpsTranscribeError,
} from "../vps-client";

type WireResponse = {
  status: number;
  body?: unknown;
  raw?: string;
};

type FixtureCase = {
  id: string;
  endpoint: string;
  request: {
    youtube_url?: string;
    lang?: string;
    raw?: string;
    langValues?: string[];
  };
  service?: { response: WireResponse };
  frontend: {
    response: WireResponse;
    legacyResponse?: WireResponse;
    expect: "success" | "null" | "error" | "legacy" | "schema";
  };
};

type ContractFixtures = {
  contractVersion: string;
  owners: { producer: string; consumer: string };
  youtubeUrl: string;
  compatibilityWindow: {
    current: string;
    previous: string;
    policy: string;
    retirement: string;
  };
  cases: FixtureCase[];
};

const fixtures = fixturesJson as unknown as ContractFixtures;

function getCase(id: string): FixtureCase {
  const fixture = fixtures.cases.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing contract fixture: ${id}`);
  return fixture;
}

function responseFor(wire: WireResponse): Response {
  const body = wire.raw ?? JSON.stringify(wire.body);
  return new Response(body, {
    status: wire.status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubVpsEnv() {
  vi.stubEnv("VPS_API_URL", "https://vps.example.com");
  vi.stubEnv("VPS_API_KEY", "fixture-secret");
}

describe("transcription-http/v1 fixture manifest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("declares the reviewed owner and compatibility window", () => {
    expect(fixtures.contractVersion).toBe("transcription-http/v1");
    expect(fixtures.owners).toEqual({
      producer: "xtan9/youtube-ai-service",
      consumer: "xtan9/youtubeai_chat_frontend",
    });
    expect(fixtures.compatibilityWindow.current).toBe("canonical-segments");
    expect(fixtures.compatibilityWindow.previous).toBe("transcript-only");
    expect(fixtures.compatibilityWindow.policy).toContain("Additive");
  });

  it("contains every required contract case", () => {
    const ids = new Set(fixtures.cases.map((fixture) => fixture.id));
    expect(ids).toEqual(
      new Set([
        "caption-success",
        "caption-404",
        "caption-500",
        "transcription-success",
        "transcription-503",
        "metadata-known-duration",
        "metadata-unknown-duration",
        "multilingual-language-tags",
        "legacy-transcript-only",
        "empty-segments",
        "malformed-json",
        "invalid-language-sentinels",
      ])
    );
  });
});

describe("frontend adapters against transcription-http/v1 fixtures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["caption-success", "caption-404", "caption-500"])(
    "handles the %s caption response at the HTTP boundary",
    async (id) => {
      const fixture = getCase(id);
      stubVpsEnv();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockImplementation(() => Promise.resolve(responseFor(fixture.frontend.response)));
      vi.stubGlobal("fetch", fetchMock);

      const result = await extractCaptions(
        fixture.request.youtube_url ?? fixtures.youtubeUrl,
        undefined,
        fixture.request.lang
      ).catch((error: unknown) => error);

      if (fixture.frontend.expect === "success") {
        expect(result).toEqual({
          segments: [
            { text: "Welcome to the lesson.", start: 0, duration: 2.5 },
            { text: "Let's begin.", start: 2.5, duration: 1.5 },
          ],
          source: "auto_captions",
          language: "en",
          title: "Contract fixture",
          channelName: "Fixture Channel",
        });
      } else if (
        fixture.frontend.expect === "null" &&
        fixture.frontend.response.status === 404
      ) {
        expect(result).toBeNull();
      } else {
        expect(result).toBeInstanceOf(CaptionExtractionError);
        expect((result as CaptionExtractionError).status).toBe(500);
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBe(JSON.stringify(fixture.request));
    }
  );

  it.each([
    "transcription-success",
    "transcription-503",
    "legacy-transcript-only",
    "empty-segments",
  ])("handles the %s transcription response at the HTTP boundary", async (id) => {
    const fixture = getCase(id);
    stubVpsEnv();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    if (id === "legacy-transcript-only") {
      expect(fixture.frontend.response).toEqual(fixture.service?.response);
    }
    const wire =
      fixture.frontend.expect === "legacy"
        ? fixture.frontend.legacyResponse ?? fixture.frontend.response
        : fixture.frontend.response;
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(responseFor(wire)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeViaVps(
      fixture.request.youtube_url ?? fixtures.youtubeUrl,
      undefined,
      fixture.request.lang
    ).catch((error: unknown) => error);

    if (fixture.frontend.expect === "success") {
      expect(result).toEqual({
        segments: [
          { text: "Transcription fixture output.", start: 0, duration: 3 },
        ],
        language: "en",
        source: "whisper",
      });
    } else if (fixture.frontend.expect === "legacy") {
      expect(result).toEqual({
        segments: [
          { text: "Legacy compatibility fixture.", start: 0, duration: 0 },
        ],
        language: "auto",
        source: "whisper",
      });
    } else {
      expect(result).toBeInstanceOf(VpsTranscribeError);
      expect((result as VpsTranscribeError).status).toBe(
        fixture.frontend.expect === "schema" ? "schema" : 503
      );
    }

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify(
        fixture.request.lang
          ? { youtube_url: fixture.request.youtube_url, lang: fixture.request.lang }
          : { youtube_url: fixture.request.youtube_url }
      )
    );
  });

  it.each([
    "metadata-known-duration",
    "metadata-unknown-duration",
    "multilingual-language-tags",
  ])("handles the %s metadata response at the HTTP boundary", async (id) => {
    const fixture = getCase(id);
    stubVpsEnv();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(responseFor(fixture.frontend.response)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchVpsMetadata(
      fixture.request.youtube_url ?? fixtures.youtubeUrl
    );

    expect(result).toEqual({
      ok: true,
      data: fixture.frontend.response.body,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({
        youtube_url: fixture.request.youtube_url ?? fixtures.youtubeUrl,
      })
    );
  });

  it("rejects a malformed upstream JSON response using the malformed JSON fixture", async () => {
    const fixture = getCase("malformed-json");
    stubVpsEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(responseFor(fixture.frontend.response))));

    const result = await extractCaptions(
      fixtures.youtubeUrl,
      undefined,
      undefined
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(CaptionExtractionError);
    expect((result as CaptionExtractionError).status).toBe("schema");
    expect(errorSpy).toHaveBeenCalledWith(
      "[caption-extractor] CAPTION_UNEXPECTED_FAILURE",
      expect.objectContaining({ errorClass: "JsonParse" })
    );
  });

  it("rejects every invalid language sentinel before the network call", async () => {
    const fixture = getCase("invalid-language-sentinels");
    const languageValues = fixture.request.langValues ?? [];
    stubVpsEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(() => Promise.resolve(responseFor(fixture.frontend.response)));
    vi.stubGlobal("fetch", fetchMock);

    for (const lang of languageValues) {
      const result = await extractCaptions(
        fixtures.youtubeUrl,
        undefined,
        lang
      ).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(CaptionExtractionError);
      expect((result as CaptionExtractionError).status).toBe("schema");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
