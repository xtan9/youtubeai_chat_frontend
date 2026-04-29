import type { SupabaseClient } from "@supabase/supabase-js";
import { extractVideoId } from "./youtube-url";

export type HistoryRow = {
  videoId: string;
  youtubeUrl: string;
  youtubeVideoId: string | null;
  title: string | null;
  channelName: string | null;
  viewedAt: string;
};

type RawRow = {
  created_at: string;
  videos: {
    id: string;
    youtube_url: string;
    title: string | null;
    channel_name: string | null;
  } | null;
};

const VIDEO_SELECT =
  "created_at, videos!inner (id, youtube_url, title, channel_name)";

function mapRow(raw: RawRow): HistoryRow | null {
  if (!raw.videos) return null;
  return {
    videoId: raw.videos.id,
    youtubeUrl: raw.videos.youtube_url,
    youtubeVideoId: extractVideoId(raw.videos.youtube_url),
    title: raw.videos.title,
    channelName: raw.videos.channel_name,
    viewedAt: raw.created_at,
  };
}

export async function getRecentHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  limit: number = 10,
): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from("user_video_history")
    .select(VIDEO_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  if (error) {
    console.error("getRecentHistory failed", error);
    return [];
  }

  return ((data as RawRow[] | null) ?? [])
    .map(mapRow)
    .filter((r): r is HistoryRow => r !== null);
}

export async function getHistoryPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  page: number,
  perPage: number = 25,
): Promise<{ rows: HistoryRow[]; total: number; totalPages: number }> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const offset = (safePage - 1) * perPage;

  const [rowsResult, countResult] = await Promise.all([
    supabase
      .from("user_video_history")
      .select(VIDEO_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + perPage - 1),
    supabase
      .from("user_video_history")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  if (rowsResult.error) {
    console.error("getHistoryPage rows failed", rowsResult.error);
    return { rows: [], total: 0, totalPages: 0 };
  }
  if (countResult.error) {
    console.error("getHistoryPage count failed", countResult.error);
    return { rows: [], total: 0, totalPages: 0 };
  }

  const rows = ((rowsResult.data as RawRow[] | null) ?? [])
    .map(mapRow)
    .filter((r): r is HistoryRow => r !== null);
  const total = countResult.count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);

  return { rows, total, totalPages };
}
