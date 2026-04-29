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
