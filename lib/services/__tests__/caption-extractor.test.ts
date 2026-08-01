import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildCaptionsUrl,
  CaptionExtractionError,
  captionErrorId,
  extractCaptions,
} from "../caption-extractor";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildCaptionsUrl", () => {
  it("builds correct URL from base", () => {
    expect(buildCaptionsUrl("https://vps.example.com")).toBe(
      "https://vps.example.com/captions"
    );
  });

  it("strips trailing slash from base URL", () => {
    expect(buildCaptionsUrl("https://vps.example.com/")).toBe(
      "https://vps.example.com/captions"
    );
  });
});

describe("extractCaptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubEnv() {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
  }

  it.each(["not-a-youtube-url", "https://youtu.be/abc"])(
    "rejects an invalid YouTube URL (%s) before making a caption request",
    async (youtubeUrl) => {
      stubEnv();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const error = await extractCaptions(youtubeUrl).catch((err) => err);

      expect(error).toBeInstanceOf(CaptionExtractionError);
      expect(error).toMatchObject({ status: "schema" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("trims whitespace from VPS_API_URL and VPS_API_KEY", async () => {
    vi.stubEnv("VPS_API_URL", "  https://vps.example.com\n");
    vi.stubEnv("VPS_API_KEY", "\tsecret  ");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        segments: [{ text: "t", start: 0, duration: 1 }],
        source: "auto_captions",
        language: "en",
        title: null,
        channelName: null,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vps.example.com/captions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret"
    );
  });

  it("treats whitespace-only VPS env vars as unset (throws 'must be configured')", async () => {
    vi.stubEnv("VPS_API_URL", "  \n  ");
    vi.stubEnv("VPS_API_KEY", "\t");
    await expect(
      extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ).rejects.toThrow(/VPS_API_URL and VPS_API_KEY must be configured/);
  });

  it("throws when required env vars are missing", async () => {
    vi.stubEnv("VPS_API_URL", "");
    vi.stubEnv("VPS_API_KEY", "");
    await expect(
      extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ).rejects.toThrow(/VPS_API_URL and VPS_API_KEY must be configured/);
  });

  it("sends POST to /captions with bearer auth and JSON body", async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        segments: [
          { text: "hello", start: 0, duration: 1 },
          { text: "world", start: 1, duration: 1 },
        ],
        source: "auto_captions",
        language: "en",
        title: "t",
        channelName: "c",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vps.example.com/captions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(
      JSON.stringify({
        youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      })
    );
  });

  it("decodes XML entities in incoming VPS segment text (defense in depth)", async () => {
    // Without this, a single un-decoded `&#39;` from the VPS reaches the
    // cache and the user sees "I&#39;m" verbatim — the bug class this
    // PR addresses. The canonical VPS-side fix decodes too; this site
    // catches anything that slips through (rollout window, hex/decimal
    // entities the library skips, double-encoding).
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [
            { text: "I&#39;m here", start: 0, duration: 1 },
            { text: "Tom &amp; Jerry", start: 1, duration: 1 },
            // Double-encoded: youtube-transcript-plus passes through `&#39;`,
            // VPS-side single decode of `&amp;` leaves us with `&#39;`,
            // this pass takes it home.
            { text: "don&amp;#39;t", start: 2, duration: 1 },
          ],
          source: "auto_captions",
          language: "en",
          title: null,
          channelName: null,
        })
      )
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.segments.map((s) => s.text)).toEqual([
      "I'm here",
      "Tom & Jerry",
      "don't",
    ]);
  });

  it("omits `lang` in the request body when no lang provided (back-compat)", async () => {
    // Existing VPS and consumers rely on the exact pre-PR body shape for
    // lang-less calls. Injecting `lang: undefined` would stringify as
    // `"lang":undefined` which JSON.stringify drops anyway — but this
    // test pins the invariant so a future refactor to `body.lang = lang`
    // (which WOULD stringify when lang is "") can't pass silently.
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        segments: [{ text: "t", start: 0, duration: 1 }],
        source: "auto_captions",
        language: "en",
        title: null,
        channelName: null,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({
        youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      })
    );
  });

  it("forwards `lang` in the request body when provided", async () => {
    // The whole point of the lang param: it must reach the VPS so the
    // specific caption track is selected instead of tracks[0].
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        segments: [{ text: "bonjour", start: 0, duration: 1 }],
        source: "auto_captions",
        language: "en",
        title: null,
        channelName: null,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined,
      "fr"
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({
        youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        lang: "fr",
      })
    );
  });

  it.each([
    ["und", "undetermined sentinel"],
    ["zxx", "non-linguistic sentinel"],
    ["mul", "multiple-languages sentinel"],
    ["mis", "uncoded-languages sentinel"],
    ["en_US", "underscore-separated code"],
    ["--model", "CLI flag"],
  ])("rejects invalid lang=%s (%s) before the network call", async (lang) => {
    stubEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined,
      lang
    ).catch((err) => err);

    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "schema" });
    expect(captionErrorId((error as CaptionExtractionError).status)).toBe(
      "VPS_CAPTIONS_FAILED_SCHEMA"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on 404 (no_captions) without logging", async () => {
    stubEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "no_captions" }, 404))
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws a typed error on 500 instead of triggering paid fallback", async () => {
    stubEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "Internal error" }, 500))
    );
    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({
      status: 500,
      bodyExcerpt: '{"error":"Internal error"}',
    });
    expect(spy).toHaveBeenCalledWith(
      "[caption-extractor] CAPTION_UNEXPECTED_FAILURE",
      expect.objectContaining({
        errorId: "CAPTION_UNEXPECTED_FAILURE",
        status: 500,
      })
    );
  });

  it("throws a typed network error when fetch throws", async () => {
    stubEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down"))
    );
    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "network" });
    expect(spy).toHaveBeenCalledWith(
      "[caption-extractor] CAPTION_UNEXPECTED_FAILURE",
      expect.objectContaining({ errorClass: "TypeError" })
    );
  });

  it("does NOT log when the caller's own signal aborts (intentional teardown)", async () => {
    stubEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const sig = init.signal!;
            sig.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          })
      )
    );
    const promise = extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      controller.signal
    );
    controller.abort();
    const error = await promise.catch((err) => err);
    expect(error).not.toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ name: "AbortError" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces an internal timeout as a typed failure (not as a silent caller-abort)", async () => {
    stubEnv();
    // Internal-timeout aborts must log; only caller-initiated aborts stay
    // silent. 1ms guarantees the timeout fires before the mock fetch resolves.
    vi.stubEnv("VPS_CAPTIONS_TIMEOUT_MS", "1");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const sig = init.signal!;
            if (sig.aborted) {
              reject(sig.reason ?? new Error("aborted"));
              return;
            }
            sig.addEventListener("abort", () => {
              reject(sig.reason ?? new Error("aborted"));
            });
          })
      )
    );

    const callerController = new AbortController();
    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      callerController.signal
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "timeout" });
    // Caller's own signal was NOT aborted — the internal timeout fired.
    // This must log so the on-call alert fires on a stuck VPS.
    expect(callerController.signal.aborted).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      "[caption-extractor] CAPTION_UNEXPECTED_FAILURE",
      expect.objectContaining({ errorId: "CAPTION_UNEXPECTED_FAILURE" })
    );
  });

  it("throws a typed schema error when 200 response body isn't valid JSON", async () => {
    stubEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not json{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "schema" });
    expect(spy).toHaveBeenCalledWith(
      "[caption-extractor] CAPTION_UNEXPECTED_FAILURE",
      expect.objectContaining({ errorClass: "JsonParse" })
    );
  });

  it("surfaces a typed timeout when reading a successful response times out", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(
          new DOMException("response timed out", "TimeoutError")
        ),
      } as unknown as Response)
    );

    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);

    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "timeout" });
  });

  it("throws a typed schema error on schema mismatch", async () => {
    stubEnv();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ transcript: "hi" }, 200))
    );
    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "schema" });
    expect(spy).toHaveBeenCalledWith(
      "[caption-extractor] CAPTION_UNEXPECTED_FAILURE",
      expect.objectContaining({ errorClass: "SchemaMismatch" })
    );
  });

  it("throws a typed schema error when segments array is empty", async () => {
    // An empty 200 response is an invalid provider response, not the
    // documented 404 no_captions result. It must not silently trigger
    // Whisper or reach the LLM as an empty Transcript.
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [],
          source: "auto_captions",
          language: "en",
          title: null,
          channelName: null,
        })
      )
    );
    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);
    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "schema" });
  });

  it.each([
    {
      segments: [{ text: "   ", start: 0, duration: 1 }],
      source: "auto_captions",
      language: "en",
      title: null,
      channelName: null,
    },
    {
      transcript: "   ",
      source: "auto_captions",
      language: "en",
      title: null,
      channelName: null,
    },
    {
      segments: [{ text: "&nbsp;", start: 0, duration: 1 }],
      source: "auto_captions",
      language: "en",
      title: null,
      channelName: null,
    },
  ])("rejects caption responses without visible transcript text", async (body) => {
    stubEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    const error = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((err) => err);

    expect(error).toBeInstanceOf(CaptionExtractionError);
    expect(error).toMatchObject({ status: "schema" });
  });

  it("returns shaped CaptionResult on 200, normalizing null title/channel to empty strings", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [
            { text: "hello", start: 0, duration: 1 },
            { text: "world", start: 1, duration: 1 },
          ],
          source: "auto_captions",
          language: "en",
          title: null,
          channelName: null,
        })
      )
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toEqual({
      segments: [
        { text: "hello", start: 0, duration: 1 },
        { text: "world", start: 1, duration: 1 },
      ],
      source: "auto_captions",
      language: "en",
      title: "",
      channelName: "",
    });
  });

  it("returns shaped CaptionResult with zh language", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [{ text: "你好世界", start: 0, duration: 2 }],
          source: "auto_captions",
          language: "zh",
          title: "标题",
          channelName: "频道",
        })
      )
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.language).toBe("zh");
    expect(result?.title).toBe("标题");
    expect(result?.channelName).toBe("频道");
  });

  it("accepts the legacy `transcript` field alongside segments (rollout window)", async () => {
    // The VPS still emits `transcript` next to `segments` for one rollout
    // window so an old frontend deployment keeps working. The new schema
    // should accept it and ignore — a strict-reject would force lockstep
    // deploys.
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [{ text: "hi", start: 0, duration: 1 }],
          transcript: "hi",
          source: "auto_captions",
          language: "en",
          title: null,
          channelName: null,
        })
      )
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.segments).toEqual([
      { text: "hi", start: 0, duration: 1 },
    ]);
  });

  it("falls back to a single segment when only legacy `transcript` is present (forward-compat)", async () => {
    // Symmetric of the above: when the VPS hasn't deployed the new
    // contract yet, this frontend still works. The synthesized segment
    // gets start=0, duration=0 — a flag that timing data is absent —
    // so the transcript renders as one un-clickable paragraph at 00:00.
    // Same fail-soft behavior as the legacy DB migration backfill.
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          transcript: "legacy hi",
          source: "auto_captions",
          language: "en",
          title: null,
          channelName: null,
        })
      )
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.segments).toEqual([
      { text: "legacy hi", start: 0, duration: 0 },
    ]);
  });

  it("forwards the caller signal to fetch (composed with internal timeout)", async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        segments: [{ text: "t", start: 0, duration: 1 }],
        source: "auto_captions",
        language: "en",
        title: "",
        channelName: "",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      controller.signal
    );

    const initArg = fetchMock.mock.calls[0][1] as RequestInit;
    expect(initArg.signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    expect((initArg.signal as AbortSignal).aborted).toBe(true);
  });

  it("applies VPS_CAPTIONS_TIMEOUT_MS override via AbortSignal.timeout", async () => {
    stubEnv();
    vi.stubEnv("VPS_CAPTIONS_TIMEOUT_MS", "500");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [{ text: "t", start: 0, duration: 1 }],
          source: "auto_captions",
          language: "en",
          title: "",
          channelName: "",
        })
      )
    );
    await extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(timeoutSpy).toHaveBeenCalledWith(500);
  });

  it("falls back to the default timeout when VPS_CAPTIONS_TIMEOUT_MS is missing or non-numeric", async () => {
    stubEnv();
    vi.stubEnv("VPS_CAPTIONS_TIMEOUT_MS", "nonsense");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          segments: [{ text: "t", start: 0, duration: 1 }],
          source: "auto_captions",
          language: "en",
          title: "",
          channelName: "",
        })
      )
    );
    await extractCaptions("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });
});
