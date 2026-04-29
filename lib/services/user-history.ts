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

// Result types deliberately discriminate "fetched empty" from "fetch failed"
// so the page layer can render the spec-mandated inline error instead of the
// "you haven't summarized any videos yet" empty state — masking a Supabase
// outage as zero history is a high-impact silent failure.
export type RecentHistoryResult =
  | { ok: true; rows: HistoryRow[] }
  | { ok: false };

export type HistoryPageResult =
  | { ok: true; rows: HistoryRow[]; total: number; totalPages: number }
  | { ok: false };

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
): Promise<RecentHistoryResult> {
  const { data, error } = await supabase
    .from("user_video_history")
    .select(VIDEO_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  if (error) {
    console.error("[user-history] getRecentHistory failed", {
      userId,
      limit,
      code: error.code,
      message: error.message,
    });
    return { ok: false };
  }

  const rows = ((data as unknown as RawRow[] | null) ?? [])
    .map(mapRow)
    .filter((r): r is HistoryRow => r !== null);
  return { ok: true, rows };
}

export async function getHistoryPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  page: number,
  perPage: number = 25,
): Promise<HistoryPageResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const offset = (safePage - 1) * perPage;

  // allSettled (not all) so a failure on one query doesn't lose the other's
  // diagnostics — both errors get logged, then we fail closed.
  const [rowsSettled, countSettled] = await Promise.allSettled([
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

  let failed = false;
  if (rowsSettled.status === "rejected") {
    console.error("[user-history] getHistoryPage rows rejected", {
      userId,
      page: safePage,
      perPage,
      reason: rowsSettled.reason,
    });
    failed = true;
  } else if (rowsSettled.value.error) {
    console.error("[user-history] getHistoryPage rows failed", {
      userId,
      page: safePage,
      perPage,
      code: rowsSettled.value.error.code,
      message: rowsSettled.value.error.message,
    });
    failed = true;
  }
  if (countSettled.status === "rejected") {
    console.error("[user-history] getHistoryPage count rejected", {
      userId,
      reason: countSettled.reason,
    });
    failed = true;
  } else if (countSettled.value.error) {
    console.error("[user-history] getHistoryPage count failed", {
      userId,
      code: countSettled.value.error.code,
      message: countSettled.value.error.message,
    });
    failed = true;
  }
  if (failed) return { ok: false };

  // Both fulfilled and error-free at this point — narrow the unions.
  const rowsOk = rowsSettled as PromiseFulfilledResult<{
    data: unknown;
    error: null;
  }>;
  const countOk = countSettled as PromiseFulfilledResult<{
    count: number | null;
    error: null;
  }>;

  const rows = ((rowsOk.value.data as unknown as RawRow[] | null) ?? [])
    .map(mapRow)
    .filter((r): r is HistoryRow => r !== null);
  const total = countOk.value.count ?? 0;
  // Contract: total === 0 implies totalPages === 0; otherwise >= 1.
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);

  return { ok: true, rows, total, totalPages };
}
