import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeYouTubeVideoId } from "./youtube-url";

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
// "you haven't summarized any videos yet" empty state.
export type RecentHistoryResult =
  | { ok: true; rows: HistoryRow[] }
  | { ok: false };

export type HistoryPageResult =
  | { ok: true; rows: HistoryRow[]; total: number; totalPages: number }
  | { ok: false };

type RawRpcRow = {
  videoId?: unknown;
  youtubeUrl?: unknown;
  youtubeVideoId?: unknown;
  title?: unknown;
  channelName?: unknown;
  viewedAt?: unknown;
};

type HistoryRpcPayload = {
  outcome?: unknown;
  rows?: unknown;
  total?: unknown;
};

function mapRow(raw: unknown): HistoryRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawRpcRow;
  if (
    typeof row.videoId !== "string" ||
    typeof row.youtubeUrl !== "string" ||
    typeof row.viewedAt !== "string" ||
    (row.title !== null && typeof row.title !== "string") ||
    (row.channelName !== null && typeof row.channelName !== "string")
  ) {
    return null;
  }

  const suppliedVideoId =
    typeof row.youtubeVideoId === "string" ? row.youtubeVideoId : row.youtubeUrl;
  return {
    videoId: row.videoId,
    youtubeUrl: row.youtubeUrl,
    youtubeVideoId: normalizeYouTubeVideoId(suppliedVideoId),
    title: row.title as string | null,
    channelName: row.channelName as string | null,
    viewedAt: row.viewedAt,
  };
}

async function readHistoryRpc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ rows: HistoryRow[]; total: number } | null> {
  let result: {
    data: unknown;
    error: { code?: string; message?: string } | null;
  };
  try {
    result = await supabase.rpc("list_user_video_history", {
      p_user_id: userId,
      p_page: page,
      p_page_size: pageSize,
    });
  } catch (error) {
    console.error("[user-history] history RPC rejected", {
      userId,
      page,
      pageSize,
      reason: error,
    });
    return null;
  }

  if (result.error) {
    console.error("[user-history] history RPC failed", {
      userId,
      page,
      pageSize,
      code: result.error.code,
      message: result.error.message,
    });
    return null;
  }

  const payload = result.data as HistoryRpcPayload | null;
  if (
    payload?.outcome !== "resolved" ||
    !Array.isArray(payload.rows) ||
    typeof payload.total !== "number" ||
    !Number.isSafeInteger(payload.total) ||
    payload.total < 0
  ) {
    console.error("[user-history] history RPC returned an invalid payload", {
      userId,
      page,
      pageSize,
    });
    return null;
  }

  return {
    rows: payload.rows
      .map(mapRow)
      .filter((row): row is HistoryRow => row !== null),
    total: payload.total,
  };
}

export async function getRecentHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  limit: number = 10,
): Promise<RecentHistoryResult> {
  const safeLimit = Math.max(1, Math.floor(limit) || 10);
  const result = await readHistoryRpc(supabase, userId, 1, safeLimit);
  return result ? { ok: true, rows: result.rows } : { ok: false };
}

export async function getHistoryPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  page: number,
  perPage: number = 25,
): Promise<HistoryPageResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePerPage = Math.max(1, Math.floor(perPage) || 25);
  const result = await readHistoryRpc(
    supabase,
    userId,
    safePage,
    safePerPage,
  );
  if (!result) return { ok: false };

  // Contract: total === 0 implies totalPages === 0; otherwise >= 1.
  const totalPages =
    result.total === 0 ? 0 : Math.ceil(result.total / safePerPage);
  return {
    ok: true,
    rows: result.rows,
    total: result.total,
    totalPages,
  };
}
