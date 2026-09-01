import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { PostgresScanRunStore } from "../repository";
import type { StoredInteractionAssessment } from "@/lib/channel/review-queue";

const assessment: StoredInteractionAssessment = {
  assessmentId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  channelId: "00000000-0000-4000-8000-000000000003",
  commentId: "comment-1",
  commentTextHash: "a".repeat(64),
  videoId: "video-1",
  videoTitle: "A governed video",
  category: "actionable_abuse",
  language: "english",
  target: "channel_steward",
  targetEvidence: ["channel_or_steward_identity"],
  candidateText: "You are a fool.",
  topLevelCommentText: "You are a fool.",
  neighboringReplies: [],
  draftEligible: true,
  status: "actionable",
  assessedAt: "2026-08-31T12:00:00.000Z",
  scanRunId: "00000000-0000-4000-8000-000000000004",
};

function store(rpc: ReturnType<typeof vi.fn>): PostgresScanRunStore {
  return new PostgresScanRunStore({ rpc } as unknown as SupabaseClient);
}

describe("PostgresScanRunStore real assessment seam", () => {
  it("persists and reuses only the current-hash Interaction Assessment", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { outcome: "stored", assessmentId: assessment.assessmentId },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...assessment,
          assessmentId: assessment.assessmentId,
        },
        error: null,
      });
    const scanStore = store(rpc);

    await expect(scanStore.saveInteractionAssessment(assessment)).resolves.toBe(
      assessment.assessmentId,
    );
    await expect(
      scanStore.findReusableInteractionAssessment({
        accountId: assessment.accountId,
        connectedChannelId: assessment.channelId,
        commentId: assessment.commentId,
        contentHash: assessment.commentTextHash,
      }),
    ).resolves.toEqual(assessment);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "record_interaction_assessment",
      expect.objectContaining({
        p_comment_text_hash: assessment.commentTextHash,
        p_scan_run_id: assessment.scanRunId,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "find_reusable_interaction_assessment",
      expect.objectContaining({
        p_comment_id: assessment.commentId,
        p_comment_text_hash: assessment.commentTextHash,
      }),
    );
  });

  it("redacts deleted comment text through the governed RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "redacted", redactedCount: 2 },
      error: null,
    });
    const scanStore = store(rpc);

    await expect(
      scanStore.redactDeletedInteraction({
        accountId: assessment.accountId,
        connectedChannelId: assessment.channelId,
        commentId: assessment.commentId,
        deletedAt: "2026-09-01T12:00:00.000Z",
      }),
    ).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith("redact_deleted_interaction_comment", {
      p_account_id: assessment.accountId,
      p_connected_channel_id: assessment.channelId,
      p_comment_id: assessment.commentId,
      p_deleted_at: "2026-09-01T12:00:00.000Z",
    });
  });

  it("binds real completions to the interaction assessment column", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const scanStore = store(rpc);

    await scanStore.markThreadSucceeded({
      runId: "00000000-0000-4000-8000-000000000010",
      workerId: "00000000-0000-4000-8000-000000000011",
      workItemId: "00000000-0000-4000-8000-000000000012",
      assessmentId: assessment.assessmentId,
      resultKind: "assessed",
      assessmentKind: "interaction",
    });

    expect(rpc).toHaveBeenCalledWith("complete_channel_scan_thread", {
      p_run_id: "00000000-0000-4000-8000-000000000010",
      p_worker_id: "00000000-0000-4000-8000-000000000011",
      p_work_item_id: "00000000-0000-4000-8000-000000000012",
      p_result_kind: "assessed",
      p_current_content_hash: null,
      p_assessment_id: null,
      p_interaction_assessment_id: assessment.assessmentId,
    });
  });
});
