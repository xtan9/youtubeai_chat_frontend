import type {
  AssessmentLanguage,
  AssessmentRole,
  InteractionAssessmentCategory,
  TargetEvidence,
} from "./interaction-assessment";

export type InteractionAssessmentStatus =
  | "reviewable"
  | "actionable"
  | "safety_flag"
  | "dismissed"
  | "marked_criticism"
  | "draft_requested"
  | "draft_ready"
  | "stale"
  | "failed"
  | "published"
  | "publication_uncertain"
  | "deleted";

export type StoredInteractionAssessment = Readonly<{
  assessmentId: string;
  accountId: string;
  channelId: string;
  commentId: string;
  commentTextHash: string;
  videoId: string;
  videoTitle: string;
  category: InteractionAssessmentCategory;
  language: AssessmentLanguage;
  target: "channel_steward" | "other_participant" | "ambiguous";
  targetEvidence: readonly TargetEvidence[];
  candidateText: string | null;
  topLevelCommentText: string | null;
  neighboringReplies: readonly string[];
  draftEligible: boolean;
  status: InteractionAssessmentStatus;
  assessedAt: string;
  scanRunId?: string | null;
  supersededAt?: string | null;
  deletedAt?: string | null;
  candidateAuthorRole?: AssessmentRole;
}>;

export type InteractionReviewQueueItem = Readonly<{
  assessmentId: string;
  channelId: string;
  commentId: string;
  videoId: string;
  videoTitle: string;
  category: Exclude<
    InteractionAssessmentCategory,
    "allowed_criticism"
  >;
  language: AssessmentLanguage;
  candidateText: string;
  topLevelCommentText: string;
  neighboringReplies: readonly string[];
  draftEligible: boolean;
  status: InteractionAssessmentStatus;
  assessedAt: string;
}>;

const QUEUE_STATUSES = new Set<InteractionAssessmentStatus>([
  "reviewable",
  "actionable",
  "safety_flag",
  "draft_requested",
  "draft_ready",
  "stale",
  "failed",
  "publication_uncertain",
]);

const CATEGORY_PRIORITY: Record<
  Exclude<InteractionAssessmentCategory, "allowed_criticism">,
  number
> = {
  safety_flag: 0,
  actionable_abuse: 1,
  reviewable_interaction: 2,
};

function isQueueCategory(
  category: InteractionAssessmentCategory,
): category is Exclude<InteractionAssessmentCategory, "allowed_criticism"> {
  return category !== "allowed_criticism";
}

type QueueAssessment = StoredInteractionAssessment & Readonly<{
  category: Exclude<InteractionAssessmentCategory, "allowed_criticism">;
}>;

function isVisibleAssessment(
  assessment: StoredInteractionAssessment,
): assessment is QueueAssessment {
  return (
    isQueueCategory(assessment.category) &&
    QUEUE_STATUSES.has(assessment.status) &&
    assessment.supersededAt == null &&
    assessment.deletedAt == null &&
    assessment.candidateText !== null &&
    assessment.topLevelCommentText !== null
  );
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectReviewQueue(
  assessments: readonly StoredInteractionAssessment[],
): readonly InteractionReviewQueueItem[] {
  return assessments
    .filter(isVisibleAssessment)
    .map((assessment) => ({
      assessmentId: assessment.assessmentId,
      channelId: assessment.channelId,
      commentId: assessment.commentId,
      videoId: assessment.videoId,
      videoTitle: assessment.videoTitle,
      category: assessment.category,
      language: assessment.language,
      candidateText: assessment.candidateText!,
      topLevelCommentText: assessment.topLevelCommentText!,
      neighboringReplies: [...assessment.neighboringReplies],
      draftEligible:
        assessment.category === "actionable_abuse" &&
        assessment.draftEligible &&
        assessment.target === "channel_steward" &&
        assessment.targetEvidence.length > 0 &&
        assessment.language !== "other" &&
        assessment.status !== "safety_flag",
      status: assessment.status,
      assessedAt: assessment.assessedAt,
    }))
    .sort((left, right) => {
      const categoryOrder =
        CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category];
      if (categoryOrder !== 0) return categoryOrder;
      return (
        timestamp(right.assessedAt) - timestamp(left.assessedAt) ||
        left.assessmentId.localeCompare(right.assessmentId)
      );
    });
}
