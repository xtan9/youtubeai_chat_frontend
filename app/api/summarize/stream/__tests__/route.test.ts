import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { LlmEvent } from "@/lib/services/llm-client";
import type {
  CachedSummary,
  CacheWriteParams,
} from "@/lib/services/summarize-cache";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  extractCaptions: vi.fn(),
  transcribeViaVps: vi.fn(),
  fetchVideoMetadata: vi.fn(),
  getCachedSummary: vi.fn(),
  writeCachedSummary: vi.fn(),
  detectLocale: vi.fn(),
  buildSummarizationPrompt: vi.fn(),
  streamLlmSummary: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/services/caption-extractor", () => ({
  extractCaptions: mocks.extractCaptions,
}));
vi.mock("@/lib/services/vps-client", () => ({
  transcribeViaVps: mocks.transcribeViaVps,
}));
vi.mock("@/lib/services/video-metadata", () => ({
  fetchVideoMetadata: mocks.fetchVideoMetadata,
}));
vi.mock("@/lib/services/summarize-cache", () => ({
  getCachedSummary: mocks.getCachedSummary,
  writeCachedSummary: mocks.writeCachedSummary,
}));
vi.mock("@/lib/services/language-detect", () => ({
  detectLocale: mocks.detectLocale,
}));
vi.mock("@/lib/prompts/summarization", () => ({
  buildSummarizationPrompt: mocks.buildSummarizationPrompt,
}));
vi.mock("@/lib/services/llm-client", () => ({
  streamLlmSummary: mocks.streamLlmSummary,
  formatSseEvent: (d: Record<string, unknown>) =>
    `data: ${JSON.stringify(d)}\n\n`,
  DEFAULT_LLM_MODEL: "test-model",
}));
vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { POST } from "../route";

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function makeRequest(
  body: unknown,
  opts: { bodyIsRaw?: string; signal?: AbortSignal } = {}
) {
  return new Request("https://app.test/api/summarize/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.bodyIsRaw ?? JSON.stringify(body),
    signal: opts.signal,
  });
}

async function readStream(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return buf
    .split("\n\n")
    .map((chunk) => chunk.replace(/^data: /, ""))
    .filter(Boolean);
}

function parseEvents(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((l) => JSON.parse(l));
}

async function* fakeGen(events: LlmEvent[]): AsyncGenerator<LlmEvent> {
  for (const e of events) yield e;
}

const CAPTIONS_FIXTURE = {
  transcript: "captioned transcript",
  source: "auto_captions" as const,
  language: "en" as const,
  title: "Live Title",
  channelName: "Live Chan",
};

