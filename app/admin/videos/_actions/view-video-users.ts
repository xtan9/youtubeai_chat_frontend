"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { getVideoSummariesUsers } from "@/lib/admin/queries";
import { writeAudit } from "@/lib/admin/audit";

export interface ViewVideoUsersOk {
  ok: true;
  videoId: string;
  users: {
    userId: string;
    email: string | null;
    emailLookupOk: boolean;
    accessedAt: string;
    cacheHit: boolean;
    /** Audit row id, null when the per-user audit insert failed (fail-open). */
    auditId: string | null;
  }[];
  /** True when the drilldown query hit VIDEO_USERS_DRILLDOWN_CAP. The
   * UI should surface a "+N more — drilldown capped" indicator so the
   * cap is visible rather than silently dropping the tail. */
  truncated: boolean;
}

export interface ViewVideoUsersError {
  ok: false;
  reason: "missing_video_id" | "invalid_video_id" | "internal_error";
}

export type ViewVideoUsersResult = ViewVideoUsersOk | ViewVideoUsersError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the distinct user list for a video and writes ONE audit row per
 * revealed user. Per-user audit rows let the existing per-user drilldown
 * (`getUserAuditEvents`) surface admin viewing activity without code
 * changes — it already filters on `metadata->>viewed_user_id`.
 *
 * Audit is fail-open per row: a failed insert logs but the user is still
 * returned with `auditId: null`.
 */
export async function viewVideoUsersAction(
  videoId: string,
): Promise<ViewVideoUsersResult> {
  if (!videoId) return { ok: false, reason: "missing_video_id" };
  if (!UUID_RE.test(videoId)) return { ok: false, reason: "invalid_video_id" };

  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  let drilldown;
  try {
    drilldown = await getVideoSummariesUsers(client, videoId);
  } catch (err) {
    console.error("[view-video-users] drilldown query failed", {
      videoId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "internal_error" };
  }

  // One audit row per revealed user. Fail-open per row — if a write fails
  // for one user, log + continue; the response still includes that user
  // with `auditId: null`.
  //
  // `drilldown_truncated` is captured per-row so a forensic reviewer
  // querying this video's audit trail months from now can tell at a
  // glance whether a `view_video_users` event represents the full
  // user set or a 200-cap subset, even if the original drilldown
  // response is long gone.
  const users = await Promise.all(
    drilldown.users.map(async (u) => {
      const auditResult = await writeAudit(client, {
        admin: { userId: principal.userId, email: principal.email },
        action: "view_video_users",
        resourceType: "video",
        resourceId: videoId,
        metadata: {
          video_id: videoId,
          viewed_user_id: u.userId,
          cache_hit: u.cacheHit,
          drilldown_truncated: drilldown.truncated,
        },
      });
      return {
        userId: u.userId,
        email: u.email,
        emailLookupOk: u.emailLookupOk,
        accessedAt: u.accessedAt,
        cacheHit: u.cacheHit,
        auditId: auditResult.ok ? auditResult.id : null,
      };
    }),
  );

  return { ok: true, videoId, users, truncated: drilldown.truncated };
}
