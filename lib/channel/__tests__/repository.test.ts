import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getServiceRoleClient } = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient,
}));

import {
  loadInteractionReviewQueue,
  persistInteractionAssessment,
} from "../repository";
import type { StoredInteractionAssessment } from "../review-queue";

const assessment: StoredInteractionAssessment = {
  assessmentId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  channelId: "channel-1",
  commentId: "comment-1",
  commentTextHash: "a".repeat(64),
  videoId: "video-1",
  videoTitle: "Video",
  category: "actionable_abuse",
  language: "english",
  target: "channel_steward",
  targetEvidence: ["reply_to_steward_comment"],
  candidateText: "You are a fool.",
  topLevelCommentText: "Steward comment",
  neighboringReplies: [],
  draftEligible: true,
  status: "actionable",
  assessedAt: "2026-08-31T12:00:00.000Z",
};

describe("interaction assessment repository", () => {
  beforeEach(() => {
    getServiceRoleClient.mockReset();
  });

  it("persists the validated record through the private RPC without adding confidence", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "stored",
        assessmentId: assessment.assessmentId,
      },
      error: null,
    });
    getServiceRoleClient.mockReturnValue({ rpc });

    await expect(persistInteractionAssessment(assessment)).resolves.toEqual({
      outcome: "stored",
      assessmentId: assessment.assessmentId,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_interaction_assessment",
      expect.objectContaining({
        p_assessment_id: assessment.assessmentId,
        p_account_id: assessment.accountId,
        p_category: "actionable_abuse",
        p_draft_eligible: true,
      }),
    );
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_confidence");
  });

  it("strictly parses the queue projection and rejects confidence leakage", async () => {
    const queueItem = {
      assessmentId: assessment.assessmentId,
      channelId: assessment.channelId,
      commentId: assessment.commentId,
      videoId: assessment.videoId,
      videoTitle: assessment.videoTitle,
      category: assessment.category,
      language: assessment.language,
      candidateText: assessment.candidateText,
      topLevelCommentText: assessment.topLevelCommentText,
      neighboringReplies: [],
      draftEligible: true,
      status: assessment.status,
      assessedAt: assessment.assessedAt,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [queueItem], error: null });
    getServiceRoleClient.mockReturnValue({ rpc });

    await expect(
      loadInteractionReviewQueue({
        accountId: assessment.accountId,
        connectedChannelId: assessment.channelId,
      }),
    ).resolves.toEqual([queueItem]);
    expect(rpc).toHaveBeenCalledWith("list_interaction_review_queue", {
      p_account_id: assessment.accountId,
      p_connected_channel_id: assessment.channelId,
      p_limit: 100,
    });

    rpc.mockResolvedValueOnce({
      data: [{ ...queueItem, confidence: 0.99 }],
      error: null,
    });
    await expect(
      loadInteractionReviewQueue({
        accountId: assessment.accountId,
        connectedChannelId: assessment.channelId,
      }),
    ).rejects.toThrow(/schema validation/);
  });
});
