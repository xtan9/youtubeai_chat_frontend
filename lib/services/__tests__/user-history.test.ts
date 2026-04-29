import { describe, it, expect, vi } from "vitest";
import { getRecentHistory, getHistoryPage } from "../user-history";

type SupabaseLike = {
  from: ReturnType<typeof vi.fn>;
};

function makeSupabase(
  rows: unknown[] | null,
  error: unknown = null,
): SupabaseLike {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return { from: vi.fn().mockReturnValue(builder) };
}

const ROW = {
  accessed_at: "2026-04-28T12:00:00Z",
  videos: {
    id: "v-uuid-1",
    youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    channel_name: "Rick Astley",
  },
};

describe("getRecentHistory", () => {
  it("returns mapped rows in shape consumers expect", async () => {
    const supabase = makeSupabase([ROW]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRecentHistory(supabase as any, "u-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      videoId: "v-uuid-1",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      youtubeVideoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelName: "Rick Astley",
      viewedAt: "2026-04-28T12:00:00Z",
    });
  });

  it("filters by the supplied user_id", async () => {
    const supabase = makeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getRecentHistory(supabase as any, "u-42");
    const builder = supabase.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith("user_id", "u-42");
  });

  it("defaults limit to 10", async () => {
    const supabase = makeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getRecentHistory(supabase as any, "u-1");
    const builder = supabase.from.mock.results[0].value;
    expect(builder.range).toHaveBeenCalledWith(0, 9);
  });

  it("honors custom limit", async () => {
    const supabase = makeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getRecentHistory(supabase as any, "u-1", 5);
    const builder = supabase.from.mock.results[0].value;
    expect(builder.range).toHaveBeenCalledWith(0, 4);
  });

  it("returns null youtubeVideoId when URL is malformed", async () => {
    const supabase = makeSupabase([
      { ...ROW, videos: { ...ROW.videos, youtube_url: "not a url" } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRecentHistory(supabase as any, "u-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].youtubeVideoId).toBeNull();
  });

  it("returns ok:false on supabase error and logs", async () => {
    const supabase = makeSupabase(null, { message: "boom", code: "42P01" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRecentHistory(supabase as any, "u-1");
    expect(result).toEqual({ ok: false });
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0]?.[0]).toContain("[user-history]");
    consoleSpy.mockRestore();
  });

  it("filters out rows with no joined video", async () => {
    const supabase = makeSupabase([
      ROW,
      { accessed_at: "2026-04-28T11:00:00Z", videos: null },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getRecentHistory(supabase as any, "u-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
  });
});

type PageMockOptions = {
  rowsData: unknown;
  rowsError?: unknown;
  total: number | null;
  countError?: unknown;
};

function makeSupabaseForPage(opts: PageMockOptions) {
  const rowsBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi
      .fn()
      .mockResolvedValue({ data: opts.rowsData, error: opts.rowsError ?? null }),
  };
  const countBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({
      count: opts.total,
      error: opts.countError ?? null,
    }),
  };
  let callCount = 0;
  const from = vi.fn(() => {
    callCount += 1;
    return callCount === 1 ? rowsBuilder : countBuilder;
  });
  return { from, rowsBuilder, countBuilder };
}

describe("getHistoryPage", () => {
  it("requests range [0, 24] for page 1, perPage 25", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [ROW], total: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(supabase.rowsBuilder.range).toHaveBeenCalledWith(0, 24);
  });

  it("requests range [20, 29] for page 3, perPage 10", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [ROW], total: 25 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getHistoryPage(supabase as any, "u-1", 3, 10);
    expect(supabase.rowsBuilder.range).toHaveBeenCalledWith(20, 29);
  });

  it("filters BOTH the rows query AND the count query by user_id", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [], total: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getHistoryPage(supabase as any, "u-77", 1, 25);
    expect(supabase.rowsBuilder.eq).toHaveBeenCalledWith("user_id", "u-77");
    expect(supabase.countBuilder.eq).toHaveBeenCalledWith("user_id", "u-77");
  });

  it("returns total and totalPages from count query", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [ROW], total: 53 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(53);
    expect(result.totalPages).toBe(3);
  });

  it("returns totalPages=1 when total fits in a single page", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [ROW], total: 5 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    if (!result.ok) throw new Error("expected ok");
    expect(result.totalPages).toBe(1);
  });

  it("clamps page<1 to 1", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [], total: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 0, 25);
    expect(supabase.rowsBuilder.range).toHaveBeenCalledWith(0, 24);
    if (!result.ok) throw new Error("expected ok");
    expect(result.totalPages).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it("page beyond range returns empty rows with correct totalPages", async () => {
    // 10 rows total, perPage 25: only page 1 is valid.
    // Asking for page 99 should fetch range [2450, 2474] (Supabase returns []),
    // total=10, totalPages=1 — caller (the /history page) is responsible for
    // redirecting past-end requests, not the service.
    const supabase = makeSupabaseForPage({ rowsData: [], total: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 99, 25);
    expect(supabase.rowsBuilder.range).toHaveBeenCalledWith(2450, 2474);
    if (!result.ok) throw new Error("expected ok");
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(10);
    expect(result.totalPages).toBe(1);
  });

  it("returns ok:false on rows error", async () => {
    const supabase = makeSupabaseForPage({
      rowsData: null,
      rowsError: { message: "boom", code: "42P01" },
      total: 10,
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ ok: false });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns ok:false on count error", async () => {
    const supabase = makeSupabaseForPage({
      rowsData: [ROW],
      total: null,
      countError: { message: "boom", code: "42P01" },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ ok: false });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns ok:false when the rows query promise rejects (network throw)", async () => {
    const rowsBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockRejectedValue(new Error("network down")),
    };
    const countBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
    };
    let n = 0;
    const supabase = { from: vi.fn(() => (++n === 1 ? rowsBuilder : countBuilder)) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ ok: false });
    // The "rejected" branch has a distinct log message — assert we used it
    // so a regression to Promise.all (which would lose the rejection) fails.
    const rejectedCall = consoleSpy.mock.calls.find((args) =>
      String(args[0]).includes("rows rejected"),
    );
    expect(rejectedCall).toBeDefined();
    consoleSpy.mockRestore();
  });

  it("returns ok:false when the count query promise rejects", async () => {
    const rowsBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [ROW], error: null }),
    };
    const countBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockRejectedValue(new Error("network down")),
    };
    let n = 0;
    const supabase = { from: vi.fn(() => (++n === 1 ? rowsBuilder : countBuilder)) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ ok: false });
    const rejectedCall = consoleSpy.mock.calls.find((args) =>
      String(args[0]).includes("count rejected"),
    );
    expect(rejectedCall).toBeDefined();
    consoleSpy.mockRestore();
  });

  it("logs both errors when rows AND count fail", async () => {
    const supabase = makeSupabaseForPage({
      rowsData: null,
      rowsError: { message: "rows boom", code: "1" },
      total: null,
      countError: { message: "count boom", code: "2" },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ ok: false });
    // Both errors must have been logged so we can diagnose the outage,
    // not just the first one.
    expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    consoleSpy.mockRestore();
  });

  it("treats null count as 0", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [], total: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    if (!result.ok) throw new Error("expected ok");
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});
