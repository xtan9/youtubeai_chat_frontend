import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  resolveVideoChatSubject: vi.fn(),
  listChatMessages: vi.fn(),
  clearChatMessages: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/services/video-chat-subject", () => ({
  resolveVideoChatSubject: mocks.resolveVideoChatSubject,
}));

vi.mock("@/lib/services/chat-store", () => ({
  listChatMessages: mocks.listChatMessages,
  clearChatMessages: mocks.clearChatMessages,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const VALID_IDENTITY = {
  youtubeVideoId: "dQw4w9WgXcQ",
  canonicalUrl: VALID_URL,
};
const DATABASE_SUBJECT = {
  status: "resolved",
  subject: {
    identity: VALID_IDENTITY,
    source: "database",
    retainedThread: { videoId: "video-uuid" },
    entitlement: { videoId: "video-uuid" },
    suggestionCache: { videoId: "video-uuid" },
  },
};
const HERO_DEMO_SUBJECT = {
  status: "resolved",
  subject: {
    identity: {
      youtubeVideoId: "Hrbq66XqtCo",
      canonicalUrl: "https://www.youtube.com/watch?v=Hrbq66XqtCo",
    },
    source: "hero_demo",
  },
};
const NOT_READY_SUBJECT = {
  status: "not_ready",
  identity: VALID_IDENTITY,
};
const UNAVAILABLE_SUBJECT = {
  status: "unavailable",
  identity: VALID_IDENTITY,
};

function makeReq(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

describe("/api/chat/messages", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u1",
        isAnonymous: false,
        email: "user@example.com",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET", () => {
    it("returns 400 on missing youtube_url and logs a structured breadcrumb", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(makeReq("/api/chat/messages"));

      expect(res.status).toBe(400);
      expect(warnSpy).toHaveBeenCalledWith(
        "[chat/messages] invalid query (GET)",
        expect.objectContaining({ errorId: "CHAT_MESSAGES_QUERY_INVALID" }),
      );
      expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
    });

    it("returns 401 when no user", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(401);
      expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
    });

    it("accepts a resolved anonymous principal without adding an authorization rule", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue({
        kind: "resolved",
        principal: {
          userId: "anon-1",
          isAnonymous: true,
          email: "",
        },
      });
      mocks.resolveVideoChatSubject.mockResolvedValue(HERO_DEMO_SUBJECT);
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ messages: [] });
    });

    it("returns 400 when the resolver rejects an unresolvable video URL", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue({ status: "invalid" });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "Invalid query" });
      expect(warnSpy).toHaveBeenCalledWith(
        "[chat/messages] invalid subject (GET)",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_SUBJECT_INVALID",
        }),
      );
    });

    it("returns empty messages for a stateless Hero Demo subject", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(HERO_DEMO_SUBJECT);
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ messages: [] });
      expect(infoSpy).toHaveBeenCalledWith(
        "[chat/messages] empty list - no retained thread",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_NO_RETAINED_THREAD",
          reason: "stateless",
        }),
      );
      expect(mocks.listChatMessages).not.toHaveBeenCalled();
    });

    it("returns empty messages for a database subject that is not ready", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(NOT_READY_SUBJECT);
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ messages: [] });
      expect(infoSpy).toHaveBeenCalledWith(
        "[chat/messages] empty list - no retained thread",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_NO_RETAINED_THREAD",
          reason: "not_ready",
        }),
      );
    });

    it("returns the persisted thread through the retained-thread capability", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(DATABASE_SUBJECT);
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
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(await res.json()).toEqual({
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

    it("returns 503 when subject resolution is unavailable", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(UNAVAILABLE_SUBJECT);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        message: "Could not load chat history.",
      });
      expect(errorSpy).toHaveBeenCalledWith(
        "[chat/messages] subject resolution unavailable (GET)",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_SUBJECT_UNAVAILABLE",
          videoId: VALID_IDENTITY.youtubeVideoId,
        }),
      );
    });

    it("returns 503 when auth infrastructure is unavailable", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(503);
    });

    it("returns 503 when listing fails", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(DATABASE_SUBJECT);
      mocks.listChatMessages.mockRejectedValue(new Error("db down"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("../route");
      const res = await GET(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
        ),
      );

      expect(res.status).toBe(503);
    });
  });

  describe("DELETE", () => {
    it("returns 401 when no user", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
          { method: "DELETE" },
        ),
      );

      expect(res.status).toBe(401);
    });

    it("returns 400 on invalid query and logs a structured breadcrumb", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq("/api/chat/messages", { method: "DELETE" }),
      );

      expect(res.status).toBe(400);
      expect(warnSpy).toHaveBeenCalledWith(
        "[chat/messages] invalid query (DELETE)",
        expect.objectContaining({ errorId: "CHAT_MESSAGES_QUERY_INVALID" }),
      );
      expect(mocks.resolveVideoChatSubject).not.toHaveBeenCalled();
    });

    it("returns 204 for a stateless Hero Demo subject (idempotent)", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(HERO_DEMO_SUBJECT);
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
          { method: "DELETE" },
        ),
      );

      expect(res.status).toBe(204);
      expect(infoSpy).toHaveBeenCalledWith(
        "[chat/messages] clear no-op - no retained thread",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_CLEAR_NO_RETAINED_THREAD",
          reason: "stateless",
        }),
      );
      expect(mocks.clearChatMessages).not.toHaveBeenCalled();
    });

    it("returns 204 for a database subject that is not ready (idempotent)", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(NOT_READY_SUBJECT);
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
          { method: "DELETE" },
        ),
      );

      expect(res.status).toBe(204);
      expect(infoSpy).toHaveBeenCalledWith(
        "[chat/messages] clear no-op - no retained thread",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_CLEAR_NO_RETAINED_THREAD",
          reason: "not_ready",
        }),
      );
    });

    it("clears the retained thread and returns 204", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(DATABASE_SUBJECT);
      mocks.clearChatMessages.mockResolvedValue(undefined);
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
          { method: "DELETE" },
        ),
      );

      expect(res.status).toBe(204);
      expect(mocks.clearChatMessages).toHaveBeenCalledWith("u1", "video-uuid");
    });

    it("returns 503 when subject resolution is unavailable", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(UNAVAILABLE_SUBJECT);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
          { method: "DELETE" },
        ),
      );

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        message: "Could not clear chat history.",
      });
      expect(errorSpy).toHaveBeenCalledWith(
        "[chat/messages] subject resolution unavailable (DELETE)",
        expect.objectContaining({
          errorId: "CHAT_MESSAGES_SUBJECT_UNAVAILABLE",
          videoId: VALID_IDENTITY.youtubeVideoId,
        }),
      );
    });

    it("returns 503 when clear fails", async () => {
      mocks.resolveVideoChatSubject.mockResolvedValue(DATABASE_SUBJECT);
      mocks.clearChatMessages.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { DELETE } = await import("../route");
      const res = await DELETE(
        makeReq(
          `/api/chat/messages?youtube_url=${encodeURIComponent(VALID_URL)}`,
          { method: "DELETE" },
        ),
      );

      expect(res.status).toBe(503);
    });
  });
});
