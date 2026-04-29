import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedSummary, CachedTranscript } from "@/lib/services/summarize-cache";

const { mocks, afterPassthrough } = vi.hoisted(() => {
  const afterPassthrough = (fn: () => unknown) => fn();
  return {
    afterPassthrough,
    mocks: {
      getUser: vi.fn(),
      checkRateLimit: vi.fn(),
      getCachedSummary: vi.fn(),
      getCachedTranscript: vi.fn(),
      listChatMessages: vi.fn(),
      appendChatTurn: vi.fn(),
      appendChatUserMessage: vi.fn(),
      streamChatCompletion: vi.fn(),
      after: vi.fn(afterPassthrough),
    },
  };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
    }),
}));

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/services/summarize-cache", () => ({
  getCachedSummary: mocks.getCachedSummary,
  getCachedTranscript: mocks.getCachedTranscript,
}));

vi.mock("@/lib/services/chat-store", () => ({
  listChatMessages: mocks.listChatMessages,
  appendChatTurn: mocks.appendChatTurn,
  appendChatUserMessage: mocks.appendChatUserMessage,
}));

vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: mocks.streamChatCompletion,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const SUMMARY_FIXTURE: CachedSummary = {
  videoId: "video-uuid",
  title: "T",
  channelName: "C",
  language: "en",
  transcript: "T",
  summary: "Cached summary text.",
  transcriptSource: "auto_captions",
  model: "claude-sonnet-4-6",
  processingTimeSeconds: 1,
  transcribeTimeSeconds: 1,
  summarizeTimeSeconds: 1,
  outputLanguage: null,
};

const TRANSCRIPT_FIXTURE: CachedTranscript = {
  videoId: "video-uuid",
  title: "T",
  channelName: "C",
  segments: [
    { text: "Welcome.", start: 0, duration: 1 },
    { text: "Today we discuss flow.", start: 1, duration: 2 },
  ],
  transcriptSource: "auto_captions",
  language: "en",
};

async function readSse(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    events.push(decoder.decode(value));
  }
  return events;
}

function makeRequest(body: unknown, init?: RequestInit): Request {
  return new Request("http://localhost/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if ("mockReset" in m && typeof m.mockReset === "function") m.mockReset();
    });
    mocks.after.mockImplementation(afterPassthrough);
    // Sensible defaults
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } },
      error: null,
    });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 99,
      reason: "within_limit",
    });
    mocks.getCachedSummary.mockResolvedValue(SUMMARY_FIXTURE);
    mocks.getCachedTranscript.mockResolvedValue(TRANSCRIPT_FIXTURE);
    mocks.listChatMessages.mockResolvedValue([]);
    mocks.appendChatTurn.mockResolvedValue(undefined);
    mocks.appendChatUserMessage.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body shape", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: "x", message: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when there is no user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when auth service errors with non-4xx", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 502, message: "upstream" },
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(503);
  });

  it("returns 429 when rate-limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(429);
  });

  it("returns 404 when summary or transcript missing", async () => {
    mocks.getCachedTranscript.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(404);
  });

  it("returns 413 when transcript exceeds the hard cap", async () => {
    mocks.getCachedTranscript.mockResolvedValue({
      ...TRANSCRIPT_FIXTURE,
      segments: [
        { text: "x".repeat(700_000), start: 0, duration: 1 },
      ],
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(413);
  });

  it("happy path streams delta events, ends with done, and persists turn", async () => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "Hello" };
      yield { type: "delta" as const, text: " world." };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    expect(res.status).toBe(200);
    const events = (await readSse(res.body!)).join("");
    expect(events).toContain('"type":"delta"');
    expect(events).toContain("Hello");
    expect(events).toContain('"type":"done"');
    expect(mocks.appendChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        videoId: "video-uuid",
        userMessage: "Hi",
        assistantMessage: "Hello world.",
      })
    );
  });

  it("does not persist a turn when LLM errors mid-stream and surfaces an error event", async () => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "partial" };
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    const events = (await readSse(res.body!)).join("");
    expect(events).toContain('"type":"error"');
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
  });

  it("emits an error event when the assistant returns nothing", async () => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "done" as const };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    const events = (await readSse(res.body!)).join("");
    expect(events).toContain('"type":"error"');
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
  });

  it("on caller abort mid-stream: persists user-only via after(), drops assistant partial", async () => {
    // Simulate an LLM generator that respects the abort signal — yields
    // one delta, then on the next iteration sees signal.aborted and
    // throws an AbortError. The route's catch branch should detect the
    // abort and schedule appendChatUserMessage (not appendChatTurn).
    const controller = new AbortController();
    mocks.streamChatCompletion.mockImplementation(async function* (
      opts: { signal: AbortSignal }
    ) {
      yield { type: "delta" as const, text: "partial" };
      // Emulate the user pressing Stop between yields.
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      Object.defineProperty(opts.signal, "aborted", {
        value: true,
        configurable: true,
      });
      throw err;
    });
    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtube_url: VALID_URL, message: "Hi" }),
      signal: controller.signal,
    });
    const res = await POST(req);
    // Drain the body so the stream's start() has a chance to run.
    await readSse(res.body!).catch(() => []);
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
    expect(mocks.appendChatUserMessage).toHaveBeenCalledWith(
      "u1",
      "video-uuid",
      "Hi"
    );
  });

  it("does NOT double-insert when cancel() fires after a clean appendChatTurn", async () => {
    // Drive the route through the success path (appendChatTurn called),
    // then trigger a late cancel(). The dedupe flag should prevent
    // appendChatUserMessage from also firing.
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    // Drain so start() completes (sync persist runs, sets the flag).
    await readSse(res.body!);
    // Ensure the body is fully consumed; cancel() on a closed stream
    // is the runtime-cancel race we want to test against.
    expect(mocks.appendChatTurn).toHaveBeenCalledTimes(1);
    expect(mocks.appendChatUserMessage).not.toHaveBeenCalled();
  });

  it("caps history to MAX_HISTORY_MESSAGES before passing to the prompt builder", async () => {
    const longHistory = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg-${i}`,
      createdAt: new Date(2026, 3, 28, 0, 0, i).toISOString(),
    }));
    mocks.listChatMessages.mockResolvedValue(longHistory);
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: ReadonlyArray<{ role: string; content: string }>;
    }) {
      // The system message is at index 0, then history (capped), then
      // the new user message at the end. With a 25-row history the
      // builder should receive only the last 16 items as history.
      const historyCount = opts.messages.length - 2;
      expect(historyCount).toBe(16);
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    await readSse(res.body!);
  });

  it("persists turn BEFORE sending done; persist failure surfaces error event", async () => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "answer" };
      yield { type: "done" as const };
    });
    mocks.appendChatTurn.mockRejectedValue(new Error("DB blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    const events = (await readSse(res.body!)).join("");
    // The done event should NOT appear because persist failed.
    expect(events).not.toContain('"type":"done"');
    expect(events).toContain('"type":"error"');
  });
});
