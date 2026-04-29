import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChainResult = { data: unknown; error: unknown };
type ChainImpl = (path: string[], args: unknown[]) => ChainResult | Promise<ChainResult>;

const mocks = vi.hoisted(() => {
  const state: { impl: ChainImpl | null; client: { from: ReturnType<typeof vi.fn> } | null } = {
    impl: null,
    client: null,
  };
  function buildBuilder(path: string[], args: unknown[]) {
    return new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: ChainResult) => unknown) =>
              Promise.resolve(state.impl?.(path, args)).then(resolve);
          }
          return (...nextArgs: unknown[]) => buildBuilder([...path, prop], [...args, nextArgs]);
        },
      }
    );
  }
  return {
    setImpl(fn: ChainImpl) {
      state.impl = fn;
    },
    getServiceRoleClient: vi.fn(() => {
      if (!state.client) {
        state.client = {
          from: vi.fn((table: string) => buildBuilder([`from(${table})`], [])),
        };
      }
      return state.client;
    }),
    reset() {
      state.impl = null;
      state.client = null;
    },
  };
});

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("server-only", () => ({}));

async function loadFresh() {
  vi.resetModules();
  return await import("../chat-store");
}

describe("chat-store", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.getServiceRoleClient.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listChatMessages", () => {
    it("returns parsed rows in order", async () => {
      mocks.setImpl(() => ({
        data: [
          { id: "m1", role: "user", content: "hi", created_at: "2026-04-28T00:00:00Z" },
          { id: "m2", role: "assistant", content: "hello", created_at: "2026-04-28T00:00:01Z" },
        ],
        error: null,
      }));
      const { listChatMessages } = await loadFresh();
      const result = await listChatMessages("user-1", "video-1");
      expect(result).toEqual([
        { id: "m1", role: "user", content: "hi", createdAt: "2026-04-28T00:00:00Z" },
        { id: "m2", role: "assistant", content: "hello", createdAt: "2026-04-28T00:00:01Z" },
      ]);
    });

    it("drops rows that fail schema validation but keeps valid ones", async () => {
      mocks.setImpl(() => ({
        data: [
          { id: "m1", role: "user", content: "valid", created_at: "2026-04-28T00:00:00Z" },
          { id: "m2", role: "ROGUE_ROLE", content: "drop", created_at: "2026-04-28T00:00:01Z" },
        ],
        error: null,
      }));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { listChatMessages } = await loadFresh();
      const result = await listChatMessages("user-1", "video-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("m1");
      expect(errSpy).toHaveBeenCalled();
    });

    it("throws when service role client is unavailable", async () => {
      mocks.getServiceRoleClient.mockReturnValueOnce(null);
      const { listChatMessages } = await loadFresh();
      await expect(listChatMessages("user-1", "video-1")).rejects.toThrow(
        /service-role client unavailable/i
      );
    });

    it("throws on supabase error", async () => {
      mocks.setImpl(() => ({ data: null, error: { code: "DB_DOWN", message: "x" } }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { listChatMessages } = await loadFresh();
      await expect(listChatMessages("user-1", "video-1")).rejects.toBeTruthy();
    });
  });

  describe("appendChatTurn", () => {
    it("inserts user + assistant rows and returns void", async () => {
      const insertCalls: unknown[] = [];
      mocks.setImpl((path, args) => {
        if (path.some((p) => p.startsWith("insert"))) {
          insertCalls.push(args);
        }
        return { data: null, error: null };
      });
      const { appendChatTurn } = await loadFresh();
      await appendChatTurn({
        userId: "u",
        videoId: "v",
        userMessage: "q",
        assistantMessage: "a",
      });
      expect(insertCalls.length).toBeGreaterThan(0);
    });

    it("throws on supabase error", async () => {
      mocks.setImpl(() => ({ data: null, error: { code: "X", message: "boom" } }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { appendChatTurn } = await loadFresh();
      await expect(
        appendChatTurn({ userId: "u", videoId: "v", userMessage: "q", assistantMessage: "a" })
      ).rejects.toBeTruthy();
    });
  });

  describe("appendChatUserMessage", () => {
    it("inserts a single user row", async () => {
      mocks.setImpl(() => ({ data: null, error: null }));
      const { appendChatUserMessage } = await loadFresh();
      await expect(
        appendChatUserMessage("u", "v", "q")
      ).resolves.toBeUndefined();
    });
  });

  describe("clearChatMessages", () => {
    it("returns void on success", async () => {
      mocks.setImpl(() => ({ data: null, error: null }));
      const { clearChatMessages } = await loadFresh();
      await expect(clearChatMessages("u", "v")).resolves.toBeUndefined();
    });

    it("throws on supabase error", async () => {
      mocks.setImpl(() => ({ data: null, error: { code: "X", message: "boom" } }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { clearChatMessages } = await loadFresh();
      await expect(clearChatMessages("u", "v")).rejects.toBeTruthy();
    });
  });
});
