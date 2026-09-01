import "server-only";

import { createHash } from "node:crypto";
import type {
  AssessmentContext,
  FinalizedInteractionAssessment,
  InteractionCommentSnapshot,
} from "./interaction-assessment";
import type {
  InteractionAssessmentStatus,
  StoredInteractionAssessment,
} from "./review-queue";

export function hashCommentText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function commentRevisionChanged(
  previous: Pick<StoredInteractionAssessment, "commentTextHash">,
  currentText: string,
): boolean {
  return previous.commentTextHash !== hashCommentText(currentText);
}

function statusForCategory(
  category: FinalizedInteractionAssessment["category"],
): InteractionAssessmentStatus {
  switch (category) {
    case "allowed_criticism":
      return "marked_criticism";
    case "actionable_abuse":
      return "actionable";
    case "safety_flag":
      return "safety_flag";
    case "reviewable_interaction":
      return "reviewable";
  }
}

export function retainInteractionAssessment(input: Readonly<{
  assessmentId: string;
  accountId: string;
  channelId: string;
  videoId: string;
  candidate: InteractionCommentSnapshot;
  /** Optional raw-source hash when candidate text is a privacy-safe projection. */
  commentTextHash?: string;
  context: AssessmentContext;
  assessment: FinalizedInteractionAssessment;
  assessedAt: string;
}>): StoredInteractionAssessment {
  const isAllowedCriticism = input.assessment.category === "allowed_criticism";
  const commentTextHash =
    input.commentTextHash ?? hashCommentText(input.candidate.text);
  if (!/^[a-f0-9]{64}$/u.test(commentTextHash)) {
    throw new Error("Comment text hash must be a SHA-256 digest");
  }

  return {
    assessmentId: input.assessmentId,
    accountId: input.accountId,
    channelId: input.channelId,
    commentId: input.candidate.commentId,
    commentTextHash,
    videoId: input.videoId,
    videoTitle: input.context.videoTitle,
    category: input.assessment.category,
    language: input.assessment.language,
    target: isAllowedCriticism ? "ambiguous" : input.assessment.target,
    targetEvidence: isAllowedCriticism
      ? []
      : [...input.assessment.targetEvidence],
    candidateText: isAllowedCriticism ? null : input.context.candidate.text,
    topLevelCommentText: isAllowedCriticism
      ? null
      : input.context.topLevelComment.text,
    neighboringReplies: isAllowedCriticism
      ? []
      : input.context.neighboringReplies.map((reply) => reply.text),
    draftEligible:
      !isAllowedCriticism &&
      input.assessment.category === "actionable_abuse" &&
      input.assessment.draftEligible,
    status: statusForCategory(input.assessment.category),
    assessedAt: input.assessedAt,
    candidateAuthorRole: isAllowedCriticism
      ? undefined
      : input.context.candidate.authorRole,
  };
}

export function redactDeletedInteractionAssessment(
  assessment: StoredInteractionAssessment,
  deletedAt: string,
): StoredInteractionAssessment & Readonly<{ deletedAt: string }> {
  return {
    ...assessment,
    candidateText: null,
    topLevelCommentText: null,
    neighboringReplies: [],
    targetEvidence: [],
    draftEligible: false,
    status: "deleted",
    deletedAt,
  };
}
