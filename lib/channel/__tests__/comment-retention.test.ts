import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAssessmentContext,
  type FinalizedInteractionAssessment,
  type InteractionCommentSnapshot,
} from "../interaction-assessment";
import {
  commentRevisionChanged,
  hashCommentText,
  redactDeletedInteractionAssessment,
  retainInteractionAssessment,
} from "../comment-retention";

const candidate: InteractionCommentSnapshot = {
  commentId: "comment-1",
  text: "You are a fool.",
  authorRole: "other_participant",
  replyTargetRole: "channel_steward",
  observableTargetEvidence: ["reply_to_steward_comment"],
};

const context = buildAssessmentContext({
  videoTitle: "A video",
  candidate,
  topLevelComment: {
    commentId: "top-level-1",
    text: "Steward comment",
    authorRole: "channel_steward",
  },
  neighboringReplies: [
    {
      commentId: "neighbor-1",
      text: "A bounded neighbor",
      authorRole: "other_participant",
    },
  ],
});

const assessment: FinalizedInteractionAssessment = {
  schemaVersion: "interaction-assessment-v1",
  category: "actionable_abuse",
  language: "english",
  target: "channel_steward",
  targetEvidence: ["reply_to_steward_comment"],
  draftEligible: true,
};

describe("interaction assessment retention", () => {
  it("does not retain criticism text, creates a revision for changed text, and redacts deleted review text", () => {
    const allowed = retainInteractionAssessment({
      assessmentId: "allowed-assessment",
      accountId: "account-1",
      channelId: "channel-1",
      videoId: "video-1",
      candidate: { ...candidate, text: "The argument is wrong." },
      context,
      assessment: { ...assessment, category: "allowed_criticism", draftEligible: false },
      assessedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(allowed.candidateText).toBeNull();
    expect(allowed.topLevelCommentText).toBeNull();
    expect(allowed.neighboringReplies).toEqual([]);
    expect(JSON.stringify(allowed)).not.toContain("The argument is wrong.");

    const retained = retainInteractionAssessment({
      assessmentId: "actionable-assessment",
      accountId: "account-1",
      channelId: "channel-1",
      videoId: "video-1",
      candidate,
      context,
      assessment,
      assessedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(retained.commentTextHash).toBe(hashCommentText(candidate.text));
    expect(retained.candidateText).toBe(candidate.text);
    expect(commentRevisionChanged(retained, candidate.text)).toBe(false);
    expect(commentRevisionChanged(retained, "You are an even bigger fool.")).toBe(
      true,
    );

    const deleted = redactDeletedInteractionAssessment(
      retained,
      "2026-08-31T13:00:00.000Z",
    );
    expect(deleted).toMatchObject({
      status: "deleted",
      candidateText: null,
      topLevelCommentText: null,
      neighboringReplies: [],
      draftEligible: false,
    });
    expect(JSON.stringify(deleted)).not.toContain(candidate.text);
    expect(JSON.stringify(deleted)).not.toContain("Steward comment");
    expect(JSON.stringify(deleted)).not.toContain("A bounded neighbor");
  });
});
