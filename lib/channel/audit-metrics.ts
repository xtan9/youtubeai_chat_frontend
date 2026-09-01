import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Content-free Channel audit and observation contract.
 *
 * This module deliberately does not import a provider, persistence adapter, or
 * Channel UI. Its audit seam keeps the identifiers needed to reconcile one
 * bounded reply lifecycle, while its observation seam stores only aggregate
 * facts. Comment text, draft text, author identity, and Safety Flag evidence
 * never appear in either output shape.
 */

export const CHANNEL_AUDIT_RETENTION_DAYS = 30 as const;
export const CHANNEL_REPLY_CONTROL_RETENTION_DAYS = 30 as const;
export const CHANNEL_METRIC_MIN_REVIEWED_ASSESSMENTS = 50 as const;
export const CHANNEL_METRIC_MIN_ELIGIBLE_PUBLIC_REPLIES = 20 as const;
export const CHANNEL_METRIC_OBSERVATION_WINDOW_DAYS = [7, 30] as const;
export const CHANNEL_MATERIAL_REWRITE_THRESHOLD = 0.3 as const;

export const CHANNEL_AUDIT_SCHEMA_VERSION = "channel-audit-v1" as const;
export const CHANNEL_REPLY_CONTROL_SCHEMA_VERSION =
  "channel-reply-control-v1" as const;
export const CHANNEL_OBSERVATION_SCHEMA_VERSION =
  "channel-observation-v1" as const;

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_REWRITE_COMPARISON_CHARS = 4_000;
const IdSchema = z.string().trim().min(1).max(240);
const VersionSchema = z.string().trim().min(1).max(120);
const CommentTextHashSchema = z.union([
  z.string().regex(/^[a-f0-9]{64}$/),
  // The synthetic publication adapter uses this bounded, non-cryptographic
  // format until a separately governed provider supplies its approved hash.
  z.string().regex(/^fnv1a32:[a-f0-9]{8}$/),
]);
const InstantSchema = z.string().datetime({ offset: true });
const NullableInstantSchema = InstantSchema.nullable();

/** SHA-256 is computed over the exact provider comment text, without trim. */
export function hashChannelCommentText(text: string): string {
  if (typeof text !== "string") {
    throw new TypeError("comment text must be a string");
  }
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Keep the name used by the adjacent publication contracts available at this
// seam without importing their not-yet-merged implementation.
export const hashCommentText = hashChannelCommentText;

export const ChannelAuditEventTypeSchema = z.enum([
  "assessment",
  "review_decision",
  "draft",
  "publication",
  "reconciliation",
  "deletion",
]);
export type ChannelAuditEventType = z.infer<
  typeof ChannelAuditEventTypeSchema
>;

export const ChannelAuditReviewDecisionActionSchema = z.enum([
  "dismiss",
  "defer",
  "mark_allowed_criticism",
  "confirm_actionable_abuse",
  "continue_safety_enforcement",
  "request_draft",
]);
export type ChannelAuditReviewDecisionAction = z.infer<
  typeof ChannelAuditReviewDecisionActionSchema
>;

export const ChannelAuditReviewStatusSchema = z.enum([
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
export type ChannelAuditReviewStatus = z.infer<
  typeof ChannelAuditReviewStatusSchema
>;

/** The decision is a safe summary; it intentionally has no reviewer identity. */
export const ChannelAuditReviewDecisionSchema = z
  .object({
    decisionId: IdSchema,
    action: ChannelAuditReviewDecisionActionSchema,
    status: ChannelAuditReviewStatusSchema,
  })
  .strict();
export type ChannelAuditReviewDecision = z.infer<
  typeof ChannelAuditReviewDecisionSchema
>;

/** The provider identity needed to explain who published a reply. */
export const ChannelAuditPublicationIdentitySchema = z
  .object({
    channelId: IdSchema,
    connectedChannelId: IdSchema,
    grantId: IdSchema,
    providerChannelId: IdSchema,
  })
  .strict();
export type ChannelAuditPublicationIdentity = z.infer<
  typeof ChannelAuditPublicationIdentitySchema
>;

export const ChannelAuditDeletionOutcomeSchema = z.enum([
  "requested",
  "in_progress",
  "completed",
  "failed",
  "uncertain",
]);
export type ChannelAuditDeletionOutcome = z.infer<
  typeof ChannelAuditDeletionOutcomeSchema
>;

export const ChannelAuditReconciliationOutcomeSchema = z.enum([
  "verified_presence",
  "verified_absence",
  "continued_uncertainty",
]);
export type ChannelAuditReconciliationOutcome = z.infer<
  typeof ChannelAuditReconciliationOutcomeSchema
>;

export const ChannelAuditProvenanceSchema = z
  .object({
    schemaVersion: z.literal(CHANNEL_AUDIT_SCHEMA_VERSION),
    eventId: IdSchema,
    eventType: ChannelAuditEventTypeSchema,
    channelId: IdSchema,
    connectedChannelId: IdSchema,
    commentId: IdSchema,
    commentTextHash: CommentTextHashSchema,
    model: VersionSchema,
    promptVersion: VersionSchema,
    taxonomyVersion: VersionSchema,
    validatorVersion: VersionSchema,
    reviewDecision: ChannelAuditReviewDecisionSchema.nullable(),
    publicationIdentity: ChannelAuditPublicationIdentitySchema.nullable(),
    providerReplyId: IdSchema.nullable(),
    publishedAt: NullableInstantSchema,
    deletionOutcome: ChannelAuditDeletionOutcomeSchema.nullable(),
    reconciliationOutcome: ChannelAuditReconciliationOutcomeSchema.nullable(),
    recordedAt: InstantSchema,
    expiresAt: InstantSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const publicationFields = [
      record.publicationIdentity !== null,
      record.providerReplyId !== null,
      record.publishedAt !== null,
    ];
    const publicationIsComplete = publicationFields.every(Boolean);
    const publicationIsAbsent = publicationFields.every((value) => !value);
    if (!publicationIsComplete && !publicationIsAbsent) {
      context.addIssue({
        code: "custom",
        path: ["publicationIdentity"],
        message: "publication identity, provider reply ID, and time are atomic",
      });
    }

    if (
      record.publicationIdentity &&
      (record.publicationIdentity.channelId !== record.channelId ||
        record.publicationIdentity.connectedChannelId !==
          record.connectedChannelId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicationIdentity"],
        message: "publication identity must belong to the audited Channel",
      });
    }
    if (
      record.publishedAt !== null &&
      new Date(record.publishedAt).getTime() >
        new Date(record.recordedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "publication time cannot be after the audit record",
      });
    }

    const recordedAt = new Date(record.recordedAt);
    const expiresAt = new Date(record.expiresAt);
    const maximumExpiry = addRetentionDays(
      recordedAt,
      CHANNEL_AUDIT_RETENTION_DAYS,
    );
    if (
      !Number.isFinite(recordedAt.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= recordedAt.getTime() ||
      expiresAt.getTime() > maximumExpiry.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "audit provenance must expire within 30 calendar days",
      });
    }
  });
