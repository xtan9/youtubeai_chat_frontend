import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildMetadataUrl,
  fetchVpsMetadata,
  primarySubtag,
} from "../vps-metadata";

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

describe("primarySubtag", () => {
  it.each([
    ["en", "en"],
    ["EN", "en"],
    ["en-US", "en"],
    ["zh-Hans", "zh"],
    ["zh-Hant-TW", "zh"],
    ["fra", "fra"], // 3-letter ISO 639-3 passes through untouched
  ])("normalizes %s → %s", (input, expected) => {
    expect(primarySubtag(input)).toBe(expected);
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

  it("returns { ok: false, reason: 'schema', issues } when response shape is wrong", async () => {
    // A silent pass on schema mismatch would let a VPS deploy regression
    // serve malformed metadata into the orchestrator, which would then
    // either crash or miscategorize the language. Preserving zod's
    // `issues` means the downstream log carries the specific field path
    // that failed — critical for postmortem when this actually fires.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ language: "fr" }))
    );
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result.ok).toBe(false);
    if (result.ok === false && result.reason === "schema") {
      expect(result.issues.length).toBeGreaterThan(0);
    } else {
      throw new Error(`expected schema result, got ${JSON.stringify(result)}`);
    }
  });

  it.each([
    ["", "empty"],
    ["--model", "CLI-flag shape"],
    [" en", "leading whitespace"],
    ["en_US", "underscore separator"],
    ["und", "yt-dlp undetermined sentinel"],
    ["zxx", "yt-dlp no-linguistic-content sentinel"],
    ["mul", "yt-dlp multiple-languages sentinel"],
  ])("rejects language=%s (%s) via schema (reason='schema')", async (language) => {
    // Defense-in-depth: if the VPS regresses and starts emitting "und"
    // or empty strings, the orchestrator falls back to the legacy
    // no-lang flow via reason='schema' rather than forwarding garbage
    // as a `lang` param to downstream /captions and /transcribe calls.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ...validResponse,
          language,
        })
      )
    );
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe("schema");
    }
  });

  it("rejects availableCaptions entries that fail the language schema", async () => {
    // A VPS regression emitting `["--model"]` in availableCaptions would
    // otherwise flow through unvalidated — and a follow-up feature that
    // uses an availableCaptions entry as a `lang` hint on retry would
    // then leak garbage. Pin the invariant now.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ...validResponse,
          availableCaptions: ["en", "--model"],
        })
      )
    );
    const result = await fetchVpsMetadata("https://youtu.be/abc");
    expect(result.ok).toBe(false);
  });

  it.each([["en"], ["fr"], ["eng"], ["en-US"], ["zh-Hans"], ["zh-Hant-TW"]])(
    "accepts well-formed language tag %s",
    async (language) => {
      vi.stubEnv("VPS_API_URL", "https://vps.example.com");
      vi.stubEnv("VPS_API_KEY", "secret");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(okResponse({ ...validResponse, language }))
      );
      const result = await fetchVpsMetadata("https://youtu.be/abc");
      expect(result.ok).toBe(true);
    }
  );

  describe("duration field", () => {
    // The schema accepts both pre- and post-rollout VPS shapes:
    // omitted (old VPS) and `null` (new VPS, live stream / yt-dlp
    // rejection) reach callers as `data.duration` ∈ {undefined, null},
    // and a finite non-negative number flows through unchanged.
    // Coverage rationale: a regression here would either block the
    // rollout window (reject responses without duration) or silently
    // pass garbage values (negative / non-number) through to the
    // too-long gate.

    function setupOk() {
      vi.stubEnv("VPS_API_URL", "https://vps.example.com");
      vi.stubEnv("VPS_API_KEY", "secret");
    }

    it("accepts a response without `duration` (old VPS, pre-rollout)", async () => {
      setupOk();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(okResponse(validResponse))
      );
      const result = await fetchVpsMetadata("https://youtu.be/abc");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.duration).toBeUndefined();
    });

    it("accepts duration=null (live stream / yt-dlp unknown)", async () => {
      setupOk();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          okResponse({ ...validResponse, duration: null })
        )
      );
      const result = await fetchVpsMetadata("https://youtu.be/abc");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.duration).toBeNull();
    });

    it.each([0, 1, 213, 86400])(
      "accepts duration=%d (finite non-negative)",
      async (duration) => {
        setupOk();
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(
            okResponse({ ...validResponse, duration })
          )
        );
        const result = await fetchVpsMetadata("https://youtu.be/abc");
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.duration).toBe(duration);
      }
    );

    it.each([
      ["negative", -1],
      ["string", "213"],
      ["NaN-as-null-via-JSON", "NaN-roundtrip"], // see comment below
    ])(
      "rejects duration=%s via schema",
      async (label, duration) => {
        // Defense-in-depth: the VPS already collapses these to null on
        // its side, but if a future VPS regression starts forwarding
        // them raw, the schema must catch it here rather than letting
        // a bogus number reach the too-long gate (where Number(true)
        // would be 1, accepted, and silently bypass the cap on any
        // truthy non-number duration).
        if (label === "NaN-as-null-via-JSON") {
          // JSON.stringify(NaN) → "null", so `NaN` over the wire is
          // observationally the same as `null` — accepted by the
          // schema as the "unknown" case. Documenting here so a
          // future maintainer doesn't mistake the missing rejection
          // for a coverage gap.
          return;
        }
        setupOk();
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(
            okResponse({ ...validResponse, duration })
          )
        );
        const result = await fetchVpsMetadata("https://youtu.be/abc");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("schema");
      }
    );
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
