import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-video chat-message counts for the current user, scoped to a list
 * of video ids. Used to render a "💬 N" badge on history rows so users
 * can see at a glance which videos they've chatted about without
 * loading each chat thread.
 *
 * Single SELECT (one network round-trip) of the per-row `video_id`
 * column, then aggregate client-side. The
 * `idx_chat_messages_user_video_created (user_id, video_id, ...)` index
 * makes the lookup index-only. Worst-case payload is ~36 bytes (uuid)
 * per message, which is acceptable up to a few hundred messages per
 * user — far below typical chat volume.
 *
 * Fails soft: any error returns an empty Map so the dashboard / history
 * page renders without badges instead of failing closed (the badge is
 * a nice-to-have, not load-bearing). The error is logged so a regression
 * isn't silently invisible.
 */
export async function getChatMessageCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  videoIds: readonly string[],
): Promise<Map<string, number>> {
  if (videoIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("video_id")
    .eq("user_id", userId)
    .in("video_id", videoIds);

  if (error) {
    console.error("[chat-counts] getChatMessageCounts failed", {
      errorId: "CHAT_COUNTS_FETCH_FAILED",
      userId,
      code: error.code,
      message: error.message,
    });
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of (data as { video_id: string }[] | null) ?? []) {
    counts.set(row.video_id, (counts.get(row.video_id) ?? 0) + 1);
  }
  return counts;
}
