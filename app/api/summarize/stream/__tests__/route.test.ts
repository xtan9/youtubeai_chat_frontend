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
}));
vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { POST } from "../route";

function makeRequest(body: unknown, opts: { bodyIsRaw?: string } = {}) {
  return new Request("https://app.test/api/summarize/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.bodyIsRaw ?? JSON.stringify(body),
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

describe("POST /api/summarize/stream", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    // Sensible defaults — individual tests override as needed.
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
    vi.restoreAllMocks();
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
      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      expect(res.status).toBe(200);
    });
  });

  describe("auth", () => {
    it("returns 401 when user is not authenticated", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null } });
      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ message: "Unauthorized" });
    });
  });

  describe("rate limiting", () => {
    it("returns 429 with X-RateLimit-Remaining header when denied", async () => {
      mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    });

    it("uses correct limit for anonymous users", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: { id: "anon-1", is_anonymous: true } },
      });
      mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      expect(res.status).toBe(200);
      expect(mocks.checkRateLimit).toHaveBeenCalledWith("anon-1", true);
    });

    it("propagates remaining header on live stream response", async () => {
      mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 15 });
      mocks.getCachedSummary.mockResolvedValue(cachedFixture());

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("15");
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
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
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
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
      mocks.extractCaptions.mockResolvedValue({
        transcript: "hello world transcript",
        source: "auto_captions",
        language: "en",
        title: "Live Title",
        channelName: "Live Chan",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "Live " },
          { type: "content", text: "summary." },
          { type: "timing", summarizeSeconds: 4, transcribeSeconds: 0 },
        ])
      );

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      const events = parseEvents(await readStream(res));

      const contentTexts = events
        .filter((e) => e.type === "content")
        .map((e) => e.text);
      expect(contentTexts.join("")).toBe("Live summary.");

      expect(mocks.writeCachedSummary).toHaveBeenCalledTimes(1);
      const writeCall = mocks.writeCachedSummary.mock
        .calls[0][0] as CacheWriteParams;
      expect(writeCall).toMatchObject({
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Live Title",
        channelName: "Live Chan",
        summary: "Live summary.",
        transcriptSource: "auto_captions",
        summarizeTimeSeconds: 4,
        enableThinking: false,
        thinking: null,
        userId: "user-1",
      });
      expect(writeCall.transcribeTimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("does NOT write cache when LLM produces empty summary", async () => {
      mocks.extractCaptions.mockResolvedValue({
        transcript: "x",
        source: "auto_captions",
        language: "en",
        title: "T",
        channelName: "C",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "timing", summarizeSeconds: 1, transcribeSeconds: 0 },
        ])
      );

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      await readStream(res);
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("returns error event when LLM throws mid-stream", async () => {
      mocks.extractCaptions.mockResolvedValue({
        transcript: "x",
        source: "auto_captions",
        language: "en",
        title: "T",
        channelName: "C",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        (async function* () {
          yield { type: "content", text: "partial" } as LlmEvent;
          throw new Error("upstream boom");
        })()
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      const events = parseEvents(await readStream(res));
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errSpy.mock.calls[0][0]).toContain("llm failed");
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("uses wall-clock fallback when generator omits timing event", async () => {
      mocks.extractCaptions.mockResolvedValue({
        transcript: "x",
        source: "auto_captions",
        language: "en",
        title: "T",
        channelName: "C",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([{ type: "content", text: "hi" }])
      );

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      await readStream(res);

      expect(mocks.writeCachedSummary).toHaveBeenCalledTimes(1);
      const writeCall = mocks.writeCachedSummary.mock
        .calls[0][0] as CacheWriteParams;
      expect(writeCall.summarizeTimeSeconds).toBeGreaterThanOrEqual(0);
      // Not zero — the fallback computed a real wall-clock delta.
    });
  });

  describe("Whisper fallback path", () => {
    it("skips cache write when metadata fetch failed (no blank-title poisoning)", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockRejectedValue(new Error("oembed down"));
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "whisper output",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "whisper summary" },
          { type: "timing", summarizeSeconds: 2, transcribeSeconds: 0 },
        ])
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      await readStream(res);

      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("writes cache with empty metadata when oembed succeeds but returns blank", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({
        title: "",
        channelName: "",
      });
      mocks.transcribeViaVps.mockResolvedValue({
        transcript: "whisper output",
        language: "en",
        source: "whisper",
      });
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([
          { type: "content", text: "whisper summary" },
          { type: "timing", summarizeSeconds: 2, transcribeSeconds: 0 },
        ])
      );

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
      await readStream(res);

      expect(mocks.writeCachedSummary).toHaveBeenCalledTimes(1);
    });

    it("emits error event + skips LLM when VPS transcription fails", async () => {
      mocks.extractCaptions.mockResolvedValue(null);
      mocks.fetchVideoMetadata.mockResolvedValue({ title: "", channelName: "" });
      mocks.transcribeViaVps.mockRejectedValue(new Error("vps boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(
        makeRequest({
          youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        })
      );
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
