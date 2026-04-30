"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";

export interface ViewVideoSummaryOk {
  ok: true;
  summaryId: string;
  videoId: string;
  summary: string;
  model: string | null;
  createdAt: string;
  /** UUID of the audit row written for this view, or null when the
   * audit write failed. Audit is fail-open: a write failure must never
   * block content disclosure to a privileged admin reviewing data they
   * already have access to. */
  auditId: string | null;
  /** When `auditId` is null, this carries the underlying writeAudit
   * reason — propagated to the UI so the operator sees a specific cause. */
  auditFailureReason: string | null;
}

export interface ViewVideoSummaryError {
  ok: false;
  reason:
    | "missing_video_id"
    | "invalid_video_id"
    | "video_not_found"
    | "internal_error";
}

export type ViewVideoSummaryResult =
  | ViewVideoSummaryOk
  | ViewVideoSummaryError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the summary text for a video and writes a `view_summary_text`
 * audit row at the disclosure boundary. Audit is fail-open: a write
 * failure must never block content disclosure to a privileged admin
 * reviewing data they already have access to.
 *
 * Production has at most one summary per video (per migration
 * 20260423000000_drop_thinking_columns, which dropped both
 * `enable_thinking` and `thinking` along with the unique constraint
 * that previously allowed two variants per video). The query returns
 * the most recent row defensively in case any historical pre-dedup
 * duplicates remain.
 */
export async function viewVideoSummaryAction(
  videoId: string,
): Promise<ViewVideoSummaryResult> {
  if (!videoId) return { ok: false, reason: "missing_video_id" };
  if (!UUID_RE.test(videoId)) return { ok: false, reason: "invalid_video_id" };

  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const { data: summaryRow, error: summaryErr } = await client
    .from("summaries")
    .select("id, video_id, summary, model, created_at")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (summaryErr) {
    console.error("[view-video-summary] summary fetch failed", {
      videoId,
      message: summaryErr.message,
    });
    return { ok: false, reason: "internal_error" };
  }

  if (!summaryRow) return { ok: false, reason: "video_not_found" };

  const row = summaryRow as Record<string, unknown>;
  const summaryId = String(row.id);
  const auditResult = await writeAudit(client, {
    admin: { userId: principal.userId, email: principal.email },
    action: "view_summary_text",
    resourceType: "summary",
    resourceId: summaryId,
    metadata: {
      video_id: videoId,
      model: (row.model as string | null) ?? null,
    },
  });

  return {
    ok: true,
    summaryId,
    videoId,
    summary: String(row.summary ?? ""),
    model: (row.model as string | null) ?? null,
    createdAt: String(row.created_at),
    auditId: auditResult.ok ? auditResult.id : null,
    auditFailureReason: auditResult.ok ? null : auditResult.reason,
  };
}
