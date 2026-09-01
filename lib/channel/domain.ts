import { z } from "zod";

/**
 * Offline Channel contract. The only accepted data source in this tracer is
 * synthetic or separately governed data; adapters never cross this seam with
 * provider transport records.
 */

const NonEmptyTextSchema = z.string().trim().min(1).max(240);
const DomainIdSchema = z.string().min(1).max(240);
const InstantSchema = z.string().datetime({ offset: true });

export const CHANNEL_HUB_LABEL = "Channel Hub" as const;
export const CHANNEL_LABEL = "Channel" as const;
export const CHANNEL_STEWARD_LABEL = "Channel Steward" as const;
export const CONNECTED_YOUTUBE_CHANNEL_LABEL =
  "Connected YouTube Channel" as const;
export const SCAN_RUN_LABEL = "Scan Run" as const;
export const INTERACTION_ASSESSMENT_LABEL =
  "Interaction Assessment" as const;
export const REVIEW_QUEUE_LABEL = "Review Queue" as const;

export const CHANNEL_REPLY_DRAFT_SCHEMA_VERSION =
  "channel-reply-draft-v1" as const;
export const CHANNEL_REPLY_DRAFT_PROMPT_VERSION =
  "channel-reply-draft-prompt-v1" as const;
export const CHANNEL_REPLY_DRAFT_VALIDATOR_VERSION =
  "channel-reply-draft-validator-v1" as const;
export const CHANNEL_REPLY_DRAFT_PRIVATE_DISCLOSURE =
  "AI-assisted draft. Review and edit before publishing." as const;

export const ChannelInteractionLanguageSchema = z.enum([
  "en",
  "english",
  "zh-Hans",
  "simplified_chinese",
  "zh-Hant",
  "traditional_chinese",
  "zh-code-switch",
  "chinese_english_code_switch",
]);
export type ChannelInteractionLanguage = z.infer<
  typeof ChannelInteractionLanguageSchema
>;

