import { z } from "zod";

/**
 * Pure, offline review-decision contract for one Channel interaction.
 *
 * This module deliberately has no provider, persistence, route, or model
 * adapter. A caller must persist the returned item and provenance through its
 * own authorized server seam. Keeping the transition here makes it impossible
 * for a UI action to silently become a bulk operation or an external
 * enforcement call.
 */

export const MAX_REVIEW_ID_CHARS = 240;
export const MAX_REVIEW_VIDEO_TITLE_CHARS = 300;
export const MAX_REVIEW_CONTEXT_TEXT_CHARS = 2_000;
export const MAX_REVIEW_NEIGHBORING_REPLIES = 8;
export const MAX_REVIEW_NEIGHBOR_REPLY_CHARS = 1_000;
export const MAX_REVIEW_EVIDENCE_ITEMS = 4;
export const MAX_REVIEW_EVIDENCE_ITEM_CHARS = 80;
export const MAX_REVIEW_DECISION_HISTORY = 32;
export const REVIEW_DECISION_RETENTION_DAYS = 30;

export const REVIEW_DECISION_SCHEMA_VERSION = "review-decision-v1" as const;
export const REVIEW_ASSESSMENT_VERSION = "interaction-assessment-v1" as const;
export const REVIEW_TAXONOMY_VERSION = "channel-comment-taxonomy-v1" as const;
export const REVIEW_VALIDATOR_VERSION = "review-decision-validator-v1" as const;
export const INTERACTION_ASSESSMENT_LABEL = "Interaction Assessment" as const;

const IdSchema = z.string().trim().min(1).max(MAX_REVIEW_ID_CHARS);
const NonEmptyTextSchema = z.string().trim().min(1);
const InstantSchema = z.string().datetime({ offset: true });
const NullableInstantSchema = InstantSchema.nullable();
const CommentTextHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

function addRetentionDays(value: Date): Date {
  const expiresAt = new Date(value.getTime());
  expiresAt.setUTCDate(expiresAt.getUTCDate() + REVIEW_DECISION_RETENTION_DAYS);
  return expiresAt;
}

function hasBoundedRetentionWindow(
  recordedAt: string,
  expiresAt: string,
): boolean {
  const recorded = new Date(recordedAt);
  const expires = new Date(expiresAt);
  return (
    !Number.isNaN(recorded.getTime()) &&
    !Number.isNaN(expires.getTime()) &&
    expires.getTime() > recorded.getTime() &&
    expires.getTime() <= addRetentionDays(recorded).getTime()
  );
}

export const ReviewAssessmentCategorySchema = z.enum([
  "safety_flag",
  "actionable_abuse",
  "reviewable_interaction",
  "allowed_criticism",
]);
export type ReviewAssessmentCategory = z.infer<
  typeof ReviewAssessmentCategorySchema
>;

export const ReviewAssessmentClassificationSchema = z.enum([
  "Safety Flag",
  "Actionable Abuse",
  "Reviewable Interaction",
  "Allowed Criticism",
]);
export type ReviewAssessmentClassification = z.infer<
  typeof ReviewAssessmentClassificationSchema
>;

export type ReviewAssessmentClassificationInput =
  | ReviewAssessmentCategory
  | ReviewAssessmentClassification;

export const ReviewAssessmentTargetSchema = z.enum([
  "channel_steward",
  "other_participant",
  "ambiguous",
]);
export type ReviewAssessmentTarget = z.infer<
  typeof ReviewAssessmentTargetSchema
>;

export const ReviewAssessmentSeveritySchema = z.enum(["non_severe", "severe"]);
export type ReviewAssessmentSeverity = z.infer<
  typeof ReviewAssessmentSeveritySchema
>;

export const ReviewAssessmentLanguageSchema = z.enum([
  "english",
  "simplified_chinese",
  "traditional_chinese",
  "chinese_english_code_switch",
  "other",
]);
export type ReviewAssessmentLanguage = z.infer<
  typeof ReviewAssessmentLanguageSchema
>;

const ReviewTargetEvidenceSchema = z
  .array(NonEmptyTextSchema.max(MAX_REVIEW_EVIDENCE_ITEM_CHARS))
  .max(MAX_REVIEW_EVIDENCE_ITEMS)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "target evidence must not repeat",
      });
    }
  });

export const ReviewItemStatusSchema = z.enum([
  "reviewable",
  "actionable",
  "safety_flag",
  "dismissed",
  "marked_criticism",
  "draft_requested",
  "draft_ready",
  "stale",
  "publishing",
  "failed",
  "published",
  "publication_uncertain",
  "deleted",
]);
export type ReviewItemStatus = z.infer<typeof ReviewItemStatusSchema>;

