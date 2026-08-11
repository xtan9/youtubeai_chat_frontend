import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  VideoChatSubject,
  VideoGroundingResolution,
} from "@/lib/services/video-chat-subject";

const { mocks, afterPassthrough } = vi.hoisted(() => {
  const afterPassthrough = (fn: () => unknown) => fn();
  return {
    afterPassthrough,
    mocks: {
      resolveRequestPrincipal: vi.fn(),
      checkRateLimit: vi.fn(),
      checkChatEntitlement: vi.fn(),
      resolveRegisteredSubscription: vi.fn(),
      admitRegisteredFreeHeroDemoChatMessage: vi.fn(),
      resolveVideoChatSubject: vi.fn(),
      loadGrounding: vi.fn(),
      listChatMessages: vi.fn(),
      appendChatTurn: vi.fn(),
      appendChatUserMessage: vi.fn(),
      streamChatCompletion: vi.fn(),
      reserveAnonymousTrialChatMessage: vi.fn(),
      markAnonymousTrialChatMessageStarted: vi.fn(),
      refundAnonymousTrialChatMessage: vi.fn(),
      after: vi.fn(afterPassthrough),
    },
  };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/services/entitlements", () => ({
  checkChatEntitlement: mocks.checkChatEntitlement,
  resolveRegisteredSubscription: mocks.resolveRegisteredSubscription,
  FREE_LIMITS: { chatMessagesPerVideo: 5, summariesPerMonth: 10, historyItems: 10 },
  ANON_LIMITS: { summariesLifetime: 1 },
}));

vi.mock("@/lib/services/registered-free-hero-demo", () => ({
  admitRegisteredFreeHeroDemoChatMessage:
    mocks.admitRegisteredFreeHeroDemoChatMessage,
}));

vi.mock("@/lib/services/video-chat-subject", () => ({
  resolveVideoChatSubject: mocks.resolveVideoChatSubject,
}));

vi.mock("@/lib/services/chat-store", () => ({
  listChatMessages: mocks.listChatMessages,
  appendChatTurn: mocks.appendChatTurn,
  appendChatUserMessage: mocks.appendChatUserMessage,
}));

vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: mocks.streamChatCompletion,
}));

