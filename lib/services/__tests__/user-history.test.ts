import { describe, it, expect, vi } from "vitest";
import { getRecentHistory, getHistoryPage } from "../user-history";

type SupabaseLike = {
  from: ReturnType<typeof vi.fn>;
};

function makeSupabase(rows: unknown[], error: unknown = null): SupabaseLike {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return { from: vi.fn().mockReturnValue(builder) };
}

const ROW = {
  created_at: "2026-04-28T12:00:00Z",
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
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      videoId: "v-uuid-1",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      youtubeVideoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelName: "Rick Astley",
      viewedAt: "2026-04-28T12:00:00Z",
    });
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
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows[0].youtubeVideoId).toBeNull();
  });

  it("returns empty array on supabase error and logs", async () => {
    const supabase = makeSupabase(null, { message: "boom" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("filters out rows with no joined video", async () => {
    const supabase = makeSupabase([
      ROW,
      { created_at: "2026-04-28T11:00:00Z", videos: null },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows).toHaveLength(1);
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

  it("returns total and totalPages from count query", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [ROW], total: 53 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result.total).toBe(53);
    expect(result.totalPages).toBe(3);
  });

  it("clamps page<1 to 1", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [], total: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 0, 25);
    expect(supabase.rowsBuilder.range).toHaveBeenCalledWith(0, 24);
    expect(result.totalPages).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it("returns empty result on rows error", async () => {
    const supabase = makeSupabaseForPage({
      rowsData: null,
      rowsError: { message: "boom" },
      total: 10,
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ rows: [], total: 0, totalPages: 0 });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns empty result on count error", async () => {
    const supabase = makeSupabaseForPage({
      rowsData: [ROW],
      total: null,
      countError: { message: "boom" },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result).toEqual({ rows: [], total: 0, totalPages: 0 });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("treats null count as 0", async () => {
    const supabase = makeSupabaseForPage({ rowsData: [], total: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});