export const ReviewDecisionActionSchema = z.enum([
  "dismiss",
  "defer",
  "mark_allowed_criticism",
  "confirm_actionable_abuse",
  "continue_safety_enforcement",
  "request_draft",
]);
export type ReviewDecisionAction = z.infer<typeof ReviewDecisionActionSchema>;

const ReviewDecisionCommandActionSchema = z.enum([
  ...ReviewDecisionActionSchema.options,
  "open_on_youtube",
]);

export const ReviewDecisionCommandSchema = z
  .object({
    action: ReviewDecisionCommandActionSchema,
    confirmed: z.boolean(),
    deferUntil: InstantSchema.optional(),
    decisionId: IdSchema.optional(),
  })
  .strict();
export type ReviewDecisionCommand = z.infer<
  typeof ReviewDecisionCommandSchema
>;

export const ReviewDecisionActorSchema = z
  .object({
    role: z.literal("channel_steward"),
    stewardId: IdSchema,
    channelId: IdSchema,
    connectedChannelId: IdSchema,
  })
  .strict();
export type ReviewDecisionActor = z.infer<typeof ReviewDecisionActorSchema>;

const ReviewAssessmentSchema = z
  .object({
    classification: ReviewAssessmentClassificationSchema,
    target: ReviewAssessmentTargetSchema,
    severity: ReviewAssessmentSeveritySchema,
    language: ReviewAssessmentLanguageSchema,
    targetEvidence: ReviewTargetEvidenceSchema,
    assessedAt: InstantSchema,
  })
  .strict();
export type ReviewAssessment = z.infer<typeof ReviewAssessmentSchema>;

const BoundedContextSchema = z
  .object({
    candidateText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REVIEW_CONTEXT_TEXT_CHARS)
      .nullable(),
    topLevelCommentText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REVIEW_CONTEXT_TEXT_CHARS)
      .nullable(),
    neighboringReplies: z
      .array(z.string().trim().min(1).max(MAX_REVIEW_NEIGHBOR_REPLY_CHARS))
      .max(MAX_REVIEW_NEIGHBORING_REPLIES),
  })
  .strict();
export type BoundedReviewContext = z.infer<typeof BoundedContextSchema>;

const VideoSchema = z
  .object({
    id: IdSchema,
    title: z.string().trim().min(1).max(MAX_REVIEW_VIDEO_TITLE_CHARS),
  })
  .strict();
export type ReviewVideo = z.infer<typeof VideoSchema>;

const ChannelIdentitySchema = z
  .object({
    id: IdSchema,
    displayName: z.string().trim().min(1).max(MAX_REVIEW_ID_CHARS),
  })
  .strict();
export type ReviewChannelIdentity = z.infer<typeof ChannelIdentitySchema>;

const ReviewDecisionStateSchema = z
  .object({
    classification: ReviewAssessmentCategorySchema,
    status: ReviewItemStatusSchema,
    deferredUntil: NullableInstantSchema,
  })
  .strict();
export type ReviewDecisionState = z.infer<typeof ReviewDecisionStateSchema>;

export const ReviewDecisionProvenanceSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_DECISION_SCHEMA_VERSION),
    decisionId: IdSchema,
    action: ReviewDecisionActionSchema,
    stateChanged: z.boolean(),
    actorRole: z.literal("channel_steward"),
    stewardId: IdSchema,
    assessmentId: IdSchema,
    interactionId: IdSchema,
    commentId: IdSchema,
    channelId: IdSchema,
    connectedChannelId: IdSchema,
    commentTextHash: CommentTextHashSchema,
    from: ReviewDecisionStateSchema,
    to: ReviewDecisionStateSchema,
    assessmentVersion: IdSchema,
    taxonomyVersion: IdSchema,
    validatorVersion: IdSchema,
    recordedAt: InstantSchema,
    expiresAt: InstantSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    if (!hasBoundedRetentionWindow(decision.recordedAt, decision.expiresAt)) {
      context.addIssue({
        code: "custom",
        message: "Review Decision provenance must expire within 30 days",
      });
    }
  });
export type ReviewDecisionProvenance = z.infer<
  typeof ReviewDecisionProvenanceSchema
>;

export const ReviewQueueItemSchema = z
  .object({
    assessmentId: IdSchema,
    interactionId: IdSchema,
    commentId: IdSchema,
    commentTextHash: CommentTextHashSchema,
    channelId: IdSchema,
    connectedChannelId: IdSchema,
    video: VideoSchema,
    boundedContext: BoundedContextSchema,
    assessment: ReviewAssessmentSchema,
    status: ReviewItemStatusSchema,
    deferredUntil: NullableInstantSchema,
    connectedYouTubeChannel: ChannelIdentitySchema,
    publishingIdentity: ChannelIdentitySchema,
    decisionHistory: z
      .array(ReviewDecisionProvenanceSchema)
      .max(MAX_REVIEW_DECISION_HISTORY),
  })
  .strict();
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;

