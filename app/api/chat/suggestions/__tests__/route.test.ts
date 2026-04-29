import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getCachedTranscript: vi.fn(),
  getCachedSummary: vi.fn(),
  readSuggestedFollowups: vi.fn(),
  writeSuggestedFollowups: vi.fn(),
  generateSuggestedFollowups: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/services/summarize-cache", () => ({
  getCachedTranscript: mocks.getCachedTranscript,
  getCachedSummary: mocks.getCachedSummary,
}));

vi.mock("@/lib/services/suggested-followups", () => ({
  readSuggestedFollowups: mocks.readSuggestedFollowups,
  writeSuggestedFollowups: mocks.writeSuggestedFollowups,
  generateSuggestedFollowups: mocks.generateSuggestedFollowups,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function makeReq(path: string) {
  return new Request(`http://localhost${path}`);
}

const TRANSCRIPT_FIXTURE = {
  videoId: "video-uuid",
  title: "T",
  channelName: "C",
  segments: [{ text: "x", start: 0, duration: 1 }],
  transcriptSource: "auto_captions" as const,
  language: "en" as const,
};

const SUMMARY_FIXTURE = {
  videoId: "video-uuid",
  title: "T",
  channelName: "C",
  language: "en" as const,
  transcript: "T",
  summary: "Cached summary text.",
  transcriptSource: "auto_captions" as const,
  model: "claude-sonnet-4-6",
  processingTimeSeconds: 1,
  transcribeTimeSeconds: 1,
  summarizeTimeSeconds: 1,
  outputLanguage: null,
};

describe("GET /api/chat/suggestions", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } },
      error: null,
    });
    mocks.getCachedTranscript.mockResolvedValue(TRANSCRIPT_FIXTURE);
    mocks.getCachedSummary.mockResolvedValue(SUMMARY_FIXTURE);
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
  });

  it("returns 401 when no user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(res.status).toBe(401);
  });

  it("returns empty suggestions (200/[]) when no transcript is cached", async () => {
    mocks.getCachedTranscript.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ suggestions: [] });
  });

  it("returns empty suggestions when the user-native summary is missing (translated-only state)", async () => {
    mocks.getCachedSummary.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
    // Native-summary scoping: getCachedSummary called with `null`
    // (the user-native filter), not "any language".
    expect(mocks.getCachedSummary).toHaveBeenCalledWith(VALID_URL, null);
  });

  it("returns the cached suggestions on cache hit (no LLM call, no write)", async () => {
    mocks.readSuggestedFollowups.mockResolvedValue(["a?", "b?", "c?"]);
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(await res.json()).toEqual({ suggestions: ["a?", "b?", "c?"] });
    expect(mocks.generateSuggestedFollowups).not.toHaveBeenCalled();
    expect(mocks.writeSuggestedFollowups).not.toHaveBeenCalled();
  });

  it("generates, persists, and returns when no cached row exists", async () => {
    mocks.readSuggestedFollowups.mockResolvedValue(null);
    mocks.generateSuggestedFollowups.mockResolvedValue(["q1?", "q2?", "q3?"]);
    mocks.writeSuggestedFollowups.mockResolvedValue(undefined);
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(await res.json()).toEqual({ suggestions: ["q1?", "q2?", "q3?"] });
    expect(mocks.generateSuggestedFollowups).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: SUMMARY_FIXTURE.summary,
        // Pin the LLM timeout — without this, a future refactor that
        // drops the option silently exposes the empty state to
        // multi-minute upstream stalls.
        timeoutMs: 12_000,
      }),
    );
    expect(mocks.writeSuggestedFollowups).toHaveBeenCalledWith(
      "video-uuid",
      ["q1?", "q2?", "q3?"],
    );
  });

  it("falls back to empty suggestions (no banner) when generation fails", async () => {
    mocks.readSuggestedFollowups.mockResolvedValue(null);
    mocks.generateSuggestedFollowups.mockRejectedValue(new Error("LLM down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
    // No write should fire on a failed generation — otherwise we'd
    // poison the cache with empty/partial suggestions.
    expect(mocks.writeSuggestedFollowups).not.toHaveBeenCalled();
  });

  it("returns the generated suggestions even when the persist write fails (best-effort cache)", async () => {
    mocks.readSuggestedFollowups.mockResolvedValue(null);
    mocks.generateSuggestedFollowups.mockResolvedValue(["q1?", "q2?", "q3?"]);
    mocks.writeSuggestedFollowups.mockRejectedValue(new Error("DB down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: ["q1?", "q2?", "q3?"] });
  });

  it("falls through to generation when the cache-read throws (transient infra blip)", async () => {
    mocks.readSuggestedFollowups.mockRejectedValue(new Error("transient"));
    mocks.generateSuggestedFollowups.mockResolvedValue(["q1?", "q2?", "q3?"]);
    mocks.writeSuggestedFollowups.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../route");
    const res = await GET(
      makeReq(`/api/chat/suggestions?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: ["q1?", "q2?", "q3?"] });
  });
});
