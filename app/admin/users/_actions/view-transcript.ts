"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";
import { getTranscriptDisclosureBySummaryId } from "@/lib/services/transcript-disclosure";
import type { TranscriptSource } from "@/lib/domain/transcript-source";

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
   * audit write failed (fail-open per the disclosure contract). */
  auditId: string | null;
  /** When `auditId` is null, this carries the underlying writeAudit
   * reason so the operator sees a specific cause. */
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
 * The action re-checks the admin gate and writes the content-disclosure
 * audit event. The dedicated service owns the summary read, source
 * validation, and auxiliary Video metadata policy.
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

  let disclosure;
  try {
    disclosure = await getTranscriptDisclosureBySummaryId(client, summaryId);
  } catch (error) {
    console.error("[view-transcript] disclosure read failed", {
      summaryId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "internal_error" };
  }
  if (!disclosure) return { ok: false, reason: "summary_not_found" };

  // viewedUserId is metadata-only and never a query key. Soft-validate it
  // so malformed navigation context cannot enter the audit JSON.
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

  // Audit fires at the boundary where transcript text becomes visible.
  const auditResult = await writeAudit(client, {
    admin: { userId: principal.userId, email: principal.email },
    action: "view_transcript",
    resourceType: "summary",
    resourceId: summaryId,
    metadata: safeViewedUserId ? { viewed_user_id: safeViewedUserId } : {},
  });

  return {
    ok: true,
    transcript: disclosure.transcript,
    summary: disclosure.summary,
    thinking: disclosure.thinking,
    videoTitle: disclosure.videoTitle,
    channelName: disclosure.channelName,
    language: disclosure.language,
    videoFetchFailed: disclosure.videoFetchFailed,
    source: disclosure.source,
    model: disclosure.model,
    processingTimeSeconds: disclosure.processingTimeSeconds,
    createdAt: disclosure.createdAt,
    auditId: auditResult.ok ? auditResult.id : null,
    auditFailureReason: auditResult.ok ? null : auditResult.reason,
  };
}
