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
            return (resolve: (v: ChainResult | undefined) => unknown) =>
              Promise.resolve(state.impl?.(path, args)).then(resolve);
          }
          return (...nextArgs: unknown[]) =>
            buildBuilder([...path, prop], [...args, nextArgs]);
        },
      },
    );
  }
  return {
    setImpl(fn: ChainImpl) {
      state.impl = fn;
    },
    getServiceRoleClient: vi.fn(() => {
      if (!state.client) {
        state.client = {
          from: vi.fn(() => buildBuilder(["from"], [])),
        };
      }
      return state.client;
    }),
    callLlmJson: vi.fn(),
    reset() {
      state.impl = null;
      state.client = null;
    },
  };
});

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/services/llm-client", () => ({
  callLlmJson: mocks.callLlmJson,
}));
vi.mock("server-only", () => ({}));

async function loadFresh() {
  vi.resetModules();
  return await import("../suggested-followups");
}

describe("suggested-followups", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.getServiceRoleClient.mockClear();
    mocks.callLlmJson.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readSuggestedFollowups", () => {
    it("returns the parsed array when the cached row passes schema", async () => {
      mocks.setImpl(() => ({
        data: { suggested_followups: ["q1?", "q2?", "q3?"] },
        error: null,
      }));
      const { readSuggestedFollowups } = await loadFresh();
      const result = await readSuggestedFollowups("video-1");
      expect(result).toEqual(["q1?", "q2?", "q3?"]);
    });

    it("returns null when no row exists", async () => {
      mocks.setImpl(() => ({ data: null, error: null }));
      const { readSuggestedFollowups } = await loadFresh();
      const result = await readSuggestedFollowups("video-1");
      expect(result).toBeNull();
    });

    it("returns null when the column is null", async () => {
      mocks.setImpl(() => ({
        data: { suggested_followups: null },
        error: null,
      }));
      const { readSuggestedFollowups } = await loadFresh();
      const result = await readSuggestedFollowups("video-1");
      expect(result).toBeNull();
    });

    it("returns null and logs when the cached row fails schema (drift fallback)", async () => {
      // Manually-edited row with the wrong shape — should NOT crash the
      // empty state; should resolve to "regenerate".
      mocks.setImpl(() => ({
        data: { suggested_followups: ["only one"] },
        error: null,
      }));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { readSuggestedFollowups } = await loadFresh();
      const result = await readSuggestedFollowups("video-1");
      expect(result).toBeNull();
      expect(errSpy).toHaveBeenCalledWith(
        "[suggested-followups] cached row failed schema",
        expect.objectContaining({ errorId: "FOLLOWUPS_SCHEMA_DRIFT" }),
      );
    });

    it("throws on supabase error", async () => {
      mocks.setImpl(() => ({ data: null, error: { code: "X", message: "boom" } }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { readSuggestedFollowups } = await loadFresh();
      await expect(readSuggestedFollowups("video-1")).rejects.toBeTruthy();
    });
  });

  describe("writeSuggestedFollowups", () => {
    it("returns void on success", async () => {
      mocks.setImpl(() => ({ data: null, error: null }));
      const { writeSuggestedFollowups } = await loadFresh();
      await expect(
        writeSuggestedFollowups("video-1", ["q1?", "q2?", "q3?"]),
      ).resolves.toBeUndefined();
    });

    it("throws on supabase error", async () => {
      mocks.setImpl(() => ({ data: null, error: { code: "X", message: "boom" } }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { writeSuggestedFollowups } = await loadFresh();
      await expect(
        writeSuggestedFollowups("video-1", ["q1?", "q2?", "q3?"]),
      ).rejects.toBeTruthy();
    });
  });

  describe("generateSuggestedFollowups", () => {
    it("parses pure JSON output", async () => {
      mocks.callLlmJson.mockResolvedValue('["q1?","q2?","q3?"]');
      const { generateSuggestedFollowups } = await loadFresh();
      const result = await generateSuggestedFollowups({ summary: "..." });
      expect(result).toEqual(["q1?", "q2?", "q3?"]);
    });

    it("strips ```json fences before parsing", async () => {
      // Some models wrap JSON in fenced blocks despite the prompt.
      mocks.callLlmJson.mockResolvedValue('```json\n["q1?","q2?","q3?"]\n```');
      const { generateSuggestedFollowups } = await loadFresh();
      const result = await generateSuggestedFollowups({ summary: "..." });
      expect(result).toEqual(["q1?", "q2?", "q3?"]);
    });

    it("throws and logs when the model emits non-JSON", async () => {
      mocks.callLlmJson.mockResolvedValue("here are some questions: q1, q2, q3");
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { generateSuggestedFollowups } = await loadFresh();
      await expect(
        generateSuggestedFollowups({ summary: "..." }),
      ).rejects.toThrow(/not JSON/);
    });

    it("throws when the model emits valid JSON but wrong shape (only 2 items)", async () => {
      mocks.callLlmJson.mockResolvedValue('["q1?","q2?"]');
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { generateSuggestedFollowups } = await loadFresh();
      await expect(
        generateSuggestedFollowups({ summary: "..." }),
      ).rejects.toThrow(/failed schema/);
    });
  });
});
