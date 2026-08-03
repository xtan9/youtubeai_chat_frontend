"use server";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { writeAudit } from "@/lib/admin/audit";
import { getVideoTranscriptDisclosure } from "@/lib/services/transcript-disclosure";
import type { TranscriptSource } from "@/lib/domain/transcript-source";

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
 * Transcript reads, source validation, newest-summary selection, and
 * auxiliary Video metadata belong to the dedicated disclosure service.
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

  let disclosure;
  try {
    disclosure = await getVideoTranscriptDisclosure(client, videoId);
  } catch (error) {
    console.error("[view-video-transcript] disclosure read failed", {
      videoId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "internal_error" };
  }
  if (!disclosure) return { ok: false, reason: "video_not_found" };

  const auditResult = await writeAudit(client, {
    admin: { userId: principal.userId, email: principal.email },
    action: "view_transcript",
    resourceType: "summary",
    resourceId: disclosure.summaryId,
    metadata: {
      video_id: videoId,
    },
  });

  return {
    ok: true,
    ...disclosure,
    auditId: auditResult.ok ? auditResult.id : null,
    auditFailureReason: auditResult.ok ? null : auditResult.reason,
  };
}
