import { describe, it, expect, vi } from "vitest";
import { getRecentHistory } from "../user-history";

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
