import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { VIDEO_USERS_DRILLDOWN_CAP } from "@/lib/admin/admin-constants";

export interface VideoUsersDisclosure {
  videoId: string;
  users: {
    userId: string;
    /** Null when emailLookupOk=false or the account genuinely has no email. */
    email: string | null;
    emailLookupOk: boolean;
    /** The most recent access retained for this user. */
    accessedAt: string;
    cacheHit: boolean;
  }[];
  /** True when the raw access-row cap was reached. */
  truncated: boolean;
}

export class VideoUserDisclosureError extends Error {
  constructor(scope: string, detail: string) {
    super(`[video-user-disclosure:${scope}] ${detail}`);
    this.name = "VideoUserDisclosureError";
  }
}

/**
 * Read the users revealed by a Video disclosure.
 *
 * This is deliberately a read-only capability separate from Admin Reports.
 * The caller is responsible for authorization and for auditing the returned
 * rows at the disclosure boundary.
 */
export async function getVideoUsersDisclosure(
  client: SupabaseClient,
  videoId: string,
): Promise<VideoUsersDisclosure> {
  const { data: history, error: historyError } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .eq("video_id", videoId)
    .order("accessed_at", { ascending: false })
    .limit(VIDEO_USERS_DRILLDOWN_CAP + 1);

  if (historyError) {
    throw new VideoUserDisclosureError("history", historyError.message);
  }
  if (!history || history.length === 0) {
    return { videoId, users: [], truncated: false };
  }

  // A CAP+1 peek is enough to expose uncertainty without revealing the tail.
  const truncated = history.length > VIDEO_USERS_DRILLDOWN_CAP;
  const slicedHistory = truncated
    ? history.slice(0, VIDEO_USERS_DRILLDOWN_CAP)
    : history;

  const { data: summaries, error: summariesError } = await client
    .from("summaries")
    .select("video_id, created_at")
    .eq("video_id", videoId);
  if (summariesError) {
    throw new VideoUserDisclosureError("summaries", summariesError.message);
  }

  let earliestSummaryAt: string | null = null;
  for (const summary of (summaries ?? []) as Array<Record<string, unknown>>) {
    const createdAt = String(summary.created_at);
    if (!earliestSummaryAt || createdAt < earliestSummaryAt) {
      earliestSummaryAt = createdAt;
    }
  }

  const mostRecentByUser = new Map<
    string,
    { userId: string; accessedAt: string }
  >();
  for (const row of slicedHistory as Array<Record<string, unknown>>) {
    const userId = String(row.user_id);
    const accessedAt = String(row.created_at);
    const previous = mostRecentByUser.get(userId);
    if (!previous || accessedAt > previous.accessedAt) {
      mostRecentByUser.set(userId, { userId, accessedAt });
    }
  }

  const distinctUsers = Array.from(mostRecentByUser.values());
  const lookups = await Promise.all(
    distinctUsers.map(async ({ userId }) => {
      try {
        const { data, error } = await client.auth.admin.getUserById(userId);
        if (error) {
          console.error("[video-user-disclosure] email lookup failed", {
            userId,
            message: error.message,
          });
          return { userId, email: null, ok: false };
        }
        return { userId, email: data.user?.email ?? null, ok: true };
      } catch (error) {
        console.error("[video-user-disclosure] email lookup threw", {
          userId,
          error,
        });
        return { userId, email: null, ok: false };
      }
    }),
  );
  const lookupByUserId = new Map(lookups.map((lookup) => [lookup.userId, lookup]));

  return {
    videoId,
    users: distinctUsers.map(({ userId, accessedAt }) => {
      const lookup = lookupByUserId.get(userId);
      return {
        userId,
        email: lookup?.email ?? null,
        emailLookupOk: lookup?.ok ?? false,
        accessedAt,
        cacheHit: earliestSummaryAt ? earliestSummaryAt < accessedAt : false,
      };
    }),
    truncated,
  };
}