export type CreateReviewQueueItemInput = Readonly<{
  assessmentId: string;
  interactionId: string;
  commentId: string;
  commentTextHash: string;
  channelId: string;
  connectedChannelId: string;
  video: ReviewVideo;
  boundedContext: Readonly<{
    candidateText: string;
    topLevelCommentText: string;
    neighboringReplies: readonly string[];
  }>;
  assessment: Readonly<{
    classification: ReviewAssessmentClassificationInput;
    target: ReviewAssessmentTarget;
    severity: ReviewAssessmentSeverity;
    language: ReviewAssessmentLanguage;
    targetEvidence: readonly string[];
    assessedAt: string;
  }>;
  status?: ReviewItemStatus;
  deferredUntil?: string | null;
  connectedYouTubeChannel: ReviewChannelIdentity;
  publishingIdentity: ReviewChannelIdentity;
  decisionHistory?: readonly ReviewDecisionProvenance[];
}>;

export type ReviewQueueFilterStatus = ReviewItemStatus | "deferred" | "handled";

export type ReviewQueueProjectionOptions = Readonly<{
  videoId?: string;
  assessment?: ReviewAssessmentCategory | ReviewAssessmentClassification;
  status?: ReviewQueueFilterStatus;
  now?: Date;
}>;

export type ReviewQueueBucket =
  | "safety_flag"
  | "actionable_abuse"
  | "reviewable_interaction"
  | "handled";

export type ReviewItemAction = Readonly<{
  action: ReviewDecisionAction | "open_on_youtube";
  label: string;
  href?: string;
}>;

export type ReviewItemPresentation = Readonly<{
  id: string;
  assessmentId: string;
  interactionId: string;
  boundedContext: BoundedReviewContext;
  video: ReviewVideo;
  connectedYouTubeChannel: ReviewChannelIdentity;
  currentAssessment: Readonly<{
    label: typeof INTERACTION_ASSESSMENT_LABEL;
    classification: ReviewAssessmentClassification;
    target: ReviewAssessmentTarget;
    severity: ReviewAssessmentSeverity;
    status: ReviewItemStatus | "deferred";
  }>;
  intendedPublishingIdentity: ReviewChannelIdentity;
  openOnYouTube: Readonly<{
    action: "open_on_youtube";
    href: string;
  }>;
  actions: readonly ReviewItemAction[];
}>;

export type SafetyEnforcementAction = Readonly<{
  id: string;
  label: string;
  href?: string;
}>;

export type SafetyEnforcementGuidance = Readonly<{
  kind: "safety_enforcement_guidance";
  replyDraftAvailable: false;
  automaticEnforcementAvailable: false;
  actions: readonly SafetyEnforcementAction[];
}>;

export type ReviewDecisionBlockReason =
  | "invalid_item"
  | "invalid_actor"
  | "channel_steward_required"
  | "channel_identity_mismatch"
  | "invalid_time"
  | "explicit_confirmation_required"
  | "decision_not_allowed"
  | "defer_until_required"
  | "defer_until_out_of_bounds"
  | "safety_flag_blocks_reply"
  | "non_severe_actionable_abuse_required"
  | "draft_requires_confirmed_actionable_abuse"
  | "draft_already_requested"
  | "decision_history_limit";

export type ReviewDecisionResult =
  | Readonly<{
      status: "applied";
      item: ReviewQueueItem;
      decision: ReviewDecisionProvenance;
      guidance?: SafetyEnforcementGuidance;
    }>
  | Readonly<{
      status: "opened_on_youtube";
      item: ReviewQueueItem;
      href: string;
    }>
  | Readonly<{
      status: "blocked";
      reason: ReviewDecisionBlockReason;
    }>;

const CLASSIFICATION_BY_CATEGORY: Record<
  ReviewAssessmentCategory,
  ReviewAssessmentClassification
> = {
  safety_flag: "Safety Flag",
  actionable_abuse: "Actionable Abuse",
  reviewable_interaction: "Reviewable Interaction",
  allowed_criticism: "Allowed Criticism",
};

const CATEGORY_BY_CLASSIFICATION: Record<
  ReviewAssessmentClassification,
  ReviewAssessmentCategory
> = {
  "Safety Flag": "safety_flag",
  "Actionable Abuse": "actionable_abuse",
  "Reviewable Interaction": "reviewable_interaction",
  "Allowed Criticism": "allowed_criticism",
};

const CATEGORY_PRIORITY: Record<ReviewQueueBucket, number> = {
  safety_flag: 0,
  actionable_abuse: 1,
  reviewable_interaction: 2,
  handled: 3,
};

