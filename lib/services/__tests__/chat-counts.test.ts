import { afterEach, describe, expect, it, vi } from "vitest";
import { getChatMessageCounts } from "../chat-counts";

afterEach(() => {
  vi.restoreAllMocks();
});

interface QueryResult {
  readonly data: { video_id: string }[] | null;
  readonly error: { code?: string; message: string } | null;
}

// Builds the same `from(...).select(...).eq(...).in(...)` chain that
// `getChatMessageCounts` walks, returning the configured result when
// awaited. Captures the chain calls so tests can assert filter args.
function makeSupabase(result: QueryResult) {
  const calls: { method: string; args: unknown[] }[] = [];
  function chain(): unknown {
    return new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: QueryResult) => unknown) =>
              Promise.resolve(result).then(resolve);
          }
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return chain();
          };
        },
      },
    );
  }
  return {
    client: { from: vi.fn(() => chain()) },
    calls,
  };
}

describe("getChatMessageCounts", () => {
  it("returns an empty Map (no fetch) when given no video ids", async () => {
    const sb = makeSupabase({ data: [], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counts = await getChatMessageCounts(sb.client as any, "u-1", []);
    expect(counts.size).toBe(0);
    expect(sb.client.from).not.toHaveBeenCalled();
  });

  it("aggregates per-video counts from a single SELECT round-trip", async () => {
    const sb = makeSupabase({
      data: [
        { video_id: "v-1" },
        { video_id: "v-2" },
        { video_id: "v-1" },
        { video_id: "v-1" },
      ],
      error: null,
    });
    const counts = await getChatMessageCounts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb.client as any,
      "u-1",
      ["v-1", "v-2", "v-3"],
    );
    expect(counts.get("v-1")).toBe(3);
    expect(counts.get("v-2")).toBe(1);
    expect(counts.has("v-3")).toBe(false);
    // Verify it issued exactly one query (no per-video fan-out).
    expect(sb.client.from).toHaveBeenCalledTimes(1);
    expect(sb.client.from).toHaveBeenCalledWith("chat_messages");
  });

  it("scopes with eq(user_id) and in(video_id, [...])", async () => {
    const sb = makeSupabase({ data: [], error: null });
    await getChatMessageCounts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb.client as any,
      "u-1",
      ["v-1", "v-2"],
    );
    const eqCall = sb.calls.find((c) => c.method === "eq");
    const inCall = sb.calls.find((c) => c.method === "in");
    expect(eqCall?.args).toEqual(["user_id", "u-1"]);
    expect(inCall?.args).toEqual(["video_id", ["v-1", "v-2"]]);
  });

  it("fails soft (returns empty Map + logs structured breadcrumb) on supabase error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = makeSupabase({
      data: null,
      error: { code: "DB_DOWN", message: "x" },
    });
    const counts = await getChatMessageCounts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb.client as any,
      "u-1",
      ["v-1"],
    );
    expect(counts.size).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      "[chat-counts] getChatMessageCounts failed",
      expect.objectContaining({ errorId: "CHAT_COUNTS_FETCH_FAILED" }),
    );
    errSpy.mockRestore();
  });
});