export type ChannelAuditProvenance = z.infer<
  typeof ChannelAuditProvenanceSchema
>;

export type CreateChannelAuditProvenanceInput = Readonly<{
  eventId: string;
  eventType: ChannelAuditEventType;
  channelId: string;
  connectedChannelId: string;
  commentId: string;
  commentTextHash: string;
  model: string;
  promptVersion: string;
  taxonomyVersion: string;
  validatorVersion: string;
  reviewDecision?: ChannelAuditReviewDecision | null;
  publicationIdentity?: ChannelAuditPublicationIdentity | null;
  providerReplyId?: string | null;
  publishedAt?: string | Date | null;
  deletionOutcome?: ChannelAuditDeletionOutcome | null;
  reconciliationOutcome?: ChannelAuditReconciliationOutcome | null;
  recordedAt: string | Date;
  expiresAt?: string | Date;
}>;

export const ChannelReplyControlStatusSchema = z.enum(["active", "deleted"]);
export type ChannelReplyControlStatus = z.infer<
  typeof ChannelReplyControlStatusSchema
>;

export const ChannelReplyControlProvenanceSchema = z
  .object({
    schemaVersion: z.literal(CHANNEL_REPLY_CONTROL_SCHEMA_VERSION),
    controlId: IdSchema,
    channelId: IdSchema,
    connectedChannelId: IdSchema,
    commentId: IdSchema,
    commentTextHash: CommentTextHashSchema,
    providerReplyId: IdSchema,
    publicationIdentity: ChannelAuditPublicationIdentitySchema,
    publishedAt: InstantSchema,
    status: ChannelReplyControlStatusSchema,
    grantStatus: z.enum(["active", "revoked"]),
    provenanceStatus: z.enum(["active", "removed"]),
    lastRefreshedAt: InstantSchema,
    expiresAt: InstantSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.publicationIdentity.channelId !== record.channelId ||
      record.publicationIdentity.connectedChannelId !==
        record.connectedChannelId
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicationIdentity"],
        message: "reply control identity must belong to the controlled Channel",
      });
    }
    if (
      new Date(record.publishedAt).getTime() >
      new Date(record.lastRefreshedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastRefreshedAt"],
        message: "reply control cannot be refreshed before publication",
      });
    }

    const refreshedAt = new Date(record.lastRefreshedAt);
    const expiresAt = new Date(record.expiresAt);
    const maximumExpiry = addRetentionDays(
      refreshedAt,
      CHANNEL_REPLY_CONTROL_RETENTION_DAYS,
    );
    if (
      !Number.isFinite(refreshedAt.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= refreshedAt.getTime() ||
      expiresAt.getTime() > maximumExpiry.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "reply-control provenance must be refreshed within 30 days",
      });
    }
  });