const HANDLED_STATUSES = new Set<ReviewItemStatus>([
  "dismissed",
  "marked_criticism",
  "published",
  "deleted",
]);

const ACTIVE_STATUSES = new Set<ReviewItemStatus>([
  "reviewable",
  "actionable",
  "safety_flag",
  "draft_requested",
  "draft_ready",
  "stale",
  "failed",
  "publishing",
  "publication_uncertain",
]);

const REVIEW_ACTIONABLE_STATUSES = new Set<ReviewItemStatus>([
  "reviewable",
  "actionable",
  "safety_flag",
  "draft_requested",
  "draft_ready",
  "stale",
  "failed",
]);

const DRAFT_LIFECYCLE_STATUSES = new Set<ReviewItemStatus>([
  "draft_requested",
  "draft_ready",
  "stale",
  "publishing",
  "failed",
  "publication_uncertain",
]);

const SAFETY_ENFORCEMENT_ACTIONS: readonly SafetyEnforcementAction[] = [
  {
    id: "report-on-youtube",
    label: "Report on YouTube",
    href: "https://support.google.com/youtube/answer/2802027",
  },
  {
    id: "open-youtube-studio",
    label: "Open YouTube Studio",
    href: "https://studio.youtube.com/",
  },
  {
    id: "local-emergency-services",
    label: "Contact local emergency services if someone may be in immediate danger.",
  },
  {
    id: "trusted-crisis-service",
    label: "Contact local law enforcement or a trusted crisis service for the person's location.",
  },
];

function parseClassification(
  value: ReviewAssessmentClassificationInput,
): ReviewAssessmentClassification {
  if (ReviewAssessmentClassificationSchema.safeParse(value).success) {
    return value as ReviewAssessmentClassification;
  }
  const parsed = ReviewAssessmentCategorySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Review Assessment classification is invalid");
  }
  return CLASSIFICATION_BY_CATEGORY[parsed.data];
}

function categoryOf(classification: ReviewAssessmentClassification): ReviewAssessmentCategory {
  return CATEGORY_BY_CLASSIFICATION[classification];
}

function defaultStatus(classification: ReviewAssessmentClassification): ReviewItemStatus {
  switch (categoryOf(classification)) {
    case "safety_flag":
      return "safety_flag";
    case "actionable_abuse":
      return "actionable";
    case "allowed_criticism":
      return "marked_criticism";
    case "reviewable_interaction":
      return "reviewable";
  }
}

function assertAssessmentCoherence(assessment: ReviewAssessment): void {
  const category = categoryOf(assessment.classification);
  if (
    (category === "safety_flag" && assessment.severity !== "severe") ||
    (category !== "safety_flag" && assessment.severity === "severe")
  ) {
    throw new Error("Severe assessments must remain Safety Flags");
  }
  if (
    category === "actionable_abuse" &&
    (assessment.target !== "channel_steward" ||
      assessment.severity !== "non_severe" ||
      assessment.targetEvidence.length === 0 ||
      assessment.language === "other")
  ) {
    throw new Error("Actionable Abuse must be non-severe, eligible, and Steward-targeted");
  }
}

function assertStatusCoherence(
  assessment: ReviewAssessment,
  status: ReviewItemStatus,
): void {
  const category = categoryOf(assessment.classification);
  if (category === "allowed_criticism" && status !== "marked_criticism") {
    throw new Error("Allowed Criticism must be handled as marked criticism");
  }
  if (category === "safety_flag" && status === "actionable") {
    throw new Error("Safety Flags cannot become Actionable Abuse");
  }
  if (category === "safety_flag" && DRAFT_LIFECYCLE_STATUSES.has(status)) {
    throw new Error("Safety Flags cannot enter the reply lifecycle");
  }
  if (
    category !== "actionable_abuse" &&
    (status === "draft_requested" ||
      status === "draft_ready" ||
      status === "stale" ||
      status === "publishing" ||
      status === "publication_uncertain" ||
      status === "published")
  ) {
    throw new Error("Reply lifecycle states require Actionable Abuse");
  }
  if (status === "safety_flag" && category !== "safety_flag") {
    throw new Error("Only Safety Flags may use the safety_flag status");
  }
  if (status === "actionable" && category !== "actionable_abuse") {
    throw new Error("Only Actionable Abuse may use the actionable status");
  }
  if (status === "reviewable" && category !== "reviewable_interaction") {
    throw new Error("Only Reviewable Interactions may use the reviewable status");
  }
}