describe("POST /api/summarize/stream", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1", is_anonymous: false } },
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
    mocks.getCachedSummary.mockResolvedValue(null);
    mocks.detectLocale.mockReturnValue("en");
    mocks.buildSummarizationPrompt.mockReturnValue("PROMPT");
    mocks.writeCachedSummary.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("input validation", () => {
    it("returns 400 on invalid JSON body", async () => {
      const res = await POST(makeRequest(null, { bodyIsRaw: "{notjson" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "Invalid JSON body" });
    });

    it("returns 400 when youtube_url missing", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toMatch(/Invalid request body/);
    });

    it("returns 400 on http:// (non-https)", async () => {
      const res = await POST(
        makeRequest({ youtube_url: "http://youtube.com/watch?v=x" })
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 on non-canonical host", async () => {
      const res = await POST(
        makeRequest({ youtube_url: "https://evil.com/watch?v=x" })
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 on host ambiguity (youtube.com@evil.com)", async () => {
      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com@evil.com/watch?v=x",
        })
      );
      expect(res.status).toBe(400);
    });

    it("accepts https canonical URL", async () => {
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(200);
    });
  });

  describe("auth", () => {
    it("returns 401 when user is not authenticated", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null } });
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ message: "Unauthorized" });
    });

    it("returns 401 when getUser returns a status-400 session error (AuthSessionMissingError shape)", async () => {
      // Supabase's AuthSessionMissingError uses status 400 — treat as
      // unauth, not infra. Escalating to 503 here was a real production bug.
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 400, message: "Auth session missing!" },
      });
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(401);
    });

    it("returns 401 when getUser returns a 401-status error", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 401, message: "no session" },
      });
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(401);
    });

    it("returns 503 when getUser reports a 5xx infra error", async () => {
      // Auth status 400/401/403 = "not logged in"; everything else
      // (including 408/429/5xx/status-less) = infra outage.
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 500, message: "supabase down" },
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        message: "Auth service temporarily unavailable.",
      });
      expect(errSpy).toHaveBeenCalledWith(
        "[summarize/stream] auth failed",
        expect.objectContaining({ stage: "auth", status: 500 })
      );
    });

    it("returns 503 when getUser reports 429 (Supabase JWKS throttled — not a user-auth error)", async () => {
      // Round-10 regression guard: a 429 from Supabase is not "this user
      // is not logged in" — it's infra telling us the auth endpoint is
      // overloaded. Must page, not silently 401.
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 429, message: "too many requests" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(503);
    });

    it("returns 503 when getUser reports 408 request-timeout", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 408, message: "auth request timeout" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(503);
    });

    it("returns 401 when getUser reports 403 (forbidden - still a client-side auth result)", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 403, message: "forbidden" },
      });
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(401);
    });

    it("returns 503 when getUser error has no status (unreachable Supabase)", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "network down" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(503);
    });

    it("returns 503 when getUser throws (network failure reaching Supabase)", async () => {
      mocks.getUser.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(503);
      expect(errSpy).toHaveBeenCalledWith(
        "[summarize/stream] auth threw",
        expect.objectContaining({ stage: "auth" })
      );
    });
  });

  describe("rate limiting", () => {
    it("returns 429 with X-RateLimit-Remaining header when denied", async () => {
      mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(429);
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    });

    it("uses correct limit for anonymous users", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: "anon-1", is_anonymous: true } },
      });
      mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.status).toBe(200);
      expect(mocks.checkRateLimit).toHaveBeenCalledWith("anon-1", true);
    });

    it("propagates remaining header on live stream response", async () => {
      mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 15 });
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("15");
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("does NOT expose the rate-limit reason as a response header", async () => {
      // Exposing fail_open to clients tells abusers exactly when our
      // abuse wall is down. Keep the distinction server-internal.
      mocks.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 10,
        reason: "fail_open",
      });
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(res.headers.get("X-RateLimit-Mode")).toBeNull();
    });

    it("logs RATE_LIMIT_FAIL_OPEN_REQUEST at route layer on fail-open path", async () => {
      mocks.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 30,
        reason: "fail_open",
      });
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await POST(makeRequest({ youtube_url: VALID_URL }));
      expect(errSpy).toHaveBeenCalledWith(
        "[summarize/stream] rate-limit bypassed (fail-open)",
        expect.objectContaining({
          errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
          userId: "user-1",
          // Dashboards alert per-URL; dropping this from the payload
          // would silently break the signal.
          youtubeUrl: VALID_URL,
        })
      );
    });
  });

  describe("cache hit path", () => {
    it("emits cached stream events in order without calling LLM or VPS", async () => {
      mocks.getCachedSummary.mockResolvedValue(
        cachedFixture({
          title: "Cached Vid",
          channelName: "Cached Chan",
          summary: "Cached summary",
          transcript: "cached tr",
          transcribeTimeSeconds: 2,
          summarizeTimeSeconds: 3,
        })
      );

      const res = await POST(
        makeRequest({
          youtube_url: VALID_URL,
          include_transcript: true,
        })
      );
      const events = parseEvents(await readStream(res));

      expect(events.map((e) => e.type)).toEqual([
        "metadata",
        "content",
        "full_transcript",
        "summary",
      ]);
      expect(events[0]).toMatchObject({ cached: true, title: "Cached Vid" });
      expect(events.at(-1)).toMatchObject({
        total_time: 5,
        summarize_time: 3,
        transcribe_time: 2,
      });

      expect(mocks.extractCaptions).not.toHaveBeenCalled();
      expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
      expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });
  });

  describe("live captions path", () => {
    it("writes cache with separate transcribe/summarize times", async () => {
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "Live " },
          { type: "content", text: "summary." },
          { type: "timing", summarizeSeconds: 4 },
        ])
      );

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      const contentTexts = events
        .filter((e) => e.type === "content")
        .map((e) => e.text);
      expect(contentTexts.join("")).toBe("Live summary.");

      expect(mocks.writeCachedSummary).toHaveBeenCalledTimes(1);
      const writeCall = mocks.writeCachedSummary.mock
        .calls[0][0] as CacheWriteParams;
      expect(writeCall).toMatchObject({
        youtubeUrl: VALID_URL,
        title: "Live Title",
        channelName: "Live Chan",
        summary: "Live summary.",
        transcriptSource: "auto_captions",
        summarizeTimeSeconds: 4,
        enableThinking: false,
        thinking: null,
        userId: "user-1",
      });
    });

    it("emits exactly one terminal summary event on happy path", async () => {
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 2 },
        ])
      );

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      const summaryEvents = events.filter((e) => e.type === "summary");
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0]).toMatchObject({
        summarize_time: 2,
        total_time: expect.any(Number),
        transcribe_time: expect.any(Number),
      });
    });

    it("emits error event + skips cache when LLM produces empty summary", async () => {
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([{ type: "timing", summarizeSeconds: 1 }])
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      expect(events.find((e) => e.type === "error")).toBeDefined();
      expect(events.find((e) => e.type === "summary")).toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("llm failed"),
        expect.objectContaining({ stage: "llm" })
      );
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("emits error event and skips cache when LLM throws mid-stream", async () => {
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        (async function* () {
          yield { type: "content", text: "partial" } as LlmEvent;
          throw new Error("upstream boom");
        })()
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));
      expect(events.find((e) => e.type === "error")).toBeDefined();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("llm failed"),
        expect.objectContaining({ stage: "llm" })
      );
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("uses wall-clock fallback when generator omits timing event", async () => {
      let now = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(async function* () {
        yield { type: "content", text: "hi" };
        // 2500ms of wall-clock elapses between last content and generator end.
        now += 2500;
      });

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      await readStream(res);

      const writeCall = mocks.writeCachedSummary.mock
        .calls[0][0] as CacheWriteParams;
      expect(writeCall.summarizeTimeSeconds).toBe(2.5);
    });

    it("accumulates thinking + content and persists both when enable_thinking is true", async () => {
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "thinking", text: "deep" },
          { type: "thinking", text: " thoughts" },
          { type: "content", text: "result" },
          { type: "timing", summarizeSeconds: 2 },
        ])
      );

      const res = await POST(
        makeRequest({ youtube_url: VALID_URL, enable_thinking: true })
      );
      await readStream(res);

      const writeCall = mocks.writeCachedSummary.mock
        .calls[0][0] as CacheWriteParams;
      expect(writeCall.enableThinking).toBe(true);
      expect(writeCall.thinking).toBe("deep thoughts");
      expect(writeCall.summary).toBe("result");
    });

    it("returns silently on client abort during LLM stream (partial content delivered, no error, no cache)", async () => {
      const controller = new AbortController();
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        (async function* () {
          yield { type: "content", text: "partial" } as LlmEvent;
          // Let the route enqueue the content event before aborting.
          await Promise.resolve();
          controller.abort();
          const abortErr = new Error("aborted");
          abortErr.name = "AbortError";
          throw abortErr;
        })()
      );

      const res = await POST(
        makeRequest({ youtube_url: VALID_URL }, { signal: controller.signal })
      );
      const events = parseEvents(await readStream(res));

      expect(
        events.some((e) => e.type === "content" && e.text === "partial")
      ).toBe(true);
      expect(events.find((e) => e.type === "error")).toBeUndefined();
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });
  });

  describe("Whisper fallback path", () => {
    it("skips cache write when metadata fetch failed (no blank-title poisoning)", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: false,
        reason: "error",
        error: new Error("network down"),
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "whisper output",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "whisper summary" },
          { type: "timing", summarizeSeconds: 2 },
        ])
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      // Stream still emits terminal summary so the client accumulator closes.
      expect(events.at(-1)?.type).toBe("summary");
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("skips cache + logs on oembed timeout (not treated as aborted)", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: false,
        reason: "timeout",
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "w",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 1 },
        ])
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("metadata failed"),
        expect.objectContaining({ stage: "metadata" })
      );
      // Terminal summary still emits so the client accumulator closes.
      expect(events.at(-1)?.type).toBe("summary");
    });

    it("treats a synchronous throw from fetchVideoMetadata as aborted when caller signal fired", async () => {
      // Guards the metadataPromise.catch abort-classification branch —
      // without it, a sync-throw during abort would be logged as a
      // spurious upstream error.
      const controller = new AbortController();
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockImplementation(() => {
        throw new Error("synthetic sync throw");
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "w",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 1 },
        ])
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      controller.abort();
      const res = await POST(
        makeRequest({ youtube_url: VALID_URL }, { signal: controller.signal })
      );
      await readStream(res);

      const metadataLog = errSpy.mock.calls.find((c) =>
        String(c[0]).includes("metadata failed")
      );
      expect(metadataLog).toBeUndefined();
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("logs upstream error when fetchVideoMetadata throws synchronously without caller abort", async () => {
      // The companion to the sync-throw-during-abort case: a real error
      // must still surface when the caller has NOT disconnected.
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockImplementation(() => {
        throw new Error("synthetic sync throw");
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "w",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 1 },
        ])
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      await readStream(res);

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("metadata failed"),
        expect.objectContaining({ stage: "metadata" })
      );
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("skips cache write and logs CACHE_SKIP_EMPTY_HEADER when oembed returns empty title/channel", async () => {
      // Empty title/channel would cache a user-visibly broken row. Skip
      // the write AND log with a stable errorId so a systematic upstream
      // regression is alertable.
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: true,
        data: { title: "", channelName: "" },
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "whisper output",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "whisper summary" },
          { type: "timing", summarizeSeconds: 2 },
        ])
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));
      // Terminal summary still emits so the client accumulator closes.
      expect(events.at(-1)?.type).toBe("summary");
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[summarize/stream] CACHE_SKIP_EMPTY_HEADER",
        expect.objectContaining({
          errorId: "CACHE_SKIP_EMPTY_HEADER",
          source: "whisper",
          hasTitle: false,
          hasChannel: false,
        })
      );
    });

    it("logs CACHE_SKIP_EMPTY_HEADER at error level in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: true,
        data: { title: "only-title", channelName: "" },
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "whisper output",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 1 },
        ])
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      await readStream(res);

      expect(errSpy).toHaveBeenCalledWith(
        "[summarize/stream] CACHE_SKIP_EMPTY_HEADER",
        expect.objectContaining({ errorId: "CACHE_SKIP_EMPTY_HEADER" })
      );
      // Not also logged at warn level — prod uses error OR warn, not both.
      expect(
        warnSpy.mock.calls.some((c) =>
          String(c[0]).includes("CACHE_SKIP_EMPTY_HEADER")
        )
      ).toBe(false);
    });

    it("caches normally when oembed returns populated title/channel", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: true,
        data: { title: "Live Title", channelName: "Live Channel" },
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "whisper output",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "whisper summary" },
          { type: "timing", summarizeSeconds: 2 },
        ])
      );

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      await readStream(res);
      expect(mocks.writeCachedSummary).toHaveBeenCalledTimes(1);
      expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Live Title",
          channelName: "Live Channel",
        })
      );
    });

    it("metadata aborted: no log, and when caller signal is aborted no cache write", async () => {
      // Simulates the race where the caller aborts between LLM completion
      // and the metadata await. Aborted metadata isn't an upstream failure
      // (no log), but we must NOT cache a blank-title row for future hits.
      const controller = new AbortController();
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: false,
        reason: "aborted",
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "w",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 1 },
        ])
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Abort after constructing the request so route.ts sees
      // request.signal.aborted === true at the cache-write check.
      controller.abort();
      const res = await POST(
        makeRequest({ youtube_url: VALID_URL }, { signal: controller.signal })
      );
      await readStream(res);

      const metadataLog = errSpy.mock.calls.find((c) =>
        String(c[0]).includes("metadata failed")
      );
      expect(metadataLog).toBeUndefined();
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("continues normally when cache write fails (logs + no exception propagates)", async () => {
      mocks.extractCaptions.mockResolvedValue(CAPTIONS_FIXTURE);
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "ok" },
          { type: "timing", summarizeSeconds: 1 },
        ])
      );
      mocks.writeCachedSummary.mockRejectedValue(new Error("supabase down"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      // User still got their summary — no error event.
      expect(events.find((e) => e.type === "error")).toBeUndefined();
      expect(events.filter((e) => e.type === "summary")).toHaveLength(1);
      // Wait for microtask-scheduled .catch to log before asserting.
      await Promise.resolve();
      await Promise.resolve();
      expect(
        errSpy.mock.calls.some(
          (c) =>
            String(c[0]).includes("cache failed") &&
            (c[1] as { stage?: string } | undefined)?.stage === "cache"
        )
      ).toBe(true);
    });

    it("emits generic error event when unhandled exception bubbles to outer catch", async () => {
      // getCachedSummary isn't wrapped in an inner try/catch, so a throw
      // here hits the outer catch → logStageError("unknown", err) + error event.
      mocks.getCachedSummary.mockRejectedValue(new Error("supabase explode"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));

      expect(events.find((e) => e.type === "error")).toBeDefined();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("unknown failed"),
        expect.objectContaining({ stage: "unknown" })
      );
    });

    it("emits error event + skips LLM when VPS transcription fails", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        ok: true,
        data: { title: "", channelName: "" },
      });
      mocks.transcribeViaVps.mockRejectedValue(new Error("vps boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ youtube_url: VALID_URL }));
      const events = parseEvents(await readStream(res));
      expect(events.find((e) => e.type === "error")).toBeDefined();
      expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    });
  });
});

function cachedFixture(overrides: Partial<CachedSummary> = {}): CachedSummary {
  return {
    videoId: "v1",
    title: "Cached",
    channelName: "Chan",
    language: "en",
    transcript: "",
    summary: "cached summary",
    transcriptSource: "whisper",
    model: "m",
    processingTimeSeconds: 10,
    transcribeTimeSeconds: 4,
    summarizeTimeSeconds: 6,
    enableThinking: false,
    thinking: null,
    ...overrides,
  } as CachedSummary;
}