export type ChannelReplyControlProvenance = z.infer<
  typeof ChannelReplyControlProvenanceSchema
>;

export type CreateChannelReplyControlProvenanceInput = Readonly<{
  controlId: string;
  channelId: string;
  connectedChannelId: string;
  commentId: string;
  commentTextHash: string;
  providerReplyId: string;
  publicationIdentity: ChannelAuditPublicationIdentity;
  publishedAt: string | Date;
  status?: ChannelReplyControlStatus;
  grantStatus?: "active" | "revoked";
  provenanceStatus?: "active" | "removed";
  lastRefreshedAt: string | Date;
  expiresAt?: string | Date;
}>;

function addRetentionDays(value: Date, days: number): Date {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function normalizeInstant(value: string | Date, fieldName: string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error(`${fieldName} is invalid`);
    }
    return value.toISOString();
  }
  const parsed = InstantSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${fieldName} is invalid`);
  return new Date(value).toISOString();
}

export function createChannelAuditProvenance(
  input: CreateChannelAuditProvenanceInput,
): ChannelAuditProvenance {
  const recordedAt = normalizeInstant(input.recordedAt, "recordedAt");
  const recordedDate = new Date(recordedAt);
  const expiresAt = normalizeInstant(
    input.expiresAt ??
      addRetentionDays(recordedDate, CHANNEL_AUDIT_RETENTION_DAYS),
    "expiresAt",
  );
  return ChannelAuditProvenanceSchema.parse({
    schemaVersion: CHANNEL_AUDIT_SCHEMA_VERSION,
    eventId: input.eventId,
    eventType: input.eventType,
    channelId: input.channelId,
    connectedChannelId: input.connectedChannelId,
    commentId: input.commentId,
    commentTextHash: input.commentTextHash,
    model: input.model,
    promptVersion: input.promptVersion,
    taxonomyVersion: input.taxonomyVersion,
    validatorVersion: input.validatorVersion,
    reviewDecision: input.reviewDecision ?? null,
    publicationIdentity: input.publicationIdentity ?? null,
    providerReplyId: input.providerReplyId ?? null,
    publishedAt:
      input.publishedAt === null || input.publishedAt === undefined
        ? null
        : normalizeInstant(input.publishedAt, "publishedAt"),
    deletionOutcome: input.deletionOutcome ?? null,
    reconciliationOutcome: input.reconciliationOutcome ?? null,
    recordedAt,
    expiresAt,
  });
}

export function parseChannelAuditProvenance(
  value: unknown,
): ChannelAuditProvenance | null {
  const parsed = ChannelAuditProvenanceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ChannelAuditRetentionDecision =
  | Readonly<{ action: "retain"; expiresAt: string }>
  | Readonly<{
      action: "delete";
      reason: "retention_expired" | "invalid_record" | "invalid_clock";
    }>;

export function evaluateChannelAuditRetention(input: Readonly<{
  record: unknown;
  now?: Date;
}>): ChannelAuditRetentionDecision {
  const record = parseChannelAuditProvenance(input.record);
  if (!record) return { action: "delete", reason: "invalid_record" };

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { action: "delete", reason: "invalid_clock" };
  }
  if (now.getTime() >= new Date(record.expiresAt).getTime()) {
    return { action: "delete", reason: "retention_expired" };
  }
  return { action: "retain", expiresAt: record.expiresAt };
}

export function createChannelReplyControlProvenance(
  input: CreateChannelReplyControlProvenanceInput,
): ChannelReplyControlProvenance {
  const lastRefreshedAt = normalizeInstant(
    input.lastRefreshedAt,
    "lastRefreshedAt",
  );
  const refreshedDate = new Date(lastRefreshedAt);
  const expiresAt = normalizeInstant(
    input.expiresAt ??
      addRetentionDays(
        refreshedDate,
        CHANNEL_REPLY_CONTROL_RETENTION_DAYS,
      ),
    "expiresAt",
  );
  return ChannelReplyControlProvenanceSchema.parse({
    schemaVersion: CHANNEL_REPLY_CONTROL_SCHEMA_VERSION,
    controlId: input.controlId,
    channelId: input.channelId,
    connectedChannelId: input.connectedChannelId,
    commentId: input.commentId,
    commentTextHash: input.commentTextHash,
    providerReplyId: input.providerReplyId,
    publicationIdentity: input.publicationIdentity,
    publishedAt: normalizeInstant(input.publishedAt, "publishedAt"),
    status: input.status ?? "active",
    grantStatus: input.grantStatus ?? "active",
    provenanceStatus: input.provenanceStatus ?? "active",
    lastRefreshedAt,
    expiresAt,
  });
}

export type ChannelReplyControlRetentionDecision =
  | Readonly<{ action: "retain"; expiresAt: string }>
  | Readonly<{
      action: "delete";
      reason:
        | "revoked"
        | "provenance_removed"
        | "refresh_expired"
        | "already_deleted"
        | "invalid_record"
        | "invalid_clock";
    }>;

export function evaluateChannelReplyControlRetention(input: Readonly<{
  record: unknown;
  now?: Date;
}>): ChannelReplyControlRetentionDecision {
  const record = ChannelReplyControlProvenanceSchema.safeParse(input.record);
  if (!record.success) return { action: "delete", reason: "invalid_record" };

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { action: "delete", reason: "invalid_clock" };
  }
  if (record.data.grantStatus === "revoked") {
    return { action: "delete", reason: "revoked" };
  }
  if (record.data.provenanceStatus === "removed") {
    return { action: "delete", reason: "provenance_removed" };
  }
  if (record.data.status === "deleted") {
    return { action: "delete", reason: "already_deleted" };
  }
  if (now.getTime() >= new Date(record.data.expiresAt).getTime()) {
    return { action: "delete", reason: "refresh_expired" };
  }
  return { action: "retain", expiresAt: record.data.expiresAt };
}

export type ChannelReplyControlRefreshResult =
  | Readonly<{
      outcome: "refreshed";
      record: ChannelReplyControlProvenance;
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "invalid_record"
        | "invalid_clock"
        | "provider_refresh_not_confirmed"
        | "revoked"
        | "provenance_removed"
        | "already_deleted"
        | "refresh_expired"
        | "refresh_before_last_refresh";
    }>;

export function refreshChannelReplyControlProvenance(input: Readonly<{
  record: unknown;
  now?: Date;
  /** The caller sets this only after a policy-compliant provider re-read. */
  providerRefreshConfirmed: boolean;
}>): ChannelReplyControlRefreshResult {
  const parsed = ChannelReplyControlProvenanceSchema.safeParse(input.record);
  if (!parsed.success) return { outcome: "blocked", reason: "invalid_record" };

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { outcome: "blocked", reason: "invalid_clock" };
  }
  if (parsed.data.grantStatus === "revoked") {
    return { outcome: "blocked", reason: "revoked" };
  }
  if (parsed.data.provenanceStatus === "removed") {
    return { outcome: "blocked", reason: "provenance_removed" };
  }
  if (parsed.data.status === "deleted") {
    return { outcome: "blocked", reason: "already_deleted" };
  }
  if (input.providerRefreshConfirmed !== true) {
    return { outcome: "blocked", reason: "provider_refresh_not_confirmed" };
  }

  const lastRefreshedAt = new Date(parsed.data.lastRefreshedAt);
  if (now.getTime() < lastRefreshedAt.getTime()) {
    return { outcome: "blocked", reason: "refresh_before_last_refresh" };
  }
  if (now.getTime() >= new Date(parsed.data.expiresAt).getTime()) {
    return { outcome: "blocked", reason: "refresh_expired" };
  }

  const refreshed = ChannelReplyControlProvenanceSchema.safeParse({
    ...parsed.data,
    lastRefreshedAt: now.toISOString(),
    expiresAt: addRetentionDays(
      now,
      CHANNEL_REPLY_CONTROL_RETENTION_DAYS,
    ).toISOString(),
  });
  if (!refreshed.success) {
    return { outcome: "blocked", reason: "invalid_record" };
  }
  return { outcome: "refreshed", record: refreshed.data };
}

export const ChannelObservationClassificationSchema = z.enum([
  "Actionable Abuse",
  "Reviewable Interaction",
  "Allowed Criticism",
  "Safety Flag",
]);
export type ChannelObservationClassification = z.infer<
  typeof ChannelObservationClassificationSchema
>;

const ActiveInterfaceSecondsSchema = z
  .number()
  .finite()
  .min(0)
  .max(7 * DAY_MS / 1_000);

const ReviewObservationSchema = z
  .object({
    kind: z.literal("review_decision"),
    observedAt: InstantSchema,
    from: ChannelObservationClassificationSchema,
    to: ChannelObservationClassificationSchema,
    action: ChannelAuditReviewDecisionActionSchema,
    activeInterfaceSeconds: ActiveInterfaceSecondsSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      observation.to === "Allowed Criticism" &&
      (observation.from !== "Actionable Abuse" ||
        observation.action !== "mark_allowed_criticism")
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "only a marked Actionable Abuse can become Allowed Criticism",
      });
    }
    if (
      observation.action === "mark_allowed_criticism" &&
      observation.to !== "Allowed Criticism"
    ) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "mark_allowed_criticism must end as Allowed Criticism",
      });
    }
    if (
      observation.action === "confirm_actionable_abuse" &&
      observation.to !== "Actionable Abuse"
    ) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "confirm_actionable_abuse must end as Actionable Abuse",
      });
    }
    if (
      observation.action === "continue_safety_enforcement" &&
      (observation.from !== "Safety Flag" || observation.to !== "Safety Flag")
    ) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "safety enforcement must remain bound to a Safety Flag",
      });
    }
    if (
      observation.action === "request_draft" &&
      (observation.from !== "Actionable Abuse" ||
        observation.to !== "Actionable Abuse")
    ) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "draft requests must remain bound to Actionable Abuse",
      });
    }
  });

const PublishedReplyObservationSchema = z
  .object({
    kind: z.literal("published_reply"),
    observedAt: InstantSchema,
    publishedAt: InstantSchema,
    eligible: z.boolean(),
    wasDraft: z.boolean(),
    materiallyRewritten: z.boolean(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      new Date(observation.publishedAt).getTime() >
      new Date(observation.observedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "publication cannot be observed before it occurs",
      });
    }
  });

const ReplyDeletionObservationSchema = z
  .object({
    kind: z.literal("reply_deletion"),
    observedAt: InstantSchema,
    publishedAt: InstantSchema,
    deletedAt: NullableInstantSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      observation.deletedAt !== null &&
      new Date(observation.deletedAt).getTime() >
        new Date(observation.observedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["deletedAt"],
        message: "deletion cannot be observed before it occurs",
      });
    }
    if (
      observation.deletedAt !== null &&
      new Date(observation.deletedAt).getTime() <
        new Date(observation.publishedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["deletedAt"],
        message: "a reply cannot be deleted before publication",
      });
    }
  });

const ComplaintObservationSchema = z
  .object({
    kind: z.literal("complaint"),
    observedAt: InstantSchema,
    confirmed: z.boolean(),
  })
  .strict();

const EscalationObservationSchema = z
  .object({
    kind: z.literal("observed_escalation"),
    observedAt: InstantSchema,
    scanMode: z.literal("manual"),
    newAttack: z.literal(true),
    threadsObserved: z.number().int().min(1).max(200),
    coverageStartedAt: InstantSchema,
    coverageEndedAt: InstantSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    const coverageStart = new Date(observation.coverageStartedAt).getTime();
    const coverageEnd = new Date(observation.coverageEndedAt).getTime();
    const observedAt = new Date(observation.observedAt).getTime();
    if (coverageEnd < coverageStart) {
      context.addIssue({
        code: "custom",
        path: ["coverageEndedAt"],
        message: "scan coverage must have a non-decreasing time range",
      });
    }
    if (coverageEnd > observedAt) {
      context.addIssue({
        code: "custom",
        path: ["coverageEndedAt"],
        message: "scan coverage cannot end after its observation",
      });
    }
  });

export const ChannelObservationSchema = z.discriminatedUnion("kind", [
  ReviewObservationSchema,
  PublishedReplyObservationSchema,
  ReplyDeletionObservationSchema,
  ComplaintObservationSchema,
  EscalationObservationSchema,
]);
export type ChannelObservation = z.infer<typeof ChannelObservationSchema>;
export type ChannelMetricObservation = ChannelObservation;

export type CreateChannelReviewObservationInput = Readonly<{
  observedAt: string | Date;
  from: ChannelObservationClassification;
  to: ChannelObservationClassification;
  action: ChannelAuditReviewDecisionAction;
  activeInterfaceSeconds: number;
}>;

export function createChannelReviewObservation(
  input: CreateChannelReviewObservationInput,
): ChannelObservation {
  return ChannelObservationSchema.parse({
    kind: "review_decision",
    observedAt: normalizeInstant(input.observedAt, "observedAt"),
    from: input.from,
    to: input.to,
    action: input.action,
    activeInterfaceSeconds: input.activeInterfaceSeconds,
  });
}

export type CreateChannelPublishedReplyObservationInput = Readonly<{
  observedAt: string | Date;
  publishedAt: string | Date;
  eligible: boolean;
  wasDraft: boolean;
  materiallyRewritten?: boolean;
  /** These are measured in memory and deliberately never enter the fact. */
  generatedText?: string;
  finalText?: string;
}>;

export function createChannelPublishedReplyObservation(
  input: CreateChannelPublishedReplyObservationInput,
): ChannelObservation {
  const suppliedGeneratedText = input.generatedText !== undefined;
  const suppliedFinalText = input.finalText !== undefined;
  let materiallyRewritten = input.materiallyRewritten;
  if (materiallyRewritten === undefined) {
    if (suppliedGeneratedText !== suppliedFinalText) {
      throw new Error(
        "generatedText and finalText must be supplied together to measure a rewrite",
      );
    }
    materiallyRewritten =
      suppliedGeneratedText && suppliedFinalText
        ? isMaterialReplyRewrite(input.generatedText!, input.finalText!)
        : false;
  }

  return ChannelObservationSchema.parse({
    kind: "published_reply",
    observedAt: normalizeInstant(input.observedAt, "observedAt"),
    publishedAt: normalizeInstant(input.publishedAt, "publishedAt"),
    eligible: input.eligible,
    wasDraft: input.wasDraft,
    materiallyRewritten,
  });
}

export type CreateChannelReplyDeletionObservationInput = Readonly<{
  observedAt: string | Date;
  publishedAt: string | Date;
  deletedAt: string | Date | null;
}>;

export function createChannelReplyDeletionObservation(
  input: CreateChannelReplyDeletionObservationInput,
): ChannelObservation {
  return ChannelObservationSchema.parse({
    kind: "reply_deletion",
    observedAt: normalizeInstant(input.observedAt, "observedAt"),
    publishedAt: normalizeInstant(input.publishedAt, "publishedAt"),
    deletedAt:
      input.deletedAt === null
        ? null
        : normalizeInstant(input.deletedAt, "deletedAt"),
  });
}

export function createChannelComplaintObservation(input: Readonly<{
  observedAt: string | Date;
  confirmed: boolean;
}>): ChannelObservation {
  return ChannelObservationSchema.parse({
    kind: "complaint",
    observedAt: normalizeInstant(input.observedAt, "observedAt"),
    confirmed: input.confirmed,
  });
}

export function createChannelEscalationObservation(input: Readonly<{
  observedAt: string | Date;
  coverageStartedAt: string | Date;
  coverageEndedAt: string | Date;
  threadsObserved: number;
}>): ChannelObservation {
  return ChannelObservationSchema.parse({
    kind: "observed_escalation",
    observedAt: normalizeInstant(input.observedAt, "observedAt"),
    scanMode: "manual",
    newAttack: true,
    threadsObserved: input.threadsObserved,
    coverageStartedAt: normalizeInstant(
      input.coverageStartedAt,
      "coverageStartedAt",
    ),
    coverageEndedAt: normalizeInstant(
      input.coverageEndedAt,
      "coverageEndedAt",
    ),
  });
}

export function parseChannelObservation(
  value: unknown,
): ChannelObservation | null {
  const parsed = ChannelObservationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeReplyText(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

/**
 * Returns normalized Unicode edit distance divided by the longer normalized
 * text. The strings are used only during this call; the returned observation
 * contains the resulting boolean and never the strings themselves.
 */
export function normalizedReplyTextDifferenceRatio(
  originalText: string,
  finalText: string,
): number {
  if (typeof originalText !== "string" || typeof finalText !== "string") {
    throw new TypeError("reply texts must be strings");
  }
  const normalizedOriginal = normalizeReplyText(originalText);
  const normalizedFinal = normalizeReplyText(finalText);
  if (
    [...normalizedOriginal].length > MAX_REWRITE_COMPARISON_CHARS ||
    [...normalizedFinal].length > MAX_REWRITE_COMPARISON_CHARS
  ) {
    throw new RangeError(
      "reply text comparison exceeds the bounded retention input",
    );
  }
  const original = [...normalizedOriginal];
  const final = [...normalizedFinal];
  if (original.length === 0 && final.length === 0) return 0;
  if (original.length === 0 || final.length === 0) return 1;

  let previous = Array.from({ length: final.length + 1 }, (_, index) => index);
  for (let row = 1; row <= original.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= final.length; column += 1) {
      const substitutionCost = original[row - 1] === final[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[final.length]! / Math.max(original.length, final.length);
}

export function isMaterialReplyRewrite(
  originalText: string,
  finalText: string,
): boolean {
  return (
    normalizedReplyTextDifferenceRatio(originalText, finalText) >=
    CHANNEL_MATERIAL_REWRITE_THRESHOLD
  );
}

export const isMateriallyRewritten = isMaterialReplyRewrite;

export const ChannelRateSuppressionReasonSchema = z.enum([
  "minimum_reviewed_assessments",
  "minimum_eligible_public_replies",
  "no_denominator",
]);
export type ChannelRateSuppressionReason = z.infer<
  typeof ChannelRateSuppressionReasonSchema
>;

export const ChannelObservationRateSchema = z
  .object({
    numerator: z.number().int().min(0),
    denominator: z.number().int().min(0),
    rate: z.number().min(0).max(1).nullable(),
    suppressed: z.boolean(),
    suppressionReason: ChannelRateSuppressionReasonSchema.nullable(),
  })
  .strict();
export type ChannelObservationRate = z.infer<
  typeof ChannelObservationRateSchema
>;

const ReviewTimeMetricSchema = z
  .object({
    observations: z.number().int().min(0),
    totalActiveInterfaceSeconds: z.number().min(0),
    averageActiveInterfaceSeconds: z.number().min(0).nullable(),
  })
  .strict();

const ObservedEscalationMetricSchema = z
  .object({
    count: z.number().int().min(0),
    threadsObserved: z.number().int().min(0),
    coverageStartedAt: NullableInstantSchema,
    coverageEndedAt: NullableInstantSchema,
  })
  .strict();

export const ChannelObservationWindowSchema = z
  .object({
    windowDays: z.union([z.literal(7), z.literal(30)]),
    windowStartedAt: InstantSchema,
    windowEndedAt: InstantSchema,
    reviewedAssessments: z.number().int().min(0),
    correctionRate: ChannelObservationRateSchema,
    reviewTime: ReviewTimeMetricSchema,
    eligiblePublicReplies: z.number().int().min(0),
    publishedDrafts: z.number().int().min(0),
    materialRewriteRate: ChannelObservationRateSchema,
    eligibleSevenDayDeletions: z.number().int().min(0),
    sevenDayDeletionRate: ChannelObservationRateSchema,
    confirmedComplaints: z.number().int().min(0),
    complaintRate: ChannelObservationRateSchema,
    observedEscalation: ObservedEscalationMetricSchema,
  })
  .strict();
export type ChannelObservationWindow = z.infer<
  typeof ChannelObservationWindowSchema
>;

export const ChannelObservationReportSchema = z
  .object({
    schemaVersion: z.literal(CHANNEL_OBSERVATION_SCHEMA_VERSION),
    generatedAt: InstantSchema,
    reportingMode: z.literal("observational_only"),
    windows: z
      .object({
        sevenDay: ChannelObservationWindowSchema,
        thirtyDay: ChannelObservationWindowSchema,
      })
      .strict(),
  })
  .strict();
export type ChannelObservationReport = z.infer<
  typeof ChannelObservationReportSchema
>;

function observationsInWindow(
  observations: readonly ChannelObservation[],
  now: Date,
  days: 7 | 30,
): readonly ChannelObservation[] {
  return observations.filter((observation) => {
    return isWithinWindow(observation.observedAt, now, days);
  });
}

function isWithinWindow(
  value: string,
  now: Date,
  days: 7 | 30,
): boolean {
  const timestamp = new Date(value).getTime();
  const start = now.getTime() - days * DAY_MS;
  return timestamp >= start && timestamp <= now.getTime();
}

function rate(
  numerator: number,
  denominator: number,
  population: number,
  minimumPopulation: number,
  minimumReason: Exclude<
    ChannelRateSuppressionReason,
    "no_denominator"
  >,
): ChannelObservationRate {
  if (population < minimumPopulation) {
    return {
      numerator,
      denominator,
      rate: null,
      suppressed: true,
      suppressionReason: minimumReason,
    };
  }
  if (denominator === 0) {
    return {
      numerator,
      denominator,
      rate: null,
      suppressed: true,
      suppressionReason: "no_denominator",
    };
  }
  return {
    numerator,
    denominator,
    rate: numerator / denominator,
    suppressed: false,
    suppressionReason: null,
  };
}

function minInstant(
  current: string | null,
  candidate: string,
): string {
  if (current === null) return candidate;
  return new Date(candidate).getTime() < new Date(current).getTime()
    ? candidate
    : current;
}

function maxInstant(
  current: string | null,
  candidate: string,
): string {
  if (current === null) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime()
    ? candidate
    : current;
}

function buildObservationWindow(
  observations: readonly ChannelObservation[],
  now: Date,
  days: 7 | 30,
): ChannelObservationWindow {
  const windowObservations = observationsInWindow(observations, now, days);
  const reviews = windowObservations.filter(
    (observation): observation is Extract<
      ChannelObservation,
      { kind: "review_decision" }
    > => observation.kind === "review_decision",
  );
  const reviewedActionable = reviews.filter(
    (observation) => observation.from === "Actionable Abuse",
  );
  const corrections = reviewedActionable.filter(
    (observation) => observation.to === "Allowed Criticism",
  );
  const totalActiveInterfaceSeconds = reviews.reduce(
    (total, observation) => total + observation.activeInterfaceSeconds,
    0,
  );

  const publishedReplies = windowObservations.filter(
    (observation): observation is Extract<
      ChannelObservation,
      { kind: "published_reply" }
    > =>
      observation.kind === "published_reply" &&
      observation.eligible &&
      isWithinWindow(observation.publishedAt, now, days),
  );
  const publishedDrafts = publishedReplies.filter(
    (observation) => observation.wasDraft,
  );
  const rewrittenDrafts = publishedDrafts.filter(
    (observation) => observation.materiallyRewritten,
  );

  const deletionObservations = windowObservations.filter(
    (observation): observation is Extract<
      ChannelObservation,
      { kind: "reply_deletion" }
    > => observation.kind === "reply_deletion",
  );
  const oldEnoughDeletions = deletionObservations.filter(
    (observation) =>
      new Date(observation.publishedAt).getTime() + 7 * DAY_MS <=
      now.getTime(),
  );
  const deletedWithinSevenDays = oldEnoughDeletions.filter(
    (observation) =>
      observation.deletedAt !== null &&
      new Date(observation.deletedAt).getTime() <=
        new Date(observation.publishedAt).getTime() + 7 * DAY_MS &&
      new Date(observation.deletedAt).getTime() <= now.getTime(),
  );

  const complaints = windowObservations.filter(
    (observation): observation is Extract<
      ChannelObservation,
      { kind: "complaint" }
    > => observation.kind === "complaint" && observation.confirmed,
  );

  const escalations = windowObservations.filter(
    (observation): observation is Extract<
      ChannelObservation,
      { kind: "observed_escalation" }
    > => observation.kind === "observed_escalation" && observation.newAttack,
  );
  const escalationCoverage = escalations.reduce(
    (coverage, observation) => ({
      threadsObserved: coverage.threadsObserved + observation.threadsObserved,
      coverageStartedAt: minInstant(
        coverage.coverageStartedAt,
        observation.coverageStartedAt,
      ),
      coverageEndedAt: maxInstant(
        coverage.coverageEndedAt,
        observation.coverageEndedAt,
      ),
    }),
    {
      threadsObserved: 0,
      coverageStartedAt: null as string | null,
      coverageEndedAt: null as string | null,
    },
  );

  const reviewedAssessments = reviews.length;
  const eligiblePublicReplyCount = publishedReplies.length;
  const windowStartedAt = new Date(now.getTime() - days * DAY_MS).toISOString();
  const windowEndedAt = now.toISOString();
  return ChannelObservationWindowSchema.parse({
    windowDays: days,
    windowStartedAt,
    windowEndedAt,
    reviewedAssessments,
    correctionRate: rate(
      corrections.length,
      reviewedActionable.length,
      reviewedAssessments,
      CHANNEL_METRIC_MIN_REVIEWED_ASSESSMENTS,
      "minimum_reviewed_assessments",
    ),
    reviewTime: {
      observations: reviews.length,
      totalActiveInterfaceSeconds,
      averageActiveInterfaceSeconds:
        reviews.length === 0
          ? null
          : totalActiveInterfaceSeconds / reviews.length,
    },
    eligiblePublicReplies: eligiblePublicReplyCount,
    publishedDrafts: publishedDrafts.length,
    materialRewriteRate: rate(
      rewrittenDrafts.length,
      publishedDrafts.length,
      eligiblePublicReplyCount,
      CHANNEL_METRIC_MIN_ELIGIBLE_PUBLIC_REPLIES,
      "minimum_eligible_public_replies",
    ),
    eligibleSevenDayDeletions: oldEnoughDeletions.length,
    sevenDayDeletionRate: rate(
      deletedWithinSevenDays.length,
      oldEnoughDeletions.length,
      oldEnoughDeletions.length,
      CHANNEL_METRIC_MIN_ELIGIBLE_PUBLIC_REPLIES,
      "minimum_eligible_public_replies",
    ),
    confirmedComplaints: complaints.length,
    complaintRate: rate(
      complaints.length,
      eligiblePublicReplyCount,
      eligiblePublicReplyCount,
      CHANNEL_METRIC_MIN_ELIGIBLE_PUBLIC_REPLIES,
      "minimum_eligible_public_replies",
    ),
    observedEscalation: {
      count: escalations.length,
      threadsObserved: escalationCoverage.threadsObserved,
      coverageStartedAt: escalationCoverage.coverageStartedAt,
      coverageEndedAt: escalationCoverage.coverageEndedAt,
    },
  });
}

export function buildChannelObservationReport(input: Readonly<{
  observations: readonly ChannelObservation[];
  now?: Date;
}>): ChannelObservationReport {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("observation report clock is invalid");
  }
  const observations = input.observations.map((observation) =>
    ChannelObservationSchema.parse(observation),
  );
  return ChannelObservationReportSchema.parse({
    schemaVersion: CHANNEL_OBSERVATION_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    reportingMode: "observational_only",
    windows: {
      sevenDay: buildObservationWindow(observations, now, 7),
      thirtyDay: buildObservationWindow(observations, now, 30),
    },
  });
}
