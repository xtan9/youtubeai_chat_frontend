import { describe, it, expect, vi, beforeEach } from "vitest";
import { enforceFreeHistoryCap } from "../summarize-cache";

type FakeRow = { id: string; accessed_at: string };

function makeSupabase(opts: {
  rowsBeyondCapacity?: FakeRow[];
  selectError?: { code: string } | null;
  deleteError?: { code: string } | null;
}) {
  const calls: { op: string; payload: unknown }[] = [];
  const select = {
    select(_cols: string) { return select; },
    eq(_c: string, _v: string) { return select; },
    order() { return select; },
    range(start: number, end: number) {
      calls.push({ op: "range", payload: { start, end } });
      return Promise.resolve({
        data: opts.rowsBeyondCapacity ?? [],
        error: opts.selectError ?? null,
      });
    },
  };
  const del = {
    delete() {
      return {
        in: (col: string, ids: string[]) => {
          calls.push({ op: "delete", payload: { col, ids } });
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      };
    },
  };
  return {
    client: { from: (_t: string) => ({ ...select, ...del }) } as unknown as Parameters<typeof enforceFreeHistoryCap>[0],
    calls,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("enforceFreeHistoryCap", () => {
  it("noop when no rows beyond capacity", async () => {
    const { client, calls } = makeSupabase({ rowsBeyondCapacity: [] });
    await enforceFreeHistoryCap(client, "u1", 10);
    expect(calls.find((c) => c.op === "delete")).toBeUndefined();
    expect(calls.find((c) => c.op === "range")).toEqual({
      op: "range",
      payload: { start: 10, end: 109 },
    });
  });

  it("deletes the single oldest row when one is past capacity", async () => {
    const { client, calls } = makeSupabase({
      rowsBeyondCapacity: [{ id: "row-oldest", accessed_at: "2026-04-01T00:00:00Z" }],
    });
    await enforceFreeHistoryCap(client, "u1", 10);
    expect(calls.find((c) => c.op === "delete")?.payload).toEqual({
      col: "id",
      ids: ["row-oldest"],
    });
  });

  it("deletes multiple rows when many are past capacity", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, accessed_at: "2026-01-01T00:00:00Z",
    }));
    const { client, calls } = makeSupabase({ rowsBeyondCapacity: rows });
    await enforceFreeHistoryCap(client, "u1", 10);
    expect(calls.find((c) => c.op === "delete")?.payload).toEqual({
      col: "id", ids: ["r0", "r1", "r2", "r3", "r4"],
    });
  });

  it("logs and returns when SELECT fails (no throw)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = makeSupabase({
      selectError: { code: "42P01" },
    });
    await expect(enforceFreeHistoryCap(client, "u1", 10)).resolves.toBeUndefined();
    expect(calls.find((c) => c.op === "delete")).toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("history-cap query failed"),
      expect.objectContaining({ errorId: "HISTORY_CAP_QUERY_FAIL" }),
    );
  });

  it("logs and returns when DELETE fails (best-effort, no throw)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeSupabase({
      rowsBeyondCapacity: [{ id: "x", accessed_at: "2026-01-01T00:00:00Z" }],
      deleteError: { code: "42501" },
    });
    await expect(enforceFreeHistoryCap(client, "u1", 10)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("history-cap delete failed"),
      expect.objectContaining({ errorId: "HISTORY_CAP_DELETE_FAIL" }),
    );
  });
});