function cloneItem(item: ReviewQueueItem): ReviewQueueItem {
  return {
    ...item,
    video: { ...item.video },
    boundedContext: {
      ...item.boundedContext,
      neighboringReplies: [...item.boundedContext.neighboringReplies],
    },
    assessment: {
      ...item.assessment,
      targetEvidence: [...item.assessment.targetEvidence],
    },
    connectedYouTubeChannel: { ...item.connectedYouTubeChannel },
    publishingIdentity: { ...item.publishingIdentity },
    decisionHistory: item.decisionHistory.map((decision) => ({
      ...decision,
      from: { ...decision.from },
      to: { ...decision.to },
    })),
  };
}

function assertDecisionHistoryOwnership(item: ReviewQueueItem): void {
  for (const decision of item.decisionHistory) {
    if (
      decision.assessmentId !== item.assessmentId ||
      decision.interactionId !== item.interactionId ||
      decision.commentId !== item.commentId ||
      decision.channelId !== item.channelId ||
      decision.connectedChannelId !== item.connectedChannelId ||
      decision.commentTextHash !== item.commentTextHash
    ) {
      throw new Error("Review Decision provenance does not belong to the item");
    }
  }

  const lastDecision = item.decisionHistory[item.decisionHistory.length - 1];
  if (
    lastDecision &&
    (lastDecision.to.classification !==
      categoryOf(item.assessment.classification) ||
      lastDecision.to.status !== item.status ||
      lastDecision.to.deferredUntil !== item.deferredUntil)
  ) {
    throw new Error("Review Decision history does not describe the current item");
  }
}

function validateItem(item: ReviewQueueItem): void {
  assertAssessmentCoherence(item.assessment);
  assertStatusCoherence(item.assessment, item.status);
  assertDecisionHistoryOwnership(item);
}

function parseValidItem(value: unknown): ReviewQueueItem | null {
  const parsed = ReviewQueueItemSchema.safeParse(value);
  if (!parsed.success) return null;
  try {
    validateItem(parsed.data);
  } catch {
    return null;
  }
  return parsed.data;
}

export function createReviewQueueItem(
  input: CreateReviewQueueItemInput,
): ReviewQueueItem {
  const classification = parseClassification(input.assessment.classification);
  const assessment: ReviewAssessment = ReviewAssessmentSchema.parse({
    ...input.assessment,
    classification,
  });
  assertAssessmentCoherence(assessment);

  const status = input.status ?? defaultStatus(classification);
  assertStatusCoherence(assessment, status);

  const boundedContext: BoundedReviewContext = BoundedContextSchema.parse(
    input.boundedContext,
  );
  const item = ReviewQueueItemSchema.parse({
    assessmentId: input.assessmentId,
    interactionId: input.interactionId,
    commentId: input.commentId,
    commentTextHash: input.commentTextHash,
    channelId: input.channelId,
    connectedChannelId: input.connectedChannelId,
    video: input.video,
    boundedContext,
    assessment,
    status,
    deferredUntil: input.deferredUntil ?? null,
    connectedYouTubeChannel: input.connectedYouTubeChannel,
    publishingIdentity: input.publishingIdentity,
    decisionHistory: input.decisionHistory ?? [],
  });

  if (item.connectedYouTubeChannel.id !== item.connectedChannelId) {
    throw new Error("Connected YouTube Channel identity does not match the item");
  }
  if (item.publishingIdentity.id !== item.connectedChannelId) {
    throw new Error("Publishing identity does not match the item");
  }

  assertDecisionHistoryOwnership(item);

  return cloneItem(item);
}

