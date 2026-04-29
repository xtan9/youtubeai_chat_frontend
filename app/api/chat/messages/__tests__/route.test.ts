import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getCachedTranscript: vi.fn(),
  listChatMessages: vi.fn(),
  clearChatMessages: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
    }),
}));

vi.mock("@/lib/services/summarize-cache", () => ({
  getCachedTranscript: mocks.getCachedTranscript,
}));

vi.mock("@/lib/services/chat-store", () => ({
  listChatMessages: mocks.listChatMessages,
  clearChatMessages: mocks.clearChatMessages,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function makeReq(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

describe("/api/chat/messages", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } },
      error: null,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET", () => {
    it("returns 400 on missing youtube_url", async () => {
      const { GET } = await import("../route");
      const res = await GET(makeReq("/api/chat/messages"));
      expect(res.status).toBe(400);
    });

    it("returns 401 when no user", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`)
      );
      expect(res.status).toBe(401);
    });

    it("returns empty messages when no transcript yet", async () => {
      mocks.getCachedTranscript.mockResolvedValue(null);
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ messages: [] });
    });

    it("returns the persisted thread", async () => {
      mocks.getCachedTranscript.mockResolvedValue({
        videoId: "video-uuid",
        title: "T",
        channelName: "C",
        segments: [{ text: "x", start: 0, duration: 1 }],
        transcriptSource: "auto_captions",
        language: "en",
      });
      mocks.listChatMessages.mockResolvedValue([
        {
          id: "m1",
          role: "user",
          content: "hi",
          createdAt: "2026-04-28T00:00:00Z",
        },
      ]);
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`)
      );
      const body = await res.json();
      expect(body).toEqual({
        messages: [
          {
            id: "m1",
            role: "user",
            content: "hi",
            createdAt: "2026-04-28T00:00:00Z",
          },
        ],
      });
      expect(mocks.listChatMessages).toHaveBeenCalledWith("u1", "video-uuid");
    });

    it("returns 503 when listing fails", async () => {
      mocks.getCachedTranscript.mockResolvedValue({
        videoId: "video-uuid",
        title: "T",
        channelName: "C",
        segments: [{ text: "x", start: 0, duration: 1 }],
        transcriptSource: "auto_captions",
        language: "en",
      });
      mocks.listChatMessages.mockRejectedValue(new Error("db down"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`)
      );
      expect(res.status).toBe(503);
    });
  });

  describe("DELETE", () => {
    it("returns 401 when no user", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(401);
    });

    it("returns 204 when no transcript yet (idempotent)", async () => {
      mocks.getCachedTranscript.mockResolvedValue(null);
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(204);
    });

    it("clears the thread and returns 204", async () => {
      mocks.getCachedTranscript.mockResolvedValue({
        videoId: "video-uuid",
        title: "T",
        channelName: "C",
        segments: [{ text: "x", start: 0, duration: 1 }],
        transcriptSource: "auto_captions",
        language: "en",
      });
      mocks.clearChatMessages.mockResolvedValue(undefined);
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(204);
      expect(mocks.clearChatMessages).toHaveBeenCalledWith("u1", "video-uuid");
    });

    it("returns 503 when clear fails", async () => {
      mocks.getCachedTranscript.mockResolvedValue({
        videoId: "video-uuid",
        title: "T",
        channelName: "C",
        segments: [{ text: "x", start: 0, duration: 1 }],
        transcriptSource: "auto_captions",
        language: "en",
      });
      mocks.clearChatMessages.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(`/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`, {
          method: "DELETE",
        })
      );
      expect(res.status).toBe(503);
    });
  });
});
