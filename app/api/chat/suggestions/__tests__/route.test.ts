import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveVideoChatSubject: vi.fn(),
  loadGrounding: vi.fn(),
  readSuggestionCache: vi.fn(),
  writeSuggestionCache: vi.fn(),
  callLlmJson: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));

// The route-facing application seam is the subject resolver. Its resolved
// subject carries the cache capability and lazy Grounding loader used below.
vi.mock("@/lib/services/video-chat-subject", () => ({
  resolveVideoChatSubject: mocks.resolveVideoChatSubject,
}));

// Generation still crosses the LLM gateway boundary. Keep that external call
// deterministic while exercising the real route and follow-up service.
vi.mock("@/lib/services/llm-client", () => ({
  callLlmJson: mocks.callLlmJson,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const VALID_IDENTITY = {
  youtubeVideoId: "dQw4w9WgXcQ",
  canonicalUrl: VALID_URL,
};
const DATABASE_VIDEO_ID = "video-uuid";

const TRANSCRIPT_FIXTURE = {
  videoId: DATABASE_VIDEO_ID,
  title: "T",
  channelName: "C",
  segments: [{ text: "Transcript", start: 1, duration: 1 }],
  transcriptSource: "auto_captions" as const,
  language: "en" as const,
};

const SUMMARY_FIXTURE = {
  videoId: DATABASE_VIDEO_ID,
  title: "T",
  channelName: "C",
  language: "en" as const,
  transcript: "Transcript",
  summary: "Native summary text.",
  transcriptSource: "auto_captions" as const,
  model: "summary-model",
  processingTimeSeconds: 1,
  transcribeTimeSeconds: 1,
  summarizeTimeSeconds: 1,
  outputLanguage: null,
};

function databaseSubject() {
  return {
    status: "resolved" as const,
    subject: {
      identity: VALID_IDENTITY,
      source: "database" as const,
      retainedThread: { videoId: DATABASE_VIDEO_ID },
      entitlement: { videoId: DATABASE_VIDEO_ID },
      suggestionCache: {
        videoId: DATABASE_VIDEO_ID,
        read: mocks.readSuggestionCache,
        write: mocks.writeSuggestionCache,
      },
      grounding: { load: mocks.loadGrounding },
    },
  };
}

function makeReq(path: string) {
  return new Request(`http://localhost${path}`);
}

function suggestionRequest() {
  return makeReq(
    `/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`,
  );
}

describe("GET /api/chat/suggestions", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } },
      error: null,
    });
    mocks.resolveVideoChatSubject.mockResolvedValue(databaseSubject());
    mocks.loadGrounding.mockResolvedValue({
      status: "ready",
      grounding: {
        transcript: TRANSCRIPT_FIXTURE,
        summary: SUMMARY_FIXTURE,
      },
    });
    mocks.readSuggestionCache.mockResolvedValue(null);
    mocks.writeSuggestionCache.mockResolvedValue(undefined);
    mocks.callLlmJson.mockResolvedValue(
      JSON.stringify(["q1?", "q2?", "q3?"]),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 on missing youtube_url and logs a structured breadcrumb", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(makeReq("/api/chat/suggestions"));

    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledWith(
      "[chat/suggestions] invalid query",
      expect.objectContaining({ errorId: "CHAT_SUGGESTIONS_QUERY_INVALID" }),
    );
    expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
  });

  it("returns 400 when the query has a non-YouTube URL", async () => {
    const { GET } = await import("../route");
    const res = await GET(
      makeReq("/api/chat/suggestions?youtube_url=https%3A%2F%2Fexample.com%2Fv"),
    );

    expect(res.status).toBe(400);
    expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
  });

  it("returns 401 when no user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(res.status).toBe(401);
    expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
  });

  it("returns the cached suggestions without generation or a cache write", async () => {
    mocks.readSuggestionCache.mockResolvedValue(["a?", "b?", "c?"]);
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: ["a?", "b?", "c?"] });
    expect(mocks.loadGrounding).toHaveBeenCalledTimes(1);
    expect(mocks.readSuggestionCache).toHaveBeenCalledTimes(1);
    expect(mocks.callLlmJson).not.toHaveBeenCalled();
    expect(mocks.writeSuggestionCache).not.toHaveBeenCalled();
  });

  it("generates, persists, and returns suggestions on a cache miss", async () => {
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: ["q1?", "q2?", "q3?"] });
    expect(mocks.callLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 12_000,
        prompt: expect.stringContaining(SUMMARY_FIXTURE.summary),
      }),
    );
    expect(mocks.writeSuggestionCache).toHaveBeenCalledWith([
      "q1?",
      "q2?",
      "q3?",
    ]);
  });

  it("returns generated suggestions when the best-effort cache write fails", async () => {
    mocks.writeSuggestionCache.mockRejectedValue(new Error("DB down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: ["q1?", "q2?", "q3?"] });
  });

  it("regenerates after a cache-read failure", async () => {
    mocks.readSuggestionCache.mockRejectedValue(new Error("transient"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: ["q1?", "q2?", "q3?"] });
    expect(mocks.callLlmJson).toHaveBeenCalledTimes(1);
  });

  it("returns the empty response when generation fails", async () => {
    mocks.callLlmJson.mockRejectedValue(new Error("LLM down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(mocks.writeSuggestionCache).not.toHaveBeenCalled();
  });

  it("returns the empty response for a not-ready subject and logs it distinctly", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue({
      status: "not_ready",
      identity: VALID_IDENTITY,
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: [] });
    expect(infoSpy).toHaveBeenCalledWith(
      "[chat/suggestions] subject not ready",
      expect.objectContaining({
        errorId: "CHAT_SUGGESTIONS_SUBJECT_NOT_READY",
        videoId: VALID_IDENTITY.youtubeVideoId,
      }),
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(VALID_URL);
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
  });

  it("returns the empty response for incomplete Grounding and logs not-ready", async () => {
    mocks.loadGrounding.mockResolvedValue({ status: "not_ready" });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: [] });
    expect(infoSpy).toHaveBeenCalledWith(
      "[chat/suggestions] Grounding not ready",
      expect.objectContaining({
        errorId: "CHAT_SUGGESTIONS_GROUNDING_NOT_READY",
        videoId: VALID_IDENTITY.youtubeVideoId,
      }),
    );
    expect(mocks.readSuggestionCache).not.toHaveBeenCalled();
  });

  it("returns the empty response for an unavailable subject and logs it distinctly", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue({
      status: "unavailable",
      identity: VALID_IDENTITY,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: [] });
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat/suggestions] subject unavailable",
      expect.objectContaining({
        errorId: "CHAT_SUGGESTIONS_SUBJECT_UNAVAILABLE",
        videoId: VALID_IDENTITY.youtubeVideoId,
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(VALID_URL);
  });

  it("returns the empty response for unavailable Grounding and logs it distinctly", async () => {
    mocks.loadGrounding.mockResolvedValue({ status: "unavailable" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: [] });
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat/suggestions] Grounding unavailable",
      expect.objectContaining({
        errorId: "CHAT_SUGGESTIONS_GROUNDING_UNAVAILABLE",
        videoId: VALID_IDENTITY.youtubeVideoId,
      }),
    );
    expect(mocks.readSuggestionCache).not.toHaveBeenCalled();
  });

  it("returns the empty response for stateless subjects without loading Grounding", async () => {
    mocks.resolveVideoChatSubject.mockResolvedValue({
      status: "resolved",
      subject: {
        identity: {
          youtubeVideoId: "Hrbq66XqtCo",
          canonicalUrl: "https://www.youtube.com/watch?v=Hrbq66XqtCo",
        },
        source: "hero_demo",
      },
    });
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: [] });
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
    expect(mocks.readSuggestionCache).not.toHaveBeenCalled();
    expect(mocks.callLlmJson).not.toHaveBeenCalled();
  });

  it("returns the empty response when the resolver throws", async () => {
    mocks.resolveVideoChatSubject.mockRejectedValue(new Error("source down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(suggestionRequest());

    expect(await res.json()).toEqual({ suggestions: [] });
    expect(mocks.loadGrounding).not.toHaveBeenCalled();
  });
});
