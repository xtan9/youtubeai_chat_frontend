"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";

export interface ViewVideoSummaryOk {
  ok: true;
  summaryId: string;
  videoId: string;
  summary: string;
  thinking: string | null;
  model: string | null;
  createdAt: string;
  /** UUID of the audit row written for this view, or null when the audit
   * write failed (fail-open per spike-003). */
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
 * Returns the canonical summary (`enable_thinking=false` preferred) for a
 * video and writes a `view_summary_text` audit row at the disclosure
 * boundary. Audit is fail-open per spike-003.
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

  // Prefer enable_thinking=false (canonical user-visible variant); fall
  // back to whichever exists most recently.
  const { data: canonical, error: canonicalErr } = await client
    .from("summaries")
    .select(
      "id, video_id, summary, thinking, model, enable_thinking, created_at",
    )
    .eq("video_id", videoId)
    .eq("enable_thinking", false)
    .maybeSingle();
  if (canonicalErr) {
    console.error("[view-video-summary] canonical summary fetch failed", {
      videoId,
      message: canonicalErr.message,
    });
    return { ok: false, reason: "internal_error" };
  }

  let summaryRow = canonical as Record<string, unknown> | null;
  if (!summaryRow) {
    const { data: fallback, error: fallbackErr } = await client
      .from("summaries")
      .select(
        "id, video_id, summary, thinking, model, enable_thinking, created_at",
      )
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackErr) {
      console.error("[view-video-summary] fallback summary fetch failed", {
        videoId,
        message: fallbackErr.message,
      });
      return { ok: false, reason: "internal_error" };
    }
    summaryRow = fallback as Record<string, unknown> | null;
  }

  if (!summaryRow) return { ok: false, reason: "video_not_found" };

  const summaryId = String(summaryRow.id);
  const auditResult = await writeAudit(client, {
    admin: { userId: principal.userId, email: principal.email },
    action: "view_summary_text",
    resourceType: "summary",
    resourceId: summaryId,
    metadata: {
      video_id: videoId,
      model: (summaryRow.model as string | null) ?? null,
      enable_thinking: (summaryRow.enable_thinking as boolean | null) ?? null,
    },
  });

  return {
    ok: true,
    summaryId,
    videoId,
    summary: String(summaryRow.summary ?? ""),
    thinking: (summaryRow.thinking as string | null) ?? null,
    model: (summaryRow.model as string | null) ?? null,
    createdAt: String(summaryRow.created_at),
    auditId: auditResult.ok ? auditResult.id : null,
    auditFailureReason: auditResult.ok ? null : auditResult.reason,
  };
}