function parseAt(value: Date | undefined): Date | null {
  const at = value ?? new Date();
  return Number.isNaN(at.getTime()) ? null : at;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFutureDeferred(item: ReviewQueueItem, at: Date): boolean {
  return (
    item.deferredUntil !== null && timestamp(item.deferredUntil) > at.getTime()
  );
}

function queueBucket(item: ReviewQueueItem, at: Date): ReviewQueueBucket {
  if (HANDLED_STATUSES.has(item.status) || isFutureDeferred(item, at)) {
    return "handled";
  }
  return categoryOf(item.assessment.classification) as Exclude<
    ReviewQueueBucket,
    "handled"
  >;
}

function queueTimestamp(item: ReviewQueueItem, bucket: ReviewQueueBucket): number {
  if (bucket === "handled" && item.decisionHistory.length > 0) {
    return timestamp(item.decisionHistory[item.decisionHistory.length - 1].recordedAt);
  }
  return timestamp(item.assessment.assessedAt);
}

function statusForFilter(
  item: ReviewQueueItem,
  at: Date,
): ReviewQueueFilterStatus {
  if (isFutureDeferred(item, at)) return "deferred";
  if (HANDLED_STATUSES.has(item.status)) return "handled";
  return item.status;
}

function matchesFilter(
  item: ReviewQueueItem,
  options: ReviewQueueProjectionOptions,
  at: Date,
): boolean {
  if (options.videoId !== undefined && item.video.id !== options.videoId) {
    return false;
  }
  if (
    options.assessment !== undefined &&
    categoryOf(item.assessment.classification) !==
      (ReviewAssessmentCategorySchema.safeParse(options.assessment).success
        ? options.assessment
        : CATEGORY_BY_CLASSIFICATION[
            options.assessment as ReviewAssessmentClassification
          ])
  ) {
    return false;
  }
  if (options.status === undefined) return true;
  if (options.status === "handled") {
    return queueBucket(item, at) === "handled";
  }
  return statusForFilter(item, at) === options.status;
}

export function projectReviewQueue(
  items: readonly ReviewQueueItem[],
  options: ReviewQueueProjectionOptions = {},
): readonly ReviewQueueItem[] {
  const at = parseAt(options.now) ?? new Date(0);
  return items
    .map(parseValidItem)
    .filter((item): item is ReviewQueueItem => item !== null)
    .filter((item) => matchesFilter(item, options, at))
    .map(cloneItem)
    .sort((left, right) => {
      const leftBucket = queueBucket(left, at);
      const rightBucket = queueBucket(right, at);
      const bucketDifference =
        CATEGORY_PRIORITY[leftBucket] - CATEGORY_PRIORITY[rightBucket];
      if (bucketDifference !== 0) return bucketDifference;
      return (
        queueTimestamp(right, rightBucket) - queueTimestamp(left, leftBucket) ||
        left.assessmentId.localeCompare(right.assessmentId)
      );
    });
}

function youtubeInteractionUrl(item: ReviewQueueItem): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(
    item.video.id,
  )}&lc=${encodeURIComponent(item.commentId)}`;
}

function hasConfirmedActionableAbuse(item: ReviewQueueItem, at: Date): boolean {
  return item.decisionHistory.some(
    (decision) =>
      decision.action === "confirm_actionable_abuse" &&
      decision.to.classification === "actionable_abuse" &&
      decision.to.status === "actionable" &&
      timestamp(decision.expiresAt) > at.getTime(),
  );
}

function canConfirmActionableAbuse(item: ReviewQueueItem): boolean {
  return (
    (item.status === "reviewable" || item.status === "actionable") &&
    (item.assessment.classification === "Reviewable Interaction" ||
      item.assessment.classification === "Actionable Abuse") &&
    item.assessment.target === "channel_steward" &&
    item.assessment.severity === "non_severe" &&
    item.assessment.language !== "other" &&
    item.assessment.targetEvidence.length > 0
  );
}

function canDismissOrDefer(item: ReviewQueueItem): boolean {
  return REVIEW_ACTIONABLE_STATUSES.has(item.status);
}

export function buildReviewItemPresentation(
  item: ReviewQueueItem,
  now: Date = new Date(),
): ReviewItemPresentation {
  const parsed = ReviewQueueItemSchema.parse(item);
  validateItem(parsed);
  const at = parseAt(now) ?? new Date(0);
  const category = categoryOf(parsed.assessment.classification);
  const actions: ReviewItemAction[] = [];

  if (canDismissOrDefer(parsed)) {
    actions.push(
      { action: "dismiss", label: "Dismiss" },
      { action: "defer", label: "Defer" },
    );
  }
  if (category !== "safety_flag" && canDismissOrDefer(parsed)) {
    actions.push({
      action: "mark_allowed_criticism",
      label: "Mark as Allowed Criticism",
    });
  }
  if (category !== "safety_flag" && canConfirmActionableAbuse(parsed)) {
    actions.push({
      action: "confirm_actionable_abuse",
      label: "Confirm Actionable Abuse",
    });
  }
  if (
    category === "actionable_abuse" &&
    parsed.status === "actionable" &&
    !isFutureDeferred(parsed, at) &&
    hasConfirmedActionableAbuse(parsed, at)
  ) {
    actions.push({ action: "request_draft", label: "Request draft" });
  }
  if (category === "safety_flag" && ACTIVE_STATUSES.has(parsed.status)) {
    actions.push({
      action: "continue_safety_enforcement",
      label: "Continue with safety guidance",
    });
  }

  const href = youtubeInteractionUrl(parsed);
  actions.push({ action: "open_on_youtube", label: "Open on YouTube", href });

  return {
    id: parsed.assessmentId,
    assessmentId: parsed.assessmentId,
    interactionId: parsed.interactionId,
    boundedContext: {
      ...parsed.boundedContext,
      neighboringReplies: [...parsed.boundedContext.neighboringReplies],
    },
    video: { ...parsed.video },
    connectedYouTubeChannel: { ...parsed.connectedYouTubeChannel },
    currentAssessment: {
      label: INTERACTION_ASSESSMENT_LABEL,
      classification: parsed.assessment.classification,
      target: parsed.assessment.target,
      severity: parsed.assessment.severity,
      status: isFutureDeferred(parsed, at) ? "deferred" : parsed.status,
    },
    intendedPublishingIdentity: { ...parsed.publishingIdentity },
    openOnYouTube: { action: "open_on_youtube", href },
    actions,
  };
}

function stateOf(item: ReviewQueueItem): ReviewDecisionState {
  return {
    classification: categoryOf(item.assessment.classification),
    status: item.status,
    deferredUntil: item.deferredUntil,
  };
}

function blocked(reason: ReviewDecisionBlockReason): ReviewDecisionResult {
  return { status: "blocked", reason };
}

function isTerminal(item: ReviewQueueItem): boolean {
  return item.status === "published" || item.status === "deleted";
}

function decisionFingerprint(
  item: ReviewQueueItem,
  command: ReviewDecisionCommand,
  at: Date,
): string {
  const source = [
    item.assessmentId,
    item.interactionId,
    item.commentId,
    item.commentTextHash,
    command.action,
    at.toISOString(),
    String(item.decisionHistory.length),
  ].join("|");
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeDecision(
  item: ReviewQueueItem,
  actor: ReviewDecisionActor,
  command: ReviewDecisionCommand,
  from: ReviewDecisionState,
  to: ReviewDecisionState,
  at: Date,
  versions: ReviewDecisionVersions,
): ReviewDecisionProvenance {
  const decisionId =
    command.decisionId?.trim() ||
    `review-decision:${at.getTime()}:${command.action}:${
      item.decisionHistory.length + 1
    }:${decisionFingerprint(item, command, at)}`;
  return ReviewDecisionProvenanceSchema.parse({
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    decisionId,
    action: command.action,
    stateChanged:
      from.classification !== to.classification ||
      from.status !== to.status ||
      from.deferredUntil !== to.deferredUntil,
    actorRole: actor.role,
    stewardId: actor.stewardId,
    assessmentId: item.assessmentId,
    interactionId: item.interactionId,
    commentId: item.commentId,
    channelId: item.channelId,
    connectedChannelId: item.connectedChannelId,
    commentTextHash: item.commentTextHash,
    from,
    to,
    assessmentVersion: versions.assessmentVersion,
    taxonomyVersion: versions.taxonomyVersion,
    validatorVersion: versions.validatorVersion,
    recordedAt: at.toISOString(),
    expiresAt: addRetentionDays(at).toISOString(),
  });
}

export type ReviewDecisionVersions = Readonly<{
  assessmentVersion: string;
  taxonomyVersion: string;
  validatorVersion: string;
}>;

export type ApplyReviewDecisionInput = Readonly<{
  item: ReviewQueueItem;
  actor: ReviewDecisionActor;
  command: ReviewDecisionCommand;
  at?: Date;
  versions?: Partial<ReviewDecisionVersions>;
}>;

function nextItem(
  item: ReviewQueueItem,
  assessment: ReviewAssessment,
  status: ReviewItemStatus,
  deferredUntil: string | null,
): ReviewQueueItem {
  assertAssessmentCoherence(assessment);
  assertStatusCoherence(assessment, status);
  return ReviewQueueItemSchema.parse({
    ...item,
    assessment,
    status,
    deferredUntil,
    boundedContext:
      categoryOf(assessment.classification) === "allowed_criticism"
        ? {
            candidateText: null,
            topLevelCommentText: null,
            neighboringReplies: [],
          }
        : item.boundedContext,
  });
}

export function applyReviewDecision(
  input: ApplyReviewDecisionInput,
): ReviewDecisionResult {
  const item = parseValidItem(input.item);
  if (!item) return blocked("invalid_item");
  if (
    input.actor &&
    typeof (input.actor as { role?: unknown }).role === "string" &&
    (input.actor as { role: string }).role !== "channel_steward"
  ) {
    return blocked("channel_steward_required");
  }
  const actor = ReviewDecisionActorSchema.safeParse(input.actor);
  if (!actor.success) return blocked("invalid_actor");
  if (actor.data.role !== "channel_steward") {
    return blocked("channel_steward_required");
  }

  if (
    actor.data.channelId !== item.channelId ||
    actor.data.connectedChannelId !== item.connectedChannelId ||
    item.publishingIdentity.id !== item.connectedChannelId
  ) {
    return blocked("channel_identity_mismatch");
  }

  const command = ReviewDecisionCommandSchema.safeParse(input.command);
  if (!command.success) return blocked("decision_not_allowed");
  const at = parseAt(input.at);
  if (!at) return blocked("invalid_time");
  const data = command.data;

  if (data.action === "open_on_youtube") {
    return {
      status: "opened_on_youtube",
      item: cloneItem(item),
      href: youtubeInteractionUrl(item),
    };
  }
  if (data.confirmed !== true) return blocked("explicit_confirmation_required");
  if (item.decisionHistory.length >= MAX_REVIEW_DECISION_HISTORY) {
    return blocked("decision_history_limit");
  }

  const category = categoryOf(item.assessment.classification);
  const currentState = stateOf(item);
  let updatedAssessment = item.assessment;
  let updatedStatus = item.status;
  let updatedDeferredUntil = item.deferredUntil;
  let guidance: SafetyEnforcementGuidance | undefined;

  switch (data.action) {
    case "dismiss":
      if (isTerminal(item) || HANDLED_STATUSES.has(item.status)) {
        return blocked("decision_not_allowed");
      }
      updatedStatus = "dismissed";
      updatedDeferredUntil = null;
      break;

    case "defer": {
      if (isTerminal(item) || !ACTIVE_STATUSES.has(item.status)) {
        return blocked("decision_not_allowed");
      }
      if (!data.deferUntil) return blocked("defer_until_required");
      const deferUntil = new Date(data.deferUntil);
      const expiresAt = addRetentionDays(at);
      if (
        Number.isNaN(deferUntil.getTime()) ||
        deferUntil.getTime() <= at.getTime()
      ) {
        return blocked("defer_until_out_of_bounds");
      }
      if (deferUntil.getTime() > expiresAt.getTime()) {
        return blocked("defer_until_out_of_bounds");
      }
      updatedDeferredUntil = deferUntil.toISOString();
      break;
    }

    case "mark_allowed_criticism":
      if (
        category === "safety_flag" ||
        isTerminal(item) ||
        HANDLED_STATUSES.has(item.status)
      ) {
        return blocked("decision_not_allowed");
      }
      updatedAssessment = {
        ...item.assessment,
        classification: "Allowed Criticism",
      };
      updatedStatus = "marked_criticism";
      updatedDeferredUntil = null;
      break;

    case "confirm_actionable_abuse":
      if (category === "safety_flag") {
        return blocked("safety_flag_blocks_reply");
      }
      if (isTerminal(item) || !canConfirmActionableAbuse(item)) {
        return blocked("non_severe_actionable_abuse_required");
      }
      updatedAssessment = {
        ...item.assessment,
        classification: "Actionable Abuse",
        target: "channel_steward",
        severity: "non_severe",
      };
      updatedStatus = "actionable";
      updatedDeferredUntil = null;
      break;

    case "continue_safety_enforcement":
      if (
        category !== "safety_flag" ||
        !ACTIVE_STATUSES.has(item.status)
      ) {
        return blocked("decision_not_allowed");
      }
      guidance = {
        kind: "safety_enforcement_guidance",
        replyDraftAvailable: false,
        automaticEnforcementAvailable: false,
        actions: SAFETY_ENFORCEMENT_ACTIONS.map((action) => ({ ...action })),
      };
      break;

    case "request_draft":
      if (category === "safety_flag") {
        return blocked("safety_flag_blocks_reply");
      }
      if (category !== "actionable_abuse") {
        return blocked("draft_requires_confirmed_actionable_abuse");
      }
      if (item.status === "draft_requested" || item.status === "draft_ready") {
        return blocked("draft_already_requested");
      }
      if (
        item.status !== "actionable" ||
        isFutureDeferred(item, at) ||
        item.assessment.severity !== "non_severe" ||
        item.assessment.target !== "channel_steward" ||
        item.assessment.language === "other" ||
        item.assessment.targetEvidence.length === 0 ||
        !hasConfirmedActionableAbuse(item, at)
      ) {
        return blocked("draft_requires_confirmed_actionable_abuse");
      }
      updatedStatus = "draft_requested";
      updatedDeferredUntil = null;
      break;
  }

  const candidateItem = nextItem(
    item,
    updatedAssessment,
    updatedStatus,
    updatedDeferredUntil,
  );
  const versions: ReviewDecisionVersions = {
    assessmentVersion:
      input.versions?.assessmentVersion ?? REVIEW_ASSESSMENT_VERSION,
    taxonomyVersion: input.versions?.taxonomyVersion ?? REVIEW_TAXONOMY_VERSION,
    validatorVersion:
      input.versions?.validatorVersion ?? REVIEW_VALIDATOR_VERSION,
  };
  const decision = makeDecision(
    item,
    actor.data,
    data,
    currentState,
    stateOf(candidateItem),
    at,
    versions,
  );
  const updatedItem = ReviewQueueItemSchema.parse({
    ...candidateItem,
    decisionHistory: [...item.decisionHistory, decision],
  });

  return {
    status: "applied",
    item: cloneItem(updatedItem),
    decision,
    ...(guidance ? { guidance } : {}),
  };
}
