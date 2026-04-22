import { afterEach, describe, it, expect, vi } from "vitest";
import { buildMetadataUrl, fetchVpsMetadata } from "../vps-metadata";

const validResponse = {
  language: "fr",
  title: "Comment apprendre la programmation",
  description: "Une vidéo en français",
  availableCaptions: ["fr", "en", "ar"],
};

function okResponse(body: unknown = validResponse, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("buildMetadataUrl", () => {
  it("builds correct URL from base", () => {
    expect(buildMetadataUrl("https://vps.example.com")).toBe(
      "https://vps.example.com/metadata"
    );
  });

  it("strips trailing slash from base URL", () => {
    expect(buildMetadataUrl("https://vps.example.com/")).toBe(
      "https://vps.example.com/metadata"
    );
  });
});

describe("fetchVpsMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns { ok: false, reason: 'config' } when env vars are missing", async () => {
    // Graceful-degradation contract: missing config must NOT throw — the
    // orchestrator falls back to the legacy no-lang-hint flow. Throwing
    // would break the whole pipeline.
    vi.stubEnv("VPS_API_URL", "");
    vi.stubEnv("VPS_API_KEY", "");
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result).toEqual({ ok: false, reason: "config" });
  });

  it("treats whitespace-only env as missing", async () => {
    vi.stubEnv("VPS_API_URL", "   \n");
    vi.stubEnv("VPS_API_KEY", "\t");
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result).toEqual({ ok: false, reason: "config" });
  });

  it("returns { ok: true, data } on happy path", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result).toEqual({ ok: true, data: validResponse });
  });

  it("posts youtube_url in body and Bearer header on Authorization", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    await fetchVpsMetadata("https://youtu.be/abc");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vps.example.com/metadata");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret"
    );
    expect(init.body).toBe(JSON.stringify({ youtube_url: "https://youtu.be/abc" }));
  });

  it("returns { ok: false, reason: 'non_ok', status } when upstream returns 500", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 }))
    );
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result).toEqual({ ok: false, reason: "non_ok", status: 500 });
  });

  it("returns { ok: false, reason: 'schema' } when response shape is wrong", async () => {
    // A silent pass on schema mismatch would let a VPS deploy regression
    // serve malformed metadata into the orchestrator, which would then
    // either crash or miscategorize the language.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ language: "fr" }))
    );
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result).toEqual({ ok: false, reason: "schema" });
  });

  it("distinguishes caller-initiated aborts from timeout", async () => {
    // The distinction matters because the route's top-level catch-all
    // swallows caller aborts (user closed tab) but logs timeouts (real
    // infra problem).
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      })
    );
    const result = await fetchVpsMetadata(
      "https://youtu.be/abc",
      controller.signal
    );
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("classifies internal timeout as 'timeout', not 'aborted'", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubEnv("VPS_METADATA_TIMEOUT_MS", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise((_, rej) => setTimeout(() => {
          const err = new Error("t");
          err.name = "TimeoutError";
          rej(err);
        }, 5))
      )
    );
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
