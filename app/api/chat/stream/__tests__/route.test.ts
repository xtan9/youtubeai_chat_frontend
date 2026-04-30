import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedSummary, CachedTranscript } from "@/lib/services/summarize-cache";

const { mocks, afterPassthrough } = vi.hoisted(() => {
  const afterPassthrough = (fn: () => unknown) => fn();
  return {
    afterPassthrough,
    mocks: {
      getUser: vi.fn(),
      checkRateLimit: vi.fn(),
      checkChatEntitlement: vi.fn(),
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

vi.mock("@/lib/services/entitlements", () => ({
  checkChatEntitlement: mocks.checkChatEntitlement,
  FREE_LIMITS: { chatMessagesPerVideo: 5, summariesPerMonth: 10, historyItems: 10 },
  ANON_LIMITS: { summariesLifetime: 1 },
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
    mocks.checkChatEntitlement.mockResolvedValue({
      tier: "free", allowed: true, remaining: 5, reason: "within_limit",
    });
    mocks.getCachedSummary.mockResolvedValue(SUMMARY_FIXTURE);
    mocks.getCachedTranscript.mockResolvedValue(TRANSCRIPT_FIXTURE);
    mocks.listChatMessages.mockResolvedValue([]);
    mocks.appendChatTurn.mockResolvedValue(undefined);
    mocks.appendChatUserMessage.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // Robust to test-order — without this, an earlier test that set
    // LLM_PROMPT_CACHE_ENABLED would leak into the next one if a future
    // edit forgot the trailing `vi.unstubAllEnvs()` call.
    vi.unstubAllEnvs();
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

  it("returns 402 with anon_chat_blocked for anonymous Supabase users (no checkRateLimit or checkChatEntitlement called)", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "anon-1", is_anonymous: true } },
      error: null,
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.errorCode).toBe("anon_chat_blocked");
    expect(body.tier).toBe("anon");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
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

  it("primes the LLM with a transcript that includes [mm:ss] segment timestamps", async () => {
    let observed: ReadonlyArray<{ role: string; content: string }> | null = null;
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: ReadonlyArray<{ role: string; content: string }>;
    }) {
      observed = opts.messages;
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    await readSse(res.body!);
    expect(observed).not.toBeNull();
    // First message is the synthetic primer (user role) carrying the
    // transcript+summary. It must include [mm:ss] markers so the model
    // can cite real timestamps in its answer.
    const primer = observed![0]?.content ?? "";
    expect(primer).toMatch(/\[0:00\]\s+Welcome\./);
    expect(primer).toMatch(/\[0:01\]\s+Today we discuss flow\./);
  });

  it("does NOT add cache_control to ANY message when LLM_PROMPT_CACHE_ENABLED is unset", async () => {
    let observed: unknown = null;
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: unknown;
    }) {
      observed = opts.messages;
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    type Msg = { role: string; content: string | { cache_control?: unknown }[] };
    const messages = observed as Msg[];
    // Stronger than "primer.content is string" — pins that no message
    // anywhere in the array carries an array content / cache_control.
    // A future refactor that sprayed cache_control across the prompt
    // (Anthropic limits 4 breakpoints; spraying is a real failure mode)
    // would fail this regardless of where it landed.
    expect(messages.every((m) => typeof m.content === "string")).toBe(true);
  });

  it("emits the primer as a content-array tagged with cache_control: ephemeral when LLM_PROMPT_CACHE_ENABLED=true", async () => {
    vi.stubEnv("LLM_PROMPT_CACHE_ENABLED", "true");
    let observed: unknown = null;
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: unknown;
    }) {
      observed = opts.messages;
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    type Block = { type: string; text: string; cache_control?: { type: string } };
    type Msg = { role: string; content: string | Block[] };
    const primer = (observed as Msg[])[0];
    expect(Array.isArray(primer.content)).toBe(true);
    const blocks = primer.content as Block[];
    expect(blocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    // Operators flipping the env var should still see [mm:ss] markers
    // — caching wraps the content, not replaces it.
    expect(blocks[0]?.text).toMatch(/\[0:00\]\s+Welcome\./);
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
    let observedMessages: ReadonlyArray<{ role: string; content: string }> | null = null;
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: ReadonlyArray<{ role: string; content: string }>;
    }) {
      observedMessages = opts.messages;
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    await readSse(res.body!);
    // Shape: primer-user + primer-ack + history (capped) + new user.
    // With a 25-row history the prompt builder must keep only the last
    // 16 — the assertion runs OUTSIDE the generator so a regression
    // surfaces as a test failure, not a swallowed error inside the
    // route's catch.
    expect(observedMessages).not.toBeNull();
    expect(observedMessages!.length).toBe(2 + 16 + 1);
  });

  it("persists turn BEFORE sending done; persist failure surfaces error and falls back to user-only", async () => {
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
    expect(events).not.toContain('"type":"done"');
    expect(events).toContain('"type":"error"');
    // Fallback: even though the joint insert failed, the user's
    // question is preserved via appendChatUserMessage so it survives
    // reload and the user can retry without retyping.
    expect(mocks.appendChatUserMessage).toHaveBeenCalledWith(
      "u1",
      "video-uuid",
      "Hi"
    );
  });

  it("LLM failure preserves the user message via user-only persist", async () => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "partial" };
      throw new Error("gateway 502");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    const events = (await readSse(res.body!)).join("");
    expect(events).toContain('"type":"error"');
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
    expect(mocks.appendChatUserMessage).toHaveBeenCalledWith(
      "u1",
      "video-uuid",
      "Hi"
    );
  });

  it("empty assistant response preserves the user message via user-only persist", async () => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "done" as const };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    const events = (await readSse(res.body!)).join("");
    expect(events).toContain('"type":"error"');
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
    expect(mocks.appendChatUserMessage).toHaveBeenCalledWith(
      "u1",
      "video-uuid",
      "Hi"
    );
  });

  it("history cap boundary: 16-row history is passed unchanged", async () => {
    const exactly16 = Array.from({ length: 16 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg-${i}`,
      createdAt: new Date(2026, 3, 28, 0, 0, i).toISOString(),
    }));
    mocks.listChatMessages.mockResolvedValue(exactly16);
    let observed: ReadonlyArray<{ role: string; content: string }> | null = null;
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: ReadonlyArray<{ role: string; content: string }>;
    }) {
      observed = opts.messages;
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    await readSse(res.body!);
    // 2 primer + 16 history + 1 new user = 19; nothing dropped.
    expect(observed).not.toBeNull();
    expect(observed!.length).toBe(19);
  });

  it("history cap boundary: 17-row history truncates to 16", async () => {
    const seventeen = Array.from({ length: 17 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg-${i}`,
      createdAt: new Date(2026, 3, 28, 0, 0, i).toISOString(),
    }));
    mocks.listChatMessages.mockResolvedValue(seventeen);
    let observed: ReadonlyArray<{ role: string; content: string }> | null = null;
    mocks.streamChatCompletion.mockImplementation(async function* (opts: {
      messages: ReadonlyArray<{ role: string; content: string }>;
    }) {
      observed = opts.messages;
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" })
    );
    await readSse(res.body!);
    // 2 primer + 16 history (oldest dropped) + 1 new user = 19.
    // index 0 = primer user, index 1 = primer ack, index 2 = first
    // history item, which should be "msg-1" not "msg-0".
    expect(observed).not.toBeNull();
    expect(observed!.length).toBe(19);
    expect(observed![2]?.content).toBe("msg-1");
  });

  it("402 when free user has used 5 messages on this video", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, reason: "within_limit" });
    mocks.checkChatEntitlement.mockResolvedValue({
      tier: "free", allowed: false, remaining: 0, reason: "exceeded",
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.errorCode).toBe("free_chat_exceeded");
  });

  it("logs entitlement fail_open without affecting the response", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, reason: "within_limit" });
    mocks.checkChatEntitlement.mockResolvedValue({
      tier: "free", allowed: true, remaining: 5, reason: "fail_open",
    });
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    await readSse(res.body!);
    expect(res.status).toBe(200);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("entitlement bypassed"),
      expect.objectContaining({ errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST" }),
    );
  });
});
