"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";
import { ALL_SOURCES } from "@/lib/admin/queries";
import type { TranscriptSource } from "@/lib/admin/types";

export interface ViewVideoTranscriptOk {
  ok: true;
  summaryId: string;
  videoId: string;
  transcript: string | null;
  source: TranscriptSource;
  videoTitle: string | null;
  channelName: string | null;
  language: string | null;
  /** True when the videos metadata fetch errored. UI should surface a
   * "metadata unavailable" indicator. */
  videoFetchFailed: boolean;
  createdAt: string;
  auditId: string | null;
  auditFailureReason: string | null;
}

export interface ViewVideoTranscriptError {
  ok: false;
  reason:
    | "missing_video_id"
    | "invalid_video_id"
    | "video_not_found"
    | "internal_error";
}

export type ViewVideoTranscriptResult =
  | ViewVideoTranscriptOk
  | ViewVideoTranscriptError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the transcript for a video and writes a `view_transcript`
 * audit row. Audit is fail-open: a write failure must never block
 * content disclosure to a privileged admin reviewing data they already
 * have access to.
 *
 * Returns `internal_error` if the row's `transcript_source` falls
 * outside `ALL_SOURCES` — keep `ALL_SOURCES` in sync with the
 * `TranscriptSource` type. Production has at most one summary per
 * video (per migration 20260423000000_drop_thinking_columns).
 */
export async function viewVideoTranscriptAction(
  videoId: string,
): Promise<ViewVideoTranscriptResult> {
  if (!videoId) return { ok: false, reason: "missing_video_id" };
  if (!UUID_RE.test(videoId)) return { ok: false, reason: "invalid_video_id" };

  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const { data: summaryRow, error: summaryErr } = await client
    .from("summaries")
    .select("id, video_id, transcript, transcript_source, created_at")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (summaryErr) {
    console.error("[view-video-transcript] summary fetch failed", {
      videoId,
      message: summaryErr.message,
    });
    return { ok: false, reason: "internal_error" };
  }

  if (!summaryRow) return { ok: false, reason: "video_not_found" };

  const row = summaryRow as Record<string, unknown>;
  const rawSource = String(row.transcript_source ?? "auto_captions");
  if (!ALL_SOURCES.includes(rawSource as TranscriptSource)) {
    console.error("[view-video-transcript] unknown transcript_source", {
      videoId,
      rawSource,
    });
    return { ok: false, reason: "internal_error" };
  }
  const source = rawSource as TranscriptSource;

  // Video metadata is auxiliary; failure logged + returned as
  // videoFetchFailed=true. Audit (the security-critical write) still runs.
  let videoTitle: string | null = null;
  let channelName: string | null = null;
  let language: string | null = null;
  let videoFetchFailed = false;
  const { data: videoRow, error: videoErr } = await client
    .from("videos")
    .select("title, channel_name, language")
    .eq("id", videoId)
    .maybeSingle();
  if (videoErr) {
    videoFetchFailed = true;
    console.error("[view-video-transcript] video metadata fetch failed", {
      videoId,
      message: videoErr.message,
    });
  } else if (videoRow) {
    videoTitle = (videoRow.title as string | null) ?? null;
    channelName = (videoRow.channel_name as string | null) ?? null;
    language = (videoRow.language as string | null) ?? null;
  }

  const summaryId = String(row.id);
  const auditResult = await writeAudit(client, {
    admin: { userId: principal.userId, email: principal.email },
    action: "view_transcript",
    resourceType: "summary",
    resourceId: summaryId,
    metadata: {
      video_id: videoId,
    },
  });

  return {
    ok: true,
    summaryId,
    videoId,
    transcript: (row.transcript as string | null) ?? null,
    source,
    videoTitle,
    channelName,
    language,
    videoFetchFailed,
    createdAt: String(row.created_at),
    auditId: auditResult.ok ? auditResult.id : null,
    auditFailureReason: auditResult.ok ? null : auditResult.reason,
  };
}