export const ChannelGovernanceSchema = z
  .object({
    source: z.literal("synthetic"),
    corpusVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export type ChannelGovernance = z.infer<typeof ChannelGovernanceSchema>;

export type ChannelPrincipal = Readonly<{
  userId: string;
  isAnonymous: boolean;
}>;

export const SyntheticConnectedChannelDefinitionSchema = z
  .object({
    channelKey: NonEmptyTextSchema,
    displayName: NonEmptyTextSchema,
    governance: ChannelGovernanceSchema,
  })
  .strict();
export type SyntheticConnectedChannelDefinition = z.infer<
  typeof SyntheticConnectedChannelDefinitionSchema
>;

export const ChannelSchema = z
  .object({
    id: DomainIdSchema,
    stewardId: DomainIdSchema,
    activeConnectedChannelId: DomainIdSchema,
    governance: ChannelGovernanceSchema,
  })
  .strict();
export type Channel = z.infer<typeof ChannelSchema>;

export const ChannelStewardSchema = z
  .object({
    id: DomainIdSchema,
    principalId: NonEmptyTextSchema,
    channelId: DomainIdSchema,
    adultAttested: z.literal(true),
  })
  .strict();
export type ChannelSteward = z.infer<typeof ChannelStewardSchema>;

export const ChannelPrivateAiAssistanceSchema = z
  .object({
    disclosed: z.literal(true),
    label: z.literal("AI assistance"),
    disclosure: z.literal(CHANNEL_REPLY_DRAFT_PRIVATE_DISCLOSURE),
    audience: z.literal("channel_steward"),
    includedInPublicReply: z.literal(false),
  })
  .strict();
export type ChannelPrivateAiAssistance = z.infer<
  typeof ChannelPrivateAiAssistanceSchema
>;

export const ChannelReplyDraftSchema = z
  .object({
    schemaVersion: z.literal(CHANNEL_REPLY_DRAFT_SCHEMA_VERSION),
    id: DomainIdSchema,
    assessmentId: DomainIdSchema,
    channelId: DomainIdSchema,
    connectedChannelId: DomainIdSchema,
    stewardPrincipalId: NonEmptyTextSchema,
    interactionLanguage: ChannelInteractionLanguageSchema,
    generatedText: z.string().trim().min(1).max(600),
    text: z.string().trim().min(1).max(600),
    status: z.enum(["ready", "edited"]),
    validation: z.enum(["passed", "pending"]),
    visibility: z.literal("private"),
    editable: z.literal(true),
    aiAssistance: ChannelPrivateAiAssistanceSchema,
    promptVersion: z.literal(CHANNEL_REPLY_DRAFT_PROMPT_VERSION),
    validatorVersion: z.literal(CHANNEL_REPLY_DRAFT_VALIDATOR_VERSION),
    generatedAt: InstantSchema,
    updatedAt: InstantSchema,
  })
  .strict();
export type ChannelReplyDraft = z.infer<typeof ChannelReplyDraftSchema>;

export const SyntheticChannelIdentitySchema = z
  .object({
    kind: z.literal("synthetic"),
    key: NonEmptyTextSchema,
  })
  .strict();

export const ConnectedYouTubeChannelSchema = z
  .object({
    id: DomainIdSchema,
    channelId: DomainIdSchema,
    stewardId: DomainIdSchema,
    identity: SyntheticChannelIdentitySchema,
    displayName: NonEmptyTextSchema,
    active: z.literal(true),
    governance: ChannelGovernanceSchema,
  })
  .strict();
export type ConnectedYouTubeChannel = z.infer<
  typeof ConnectedYouTubeChannelSchema
>;

export const ChannelVideoSchema = z
  .object({
    id: NonEmptyTextSchema,
    title: NonEmptyTextSchema,
  })
  .strict();
export type ChannelVideo = z.infer<typeof ChannelVideoSchema>;

export const ChannelInteractionSchema = z
  .object({
    id: DomainIdSchema,
    connectedChannelId: DomainIdSchema,
    video: ChannelVideoSchema,
    text: z.string().trim().min(1).max(4_000),
    target: z.enum(["channel_steward", "other", "ambiguous"]),
    behavior: z.enum([
      "direct_insult",
      "content_criticism",
      "ambiguous",
      "severe_threat",
    ]),
    observedAt: InstantSchema,
    governance: ChannelGovernanceSchema,
  })
  .strict();
export type ChannelInteraction = z.infer<typeof ChannelInteractionSchema>;

export type ChannelScanRequest = Readonly<{
  connectedChannelId: string;
  channelKey: string;
  stewardPrincipalId: string;
  mode: "deliberate";
  window: "recent_seven_days";
}>;

export type ChannelProviderKind = "synthetic" | "separately_governed";

export interface ChannelActivityProvider {
  readonly kind: ChannelProviderKind;
  scan(request: ChannelScanRequest): Promise<readonly ChannelInteraction[]>;
}

export const ChannelAssessmentCategorySchema = z.enum([
  "Actionable Abuse",
  "Reviewable Interaction",
  "Allowed Criticism",
  "Safety Flag",
]);
export type ChannelAssessmentCategory = z.infer<
  typeof ChannelAssessmentCategorySchema
>;

export const ChannelAssessmentTargetSchema = z.enum([
  "channel_steward",
  "other",
  "ambiguous",
]);
export type ChannelAssessmentTarget = z.infer<
  typeof ChannelAssessmentTargetSchema
>;

export const ChannelAssessmentSeveritySchema = z.enum([
  "non_severe",
  "severe",
]);
export type ChannelAssessmentSeverity = z.infer<
  typeof ChannelAssessmentSeveritySchema
>;

export const ChannelAssessmentDecisionSchema = z
  .object({
    classification: ChannelAssessmentCategorySchema,
    target: ChannelAssessmentTargetSchema,
    severity: ChannelAssessmentSeveritySchema,
  })
  .strict();
export type ChannelAssessmentDecision = z.infer<
  typeof ChannelAssessmentDecisionSchema
>;

export type ChannelAssessmentInput = Readonly<{
  interaction: ChannelInteraction;
  channelId: string;
  connectedChannelId: string;
  scanRunId: string;
  mode: "deliberate";
  window: "recent_seven_days";
}>;

export interface ChannelAssessmentProvider {
  readonly kind: ChannelProviderKind;
  assess(input: ChannelAssessmentInput): Promise<ChannelAssessmentDecision>;
}

export const ScanRunCoverageSchema = z
  .object({
    window: z.literal("recent_seven_days"),
    interactionsDiscovered: z.number().int().min(0).max(200),
    assessmentsCreated: z.number().int().min(0).max(200),
    reviewItemsCreated: z.number().int().min(0).max(200),
    allowedCriticismCount: z.number().int().min(0).max(200),
  })
  .strict();
export type ScanRunCoverage = z.infer<typeof ScanRunCoverageSchema>;

export const ScanRunSchema = z
  .object({
    id: DomainIdSchema,
    channelId: DomainIdSchema,
    connectedChannelId: DomainIdSchema,
    stewardId: DomainIdSchema,
    mode: z.literal("deliberate"),
    status: z.literal("completed"),
    startedAt: InstantSchema,
    completedAt: InstantSchema,
    coverage: ScanRunCoverageSchema,
  })
  .strict();
export type ScanRun = z.infer<typeof ScanRunSchema>;

export const QueuedAssessmentCategorySchema = z.enum([
  "Actionable Abuse",
  "Reviewable Interaction",
  "Safety Flag",
]);
export type QueuedAssessmentCategory = z.infer<
  typeof QueuedAssessmentCategorySchema
>;

export const InteractionAssessmentSchema = z
  .object({
    id: DomainIdSchema,
    channelId: DomainIdSchema,
    connectedChannelId: DomainIdSchema,
    scanRunId: DomainIdSchema,
    interactionId: DomainIdSchema,
    video: ChannelVideoSchema,
    text: z.string().trim().min(1).max(4_000),
    classification: QueuedAssessmentCategorySchema,
    target: ChannelAssessmentTargetSchema,
    severity: ChannelAssessmentSeveritySchema,
    status: z.literal("awaiting_review"),
    replyDraft: ChannelReplyDraftSchema.nullable(),
    assessedAt: InstantSchema,
    governance: ChannelGovernanceSchema,
  })
  .strict();
export type InteractionAssessment = z.infer<
  typeof InteractionAssessmentSchema
>;

export const ReviewQueueItemSchema = z
  .object({
    id: DomainIdSchema,
    assessmentId: DomainIdSchema,
    interactionId: DomainIdSchema,
    video: ChannelVideoSchema,
    interactionText: z.string().trim().min(1).max(4_000),
    interactionAssessment: z
      .object({
        label: z.literal(INTERACTION_ASSESSMENT_LABEL),
        classification: QueuedAssessmentCategorySchema,
        status: z.literal("awaiting_review"),
      })
      .strict(),
    replyDraft: ChannelReplyDraftSchema.nullable(),
    status: z.literal("awaiting_review"),
  })
  .strict();
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;

export const ReviewQueueSchema = z
  .object({
    id: DomainIdSchema,
    channelId: DomainIdSchema,
    connectedChannelId: DomainIdSchema,
    items: z.array(ReviewQueueItemSchema).max(200),
  })
  .strict();
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;

export const ChannelJourneySnapshotSchema = z
  .object({
    channel: ChannelSchema,
    channelSteward: ChannelStewardSchema,
    connectedYouTubeChannel: ConnectedYouTubeChannelSchema,
    scanRun: ScanRunSchema,
    interactionAssessments: z
      .array(InteractionAssessmentSchema)
      .max(200),
    reviewQueue: ReviewQueueSchema,
  })
  .strict();
export type ChannelJourneySnapshot = z.infer<
  typeof ChannelJourneySnapshotSchema
>;

export interface ChannelPersistence {
  saveJourney(snapshot: ChannelJourneySnapshot): Promise<void>;
  loadChannelHub(
    principalId: string,
  ): Promise<ChannelJourneySnapshot | null>;
}