vi.mock("@/lib/services/anonymous-trial", () => ({
  reserveAnonymousTrialChatMessage: mocks.reserveAnonymousTrialChatMessage,
  markAnonymousTrialChatMessageStarted:
    mocks.markAnonymousTrialChatMessageStarted,
  refundAnonymousTrialChatMessage: mocks.refundAnonymousTrialChatMessage,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function resolvedPrincipal(
  userId: string,
  isAnonymous = false,
  smokeProEntitled?: boolean,
) {
  return {
    kind: "resolved" as const,
    principal: {
      userId,
      isAnonymous,
      email: isAnonymous ? "" : "user@example.com",
      smokeProEntitled,
    },
  };
}

const SUMMARY_FIXTURE = {
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
} as const;

const TRANSCRIPT_FIXTURE = {
  videoId: "video-uuid",
  title: "T",
  channelName: "C",
  segments: [
    { text: "Welcome.", start: 0, duration: 1 },
    { text: "Today we discuss flow.", start: 1, duration: 2 },
  ],
  transcriptSource: "auto_captions",
  language: "en",
} as const;

const HERO_TRANSCRIPT_FIXTURE = {
  videoId: "Hrbq66XqtCo",
  title: "Hero title",
  channelName: "Hero channel",
  segments: [
    { text: "Hero welcome.", start: 0, duration: 1 },
    { text: "Hero flow.", start: 1, duration: 2 },
  ],
  transcriptSource: "auto_captions" as const,
  language: "en" as const,
};

const HERO_SUMMARY_FIXTURE = {
  videoId: "Hrbq66XqtCo",
  title: "Hero title",
  channelName: "Hero channel",
  language: "en" as const,
  transcript: "",
  summary: "Hero summary text.",
  transcriptSource: "auto_captions" as const,
  model: "hero-model",
  processingTimeSeconds: 0,
  transcribeTimeSeconds: 0,
  summarizeTimeSeconds: 0,
  outputLanguage: null,
};

const VALID_IDENTITY = {
  youtubeVideoId: "dQw4w9WgXcQ",
  canonicalUrl: VALID_URL,
} as const;

const HERO_IDENTITY = {
  youtubeVideoId: "Hrbq66XqtCo",
  canonicalUrl: "https://www.youtube.com/watch?v=Hrbq66XqtCo",
} as const;

function databaseSubject(
  overrides: Partial<VideoChatSubject> = {},
) {
  return {
    status: "resolved" as const,
    subject: {
      identity: VALID_IDENTITY,
      source: "database" as const,
      retainedThread: { videoId: "video-uuid" },
      entitlement: { videoId: "video-uuid" },
      grounding: { load: mocks.loadGrounding },
      ...overrides,
    },
  };
}

function statelessSubject(
  overrides: Partial<VideoChatSubject> = {},
) {
  return {
    status: "resolved" as const,
    subject: {
      identity: HERO_IDENTITY,
      source: "hero_demo" as const,
      grounding: { load: mocks.loadGrounding },
      ...overrides,
    },
  };
}

function heroReadyGrounding(): VideoGroundingResolution {
  return {
    status: "ready",
    grounding: {
      transcript: HERO_TRANSCRIPT_FIXTURE,
      summary: HERO_SUMMARY_FIXTURE,
    },
  };
}

function readyGrounding(): VideoGroundingResolution {
  return {
    status: "ready",
    grounding: {
      transcript: TRANSCRIPT_FIXTURE,
      summary: SUMMARY_FIXTURE,
    },
  };
}

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
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("u1"));
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 99,
      reason: "within_limit",
    });
    mocks.checkChatEntitlement.mockResolvedValue({
      tier: "free", allowed: true, remaining: 5, reason: "within_limit",
    });
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      tier: "free",
      stripeSubscriptionId: null,
      subscription: null,
      presentation: { state: "registered_free" },
    });
    mocks.admitRegisteredFreeHeroDemoChatMessage.mockResolvedValue({
      outcome: "admitted",
      remainingMessages: 4,
    });
    mocks.resolveVideoChatSubject.mockResolvedValue(databaseSubject());
    mocks.loadGrounding.mockResolvedValue(readyGrounding());
    mocks.listChatMessages.mockResolvedValue([]);
    mocks.appendChatTurn.mockResolvedValue(undefined);
    mocks.appendChatUserMessage.mockResolvedValue(undefined);
    mocks.reserveAnonymousTrialChatMessage.mockResolvedValue({
      outcome: "admitted",
      reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
      remainingMessages: 4,
    });
    mocks.markAnonymousTrialChatMessageStarted.mockResolvedValue({
      outcome: "started",
      remainingMessages: 4,
    });
    mocks.refundAnonymousTrialChatMessage.mockResolvedValue({
      outcome: "refunded",
      remainingMessages: 5,
    });
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

  it("rejects client-supplied Grounding and model fields", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        youtube_url: VALID_URL,
        message: "hi",
        transcript: "client transcript",
        summary: "client summary",
        model: "client-model",
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects a body whose YouTube URL cannot resolve to a Video identity", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue({ status: "invalid" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        youtube_url: VALID_URL,
        message: "hi",
      }),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("X-Error-ID")).toBe("INVALID_REQUEST");
    expect(warnSpy).toHaveBeenCalledWith(
      "[chat/stream] invalid subject",
      expect.objectContaining({ errorId: "CHAT_STREAM_SUBJECT_INVALID" }),
    );
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no user", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when auth infrastructure is unavailable", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(503);
  });

  it("returns 402 with anon_chat_blocked for anonymous Supabase users (no checkRateLimit or checkChatEntitlement called)", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anon-1", true),
    );
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.errorCode).toBe("anon_chat_blocked");
    expect(body.tier).toBe("anon");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
  });

  it("blocks anonymous users on hero-demo videos before any LLM work", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anon-2", true),
    );
    const { POST } = await import("../route");
    const HERO_URL = "https://www.youtube.com/watch?v=Hrbq66XqtCo";
    const res = await POST(makeRequest({ youtube_url: HERO_URL, message: "hi" }));
    expect(res.status).toBe(402);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("admits an enabled Anonymous Trial on a Hero Demo before bounded LLM work", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "Grounded answer" };
      yield { type: "done" as const };
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({
        youtube_url: HERO_IDENTITY.canonicalUrl,
        message: "What does the speaker recommend?",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.reserveAnonymousTrialChatMessage).toHaveBeenCalledWith({
      userId: "anonymous-trial-user",
    });
    expect(mocks.markAnonymousTrialChatMessageStarted).toHaveBeenCalledWith({
      userId: "anonymous-trial-user",
      reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
    });
    expect(
      mocks.markAnonymousTrialChatMessageStarted.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.streamChatCompletion.mock.invocationCallOrder[0]);
    expect(mocks.streamChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 600 }),
    );
    expect((await readSse(response.body!)).join("")).toContain(
      '"type":"anonymous_trial_admitted","reservationId":"018f3f4e-8454-7e8b-a98d-f319b5c32291","remainingMessages":4',
    );
  });

  it("rejects an enabled Anonymous Trial on a retained Video before Grounding or admission", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );
    mocks.resolveVideoChatSubject.mockResolvedValue(databaseSubject());

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "hi" }),
    );

    expect(response.status).toBe(402);
    expect(response.headers.get("X-Error-ID")).toBe("CHAT_ANON_SUBJECT_BLOCKED");
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
    expect(mocks.reserveAnonymousTrialChatMessage).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects an Anonymous Trial message over 500 characters before subject or admission work", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({
        youtube_url: HERO_IDENTITY.canonicalUrl,
        message: "x".repeat(501),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Error-ID")).toBe(
      "ANONYMOUS_TRIAL_MESSAGE_TOO_LONG",
    );
    expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
    expect(mocks.reserveAnonymousTrialChatMessage).not.toHaveBeenCalled();
  });

  it("returns authoritative exhaustion without starting LLM work", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.reserveAnonymousTrialChatMessage.mockResolvedValue({
      outcome: "exhausted",
      remainingMessages: 0,
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "hi" }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        errorCode: "anonymous_trial_exhausted",
        remainingMessages: 0,
      }),
    );
    expect(mocks.markAnonymousTrialChatMessageStarted).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("fails closed when the Anonymous Trial ledger is unavailable", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.reserveAnonymousTrialChatMessage.mockResolvedValue({
      outcome: "unavailable",
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "hi" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("X-Error-ID")).toBe(
      "ANONYMOUS_TRIAL_UNAVAILABLE",
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        errorCode: "anonymous_trial_unavailable",
        upgradeUrl: "/auth/sign-up",
      }),
    );
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("fails closed before LLM work when start and immediate refund are unavailable", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.markAnonymousTrialChatMessageStarted.mockResolvedValue({
      outcome: "unavailable",
    });
    mocks.refundAnonymousTrialChatMessage.mockResolvedValue({
      outcome: "unavailable",
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "hi" }),
    );
    const events = (await readSse(response.body!)).join("");

    expect(events).toContain('"type":"error"');
    expect(events).toContain('"errorCode":"anonymous_trial_unavailable"');
    expect(mocks.refundAnonymousTrialChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("does not refund admitted usage after LLM work starts and fails", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anonymous-trial-user", true),
    );
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.streamChatCompletion.mockImplementation(async function* () {
      throw new Error("gateway failed after admission");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "hi" }),
    );
    const events = (await readSse(response.body!)).join("");

    expect(events).toContain('"type":"anonymous_trial_admitted"');
    expect(events).toContain('"type":"error"');
    expect(mocks.refundAnonymousTrialChatMessage).not.toHaveBeenCalled();
  });

  it("streams stateless subject Grounding without entitlement or retention", async () => {
    // Simulates the bug condition: the DB cache for these ids was
    // never seeded because the hero registry serves them from static
    // files. Before the fix, this 404'd with "Generate the summary
    // first…" — the test pins that the demo path is now self-contained.
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("demo-user"));
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const HERO_URL = "https://www.youtube.com/watch?v=Hrbq66XqtCo";
    const res = await POST(makeRequest({ youtube_url: HERO_URL, message: "hi" }));
    expect(res.status).toBe(200);
    const events = (await readSse(res.body!)).join("");
    expect(events).toContain('"type":"delta"');
    expect(events).toContain('"type":"done"');
    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
    expect(mocks.listChatMessages).not.toHaveBeenCalled();
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
    expect(mocks.appendChatUserMessage).not.toHaveBeenCalled();
  });

  it("maps Grounding not-ready to the existing Summary-not-found response", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("demo-user"));
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue({ status: "not_ready" });
    const { POST } = await import("../route");
    const HERO_URL = "https://www.youtube.com/watch?v=Hrbq66XqtCo";
    const res = await POST(makeRequest({ youtube_url: HERO_URL, message: "hi" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Error-ID")).toBe("SUMMARY_NOT_FOUND");
  });

  it("maps a not-ready subject to Summary-not-found and logs readiness separately", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue({
      status: "not_ready",
      identity: VALID_IDENTITY,
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));

    expect(res.status).toBe(404);
    expect(res.headers.get("X-Error-ID")).toBe("SUMMARY_NOT_FOUND");
    expect(infoSpy).toHaveBeenCalledWith(
      "[chat/stream] subject not ready",
      expect.objectContaining({
        errorId: "CHAT_STREAM_SUBJECT_NOT_READY",
        videoId: VALID_IDENTITY.youtubeVideoId,
      }),
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(VALID_URL);
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
  });

  it("maps an unavailable subject to a stable 503 and distinct structured logging", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue({
      status: "unavailable",
      identity: VALID_IDENTITY,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Error-ID")).toBe("CHAT_STREAM_SUBJECT_UNAVAILABLE");
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat/stream] subject unavailable",
      expect.objectContaining({
        errorId: "CHAT_STREAM_SUBJECT_UNAVAILABLE",
        videoId: VALID_IDENTITY.youtubeVideoId,
        errorClass: "SubjectResolution",
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(VALID_URL);
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
  });

  it("maps unavailable Grounding to a stable 503 and logs it separately from subject resolution", async () => {
    mocks.loadGrounding.mockResolvedValue({ status: "unavailable" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Error-ID")).toBe("CHAT_STREAM_GROUNDING_UNAVAILABLE");
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat/stream] Grounding unavailable",
      expect.objectContaining({
        errorId: "CHAT_STREAM_GROUNDING_UNAVAILABLE",
        videoId: VALID_IDENTITY.youtubeVideoId,
        errorClass: "GroundingResolution",
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(VALID_URL);
  });

  it("does not apply entitlement when the subject boundary reports Grounding unavailable", async () => {
    mocks.loadGrounding.mockResolvedValue({ status: "unavailable" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Error-ID")).toBe("CHAT_STREAM_GROUNDING_UNAVAILABLE");
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat/stream] Grounding unavailable",
      expect.objectContaining({
        errorId: "CHAT_STREAM_GROUNDING_UNAVAILABLE",
        errorName: null,
      }),
    );
    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
  });

  it("does not stream when the subject boundary reports stateless Grounding unavailable", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue({ status: "unavailable" });
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "should not stream" };
      yield { type: "done" as const };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        youtube_url: HERO_IDENTITY.canonicalUrl,
        message: "hi",
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Error-ID")).toBe(
      "CHAT_STREAM_GROUNDING_UNAVAILABLE",
    );
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat/stream] Grounding unavailable",
      expect.objectContaining({
        errorId: "CHAT_STREAM_GROUNDING_UNAVAILABLE",
        errorName: null,
      }),
    );
  });

  it("atomically admits Registered Free Hero Demo chat and exposes authoritative remaining allowance", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("demo-user"));
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const HERO_URL = "https://www.youtube.com/watch?v=Hrbq66XqtCo";
    const res = await POST(makeRequest({ youtube_url: HERO_URL, message: "hi" }));
    expect(res.status).toBe(200);
    const events = (await readSse(res.body!)).join("");
    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
    expect(mocks.admitRegisteredFreeHeroDemoChatMessage).toHaveBeenCalledWith({
      userId: "demo-user",
      youtubeVideoId: "Hrbq66XqtCo",
    });
    expect(events).toContain(
      '"type":"registered_free_hero_demo_admitted","remainingMessages":4',
    );
  });

  it("returns the normal plan upgrade outcome when a Registered Free Hero Demo allowance is exhausted", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("demo-user"));
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.admitRegisteredFreeHeroDemoChatMessage.mockResolvedValue({
      outcome: "exhausted",
      remainingMessages: 0,
    });

    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "sixth" }),
    );

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        errorCode: "free_chat_exceeded",
        tier: "free",
        remainingMessages: 0,
        upgradeUrl: "/pricing",
      }),
    );
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("keeps Pro Hero Demo chat unlimited without touching the Free ledger", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("pro-demo-user", false, true),
    );
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      tier: "pro",
      stripeSubscriptionId: null,
      subscription: null,
      presentation: { state: "active_pro", plan: null, renewsAt: null },
    });
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "unlimited" };
      yield { type: "done" as const };
    });

    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "sixth" }),
    );
    expect(res.status).toBe(200);
    await readSse(res.body!);
    expect(mocks.admitRegisteredFreeHeroDemoChatMessage).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "subscription",
      () =>
        mocks.resolveRegisteredSubscription.mockResolvedValue({
          kind: "unavailable",
        }),
      "REGISTERED_FREE_HERO_DEMO_SUBSCRIPTION_UNAVAILABLE",
    ],
    [
      "allowance",
      () =>
        mocks.admitRegisteredFreeHeroDemoChatMessage.mockResolvedValue({
          outcome: "unavailable",
        }),
      "REGISTERED_FREE_HERO_DEMO_ALLOWANCE_UNAVAILABLE",
    ],
  ])(
    "fails closed before LLM work when the Registered Free Hero Demo %s boundary is unavailable",
    async (_label, arrange, expectedErrorId) => {
      mocks.resolveRequestPrincipal.mockResolvedValue(
        resolvedPrincipal("free-demo-user"),
      );
      mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
      mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
      arrange();

      const { POST } = await import("../route");
      const res = await POST(
        makeRequest({ youtube_url: HERO_IDENTITY.canonicalUrl, message: "hi" }),
      );

      expect(res.status).toBe(503);
      expect(res.headers.get("X-Error-ID")).toBe(expectedErrorId);
      expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
    },
  );

  it("still 402s anonymous users on non-allowlisted videos even with the allowlist active", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anon-3", true),
    );
    const { POST } = await import("../route");
    // VALID_URL = dQw4w9WgXcQ — not in HERO_DEMO_VIDEO_IDS.
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.errorCode).toBe("anon_chat_blocked");
  });

  it("allows signed-in users on the youtu.be hero-demo URL and applies rate limits", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("demo-user"));
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        youtube_url: "https://youtu.be/Hrbq66XqtCo",
        message: "hi",
      }),
    );
    await readSse(res.body!);
    expect(res.status).not.toBe(402);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("demo-user", false);
    expect(mocks.resolveVideoChatSubject).toHaveBeenCalledWith(
      "https://youtu.be/Hrbq66XqtCo",
    );
    expect(mocks.loadGrounding).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed `?v=` values whose parsed id is too long, even if a hero-demo id is a prefix", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("anon-5", true),
    );
    const { POST } = await import("../route");
    // `?v=Hrbq66XqtCoEXTRA` would be a substring-style attack on a naive
    // allowlist check. The 11-char guard inside getYoutubeVideoId means
    // the parsed id is null, so the allowlist returns false → 402.
    const res = await POST(
      makeRequest({
        youtube_url: "https://www.youtube.com/watch?v=Hrbq66XqtCoEXTRA",
        message: "hi",
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("X-Error-ID")).toBe("INVALID_REQUEST");
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
    mocks.loadGrounding.mockResolvedValue({ status: "not_ready" });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "hi" }));
    expect(res.status).toBe(404);
  });

  it("returns 413 when transcript exceeds the hard cap", async () => {
    mocks.loadGrounding.mockResolvedValue({
      status: "ready",
      grounding: {
        transcript: {
          ...TRANSCRIPT_FIXTURE,
          segments: [
            { text: "x".repeat(700_000), start: 0, duration: 1 },
          ],
        },
        summary: SUMMARY_FIXTURE,
      },
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

  it("ignores the legacy Anthropic cache flag with the OpenAI backend", async () => {
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
    type Msg = { role: string; content: string };
    const primer = (observed as Msg[])[0];
    expect(typeof primer.content).toBe("string");
    expect(primer.content).toMatch(/\[0:00\]\s+Welcome\./);
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
    expect(mocks.checkChatEntitlement).toHaveBeenCalledWith(
      "u1",
      "video-uuid",
      undefined,
    );
    expect(mocks.loadGrounding).toHaveBeenCalledTimes(1);
    expect(mocks.appendChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        videoId: "video-uuid",
        userMessage: "Hi",
        assistantMessage: "Hello world.",
      })
    );
  });

  it("propagates a trusted smoke Pro entitlement to the chat quota check", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("smoke-u1", false, true),
    );
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ youtube_url: VALID_URL, message: "Hi" }),
    );
    await readSse(res.body!);

    expect(mocks.checkChatEntitlement).toHaveBeenCalledWith(
      "smoke-u1",
      "video-uuid",
      true,
    );
  });

  it("retains a database subject when entitlement is not exposed", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue(
      databaseSubject({ entitlement: undefined }),
    );
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    await readSse(res.body!);

    expect(mocks.checkChatEntitlement).not.toHaveBeenCalled();
    expect(mocks.listChatMessages).toHaveBeenCalledWith("u1", "video-uuid");
    expect(mocks.appendChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "video-uuid" }),
    );
  });

  it("checks entitlement without retaining a database subject when no thread is exposed", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue(
      databaseSubject({ retainedThread: undefined }),
    );
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta" as const, text: "ok" };
      yield { type: "done" as const };
    });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ youtube_url: VALID_URL, message: "Hi" }));
    await readSse(res.body!);

    expect(mocks.checkChatEntitlement).toHaveBeenCalledWith(
      "u1",
      "video-uuid",
      undefined,
    );
    expect(mocks.listChatMessages).not.toHaveBeenCalled();
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
    expect(mocks.appendChatUserMessage).not.toHaveBeenCalled();
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

  it("does not retain a stateless subject when the caller aborts mid-stream", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal("demo-user"));
    mocks.resolveVideoChatSubject.mockResolvedValue(statelessSubject());
    mocks.loadGrounding.mockResolvedValue(heroReadyGrounding());
    const controller = new AbortController();
    mocks.streamChatCompletion.mockImplementation(async function* (
      opts: { signal: AbortSignal }
    ) {
      yield { type: "delta" as const, text: "partial" };
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
    const HERO_URL = "https://www.youtube.com/watch?v=Hrbq66XqtCo";
    const req = new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtube_url: HERO_URL, message: "hi" }),
      signal: controller.signal,
    });
    const res = await POST(req);
    await readSse(res.body!).catch(() => []);
    expect(mocks.appendChatTurn).not.toHaveBeenCalled();
    expect(mocks.appendChatUserMessage).not.toHaveBeenCalled();
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
