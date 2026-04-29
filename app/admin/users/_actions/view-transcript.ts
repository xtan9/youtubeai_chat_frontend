"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";
import type { TranscriptSource } from "@/lib/admin/types";

const ALLOWED_SOURCES: readonly TranscriptSource[] = [
  "manual_captions",
  "auto_captions",
  "whisper",
] as const;

export interface ViewTranscriptOk {
  ok: true;
  /** The full transcript text the admin is viewing. May be null if the
   * cached row predates the schema change that added the column. */
  transcript: string | null;
  summary: string;
  thinking: string | null;
  videoTitle: string | null;
  channelName: string | null;
  language: string | null;
  /** True when the videos table fetch errored. UI should surface a
   * "metadata unavailable" indicator so an operator can distinguish a
   * row genuinely missing title/channel from a degraded join. */
  videoFetchFailed: boolean;
  source: TranscriptSource;
  model: string | null;
  processingTimeSeconds: number | null;
  createdAt: string;
  /** UUID of the audit row written for this view, or null when the
   * audit write failed (fail-open per spike-003). */
  auditId: string | null;
  /** When `auditId` is null, this carries the underlying writeAudit
   * reason — propagated to the UI so the operator sees a specific
   * cause (e.g. "connection_timeout") rather than a generic banner. */
  auditFailureReason: string | null;
}

export interface ViewTranscriptError {
  ok: false;
  reason:
    | "summary_not_found"
    | "missing_summary_id"
    | "invalid_summary_id"
    | "internal_error";
}

export type ViewTranscriptResult = ViewTranscriptOk | ViewTranscriptError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server action invoked by the transcript modal on /admin/users.
 *
 * Contract:
 * - Re-checks admin via requireAdminPage(). Non-admin gets bounced by the
 *   gate's redirect (NotAdminError surfaces as a redirect to "/").
 * - Reads the summary by id via the gated service-role client.
 * - Writes a "view_transcript" audit row before returning content. The
 *   audit write is fail-open (per spike findings); a failed insert is
 *   surfaced via auditId=null in the response, never as a thrown error.
 *
 * The `viewedUserId` is captured in metadata so /admin/audit drill-down
 * can answer "which user's expansion produced this view" — even though
 * summaries are a global cache and have no owner column, the admin's
 * navigation context does identify a user.
 */
export async function viewTranscriptAction(
  summaryId: string,
  viewedUserId: string | null,
): Promise<ViewTranscriptResult> {
  if (!summaryId) return { ok: false, reason: "missing_summary_id" };
  if (!UUID_RE.test(summaryId)) {
    return { ok: false, reason: "invalid_summary_id" };
  }

  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const { data: summaryRow, error: summaryErr } = await client
    .from("summaries")
    .select(
      "id, video_id, transcript, summary, thinking, transcript_source, model, processing_time_seconds, created_at",
    )
    .eq("id", summaryId)
    .maybeSingle();
  if (summaryErr) {
    console.error("[view-transcript] summary fetch failed", {
      summaryId,
      message: summaryErr.message,
    });
    return { ok: false, reason: "internal_error" };
  }
  if (!summaryRow) return { ok: false, reason: "summary_not_found" };

  const rawSource = String(summaryRow.transcript_source ?? "auto_captions");
  if (!ALLOWED_SOURCES.includes(rawSource as TranscriptSource)) {
    console.error("[view-transcript] unknown transcript_source", {
      summaryId,
      rawSource,
    });
    return { ok: false, reason: "internal_error" };
  }
  const source = rawSource as TranscriptSource;

  let videoTitle: string | null = null;
  let channelName: string | null = null;
  let language: string | null = null;
  let videoFetchFailed = false;
  if (summaryRow.video_id) {
    const { data: videoRow, error: videoErr } = await client
      .from("videos")
      .select("title, channel_name, language")
      .eq("id", String(summaryRow.video_id))
      .maybeSingle();
    if (videoErr) {
      videoFetchFailed = true;
      // Video metadata is auxiliary; log + continue with nulls. The audit
      // path is the security-critical write and proceeds below.
      console.error("[view-transcript] video metadata fetch failed", {
        videoId: summaryRow.video_id,
        message: videoErr.message,
      });
    } else if (videoRow) {
      videoTitle = (videoRow.title as string | null) ?? null;
      channelName = (videoRow.channel_name as string | null) ?? null;
      language = (videoRow.language as string | null) ?? null;
    }
  }

  // viewedUserId is metadata-only and never used as a query key, so the
  // injection surface is JSONB content. Soft-validate: drop the field
  // (don't reject the action) when the value isn't a UUID. Audit metadata
  // stays clean; the action still succeeds.
  let safeViewedUserId: string | null = null;
  if (viewedUserId) {
    if (UUID_RE.test(viewedUserId)) {
      safeViewedUserId = viewedUserId;
    } else {
      console.warn("[view-transcript] dropped non-UUID viewedUserId", {
        prefix: viewedUserId.slice(0, 16),
      });
    }
  }

  // Audit fires only at the boundary where transcript text becomes visible
  // — never on the surrounding listing pages. (Per spike-003 requirement.)
  const auditResult = await writeAudit(client, {
    admin: { userId: principal.userId, email: principal.email },
    action: "view_transcript",
    resourceType: "summary",
    resourceId: summaryId,
    metadata: safeViewedUserId ? { viewed_user_id: safeViewedUserId } : {},
  });

  return {
    ok: true,
    transcript: (summaryRow.transcript as string | null) ?? null,
    summary: String(summaryRow.summary ?? ""),
    thinking: (summaryRow.thinking as string | null) ?? null,
    videoTitle,
    channelName,
    language,
    videoFetchFailed,
    source,
    model: (summaryRow.model as string | null) ?? null,
    processingTimeSeconds:
      typeof summaryRow.processing_time_seconds === "number"
        ? (summaryRow.processing_time_seconds as number)
        : null,
    createdAt: String(summaryRow.created_at),
    auditId: auditResult.ok ? auditResult.id : null,
    auditFailureReason: auditResult.ok ? null : auditResult.reason,
  };
}
