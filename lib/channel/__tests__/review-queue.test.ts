import { describe, expect, it } from "vitest";
import {
  projectReviewQueue,
  type StoredInteractionAssessment,
} from "../review-queue";

const record = (
  overrides: Partial<StoredInteractionAssessment>,
): StoredInteractionAssessment => ({
  assessmentId: "assessment-1",
  accountId: "account-1",
  channelId: "channel-1",
  commentId: "comment-1",
  commentTextHash: "a".repeat(64),
  videoId: "video-1",
  videoTitle: "Video",
  category: "reviewable_interaction",
  language: "english",
  target: "ambiguous",
  targetEvidence: [],
  candidateText: "candidate text",
  topLevelCommentText: "top-level text",
  neighboringReplies: [],
  draftEligible: false,
  status: "reviewable",
  assessedAt: "2026-08-31T12:00:00.000Z",
  ...overrides,
});

describe("Review Queue projection", () => {
  it("omits Allowed Criticism and orders only actionable work without confidence", () => {
    const queue = projectReviewQueue([
      record({
        assessmentId: "allowed",
        commentId: "allowed-comment",
        category: "allowed_criticism",
        candidateText: "Allowed criticism must never be shown",
        status: "marked_criticism",
      }),
      record({
        assessmentId: "reviewable",
        commentId: "reviewable-comment",
        assessedAt: "2026-08-31T15:00:00.000Z",
      }),
      record({
        assessmentId: "actionable",
        commentId: "actionable-comment",
        category: "actionable_abuse",
        target: "channel_steward",
        targetEvidence: ["reply_to_steward_comment"],
        draftEligible: true,
        status: "actionable",
        assessedAt: "2026-08-31T16:00:00.000Z",
      }),
      record({
        assessmentId: "safety",
        commentId: "safety-comment",
        category: "safety_flag",
        status: "safety_flag",
        assessedAt: "2026-08-31T10:00:00.000Z",
      }),
      record({
        assessmentId: "deleted",
        commentId: "deleted-comment",
        status: "deleted",
        candidateText: null,
        topLevelCommentText: null,
      }),
    ]);

    expect(queue.map((item) => item.assessmentId)).toEqual([
      "safety",
      "actionable",
      "reviewable",
    ]);
    expect(queue).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commentId: "allowed-comment" }),
      ]),
    );
    expect(queue[1]).toMatchObject({
      category: "actionable_abuse",
      draftEligible: true,
    });
    expect(queue.every((item) => !("confidence" in item))).toBe(true);
    expect(JSON.stringify(queue)).not.toContain(
      "Allowed criticism must never be shown",
    );
  });
});
