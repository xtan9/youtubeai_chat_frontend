import {
  authorizeChannelAction,
  type ChannelAccessContext,
  type ChannelAccessDecision,
  type ConnectedChannelReference,
} from "./access";
import type { ChannelWorkBinding } from "./records";
import { z } from "zod";

export type ChannelPublicationPreflight = Readonly<{
  access: ChannelAccessContext;
  activeConnectedChannel: ConnectedChannelReference | null;
  work: ChannelWorkBinding;
  currentComment: Readonly<{
    commentId: string;
    commentHash: string;
  }> | null;
  finalTextValidated: boolean;
  remainingDailyPublications: number | null;
  exclusiveItemClaimed: boolean;
}>;

type PublicationDeniedReason =
  | "active_connected_channel_required"
  | "active_connected_channel_mismatch"
  | "publishing_authorization_mismatch"
  | "current_comment_unavailable"
  | "current_comment_changed"
  | "final_text_not_validated"
  | "publication_allowance_unavailable"
  | "exclusive_item_claim_required";

type ChannelAccessDenied = Extract<
  ChannelAccessDecision,
  { allowed: false }
>;

export type ChannelPublicationDeniedReason =
  | PublicationDeniedReason
  | ChannelAccessDenied["reason"];

export type ChannelPublicationDecision =
  | Readonly<{ allowed: true; action: "publication" }>
  | Readonly<{
      allowed: false;
      action: "publication";
      reason: ChannelPublicationDeniedReason;
    }>;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function denied(
  reason: PublicationDeniedReason,
): ChannelPublicationDecision {
  return { allowed: false, action: "publication", reason };
}

/**
 * Check all local publication preconditions before a caller attempts the one
 * provider write. In particular, the work binding is compared to the active
 * Connected Channel before any current-user identity can be substituted.
 */
export function authorizeChannelPublication(
  input: ChannelPublicationPreflight,
): ChannelPublicationDecision {
  const active = input.activeConnectedChannel;
  if (!active) return denied("active_connected_channel_required");

  const work = input.work;
  if (
    !hasText(active.ownerId) ||
    !hasText(active.channelId) ||
    !hasText(active.connectedChannelId) ||
    !hasText(active.grantId) ||
    !hasText(work.ownerId) ||
    !hasText(work.channelId) ||
    !hasText(work.connectedChannelId) ||
    !hasText(work.grantId) ||
    active.ownerId !== work.ownerId ||
    active.channelId !== work.channelId ||
    active.connectedChannelId !== work.connectedChannelId ||
    active.grantId !== work.grantId
  ) {
    return denied("active_connected_channel_mismatch");
  }

  const writeAuthorization = input.access.publishingAuthorization;
  if (
    writeAuthorization &&
    writeAuthorization.grantId !== active.grantId
  ) {
    return denied("publishing_authorization_mismatch");
  }

  const access = authorizeChannelAction("publication", {
    ...input.access,
    connectedChannel: active,
  });
  if (!access.allowed) {
    return {
      allowed: false,
      action: "publication",
      reason: access.reason,
    };
  }

  const currentComment = input.currentComment;
  if (!currentComment || !hasText(currentComment.commentId)) {
    return denied("current_comment_unavailable");
  }
  if (
    currentComment.commentId !== work.commentId ||
    !hasText(currentComment.commentHash) ||
    currentComment.commentHash !== work.commentHash
  ) {
    return denied("current_comment_changed");
  }

  if (input.finalTextValidated !== true) {
    return denied("final_text_not_validated");
  }
  const remainingDailyPublications = input.remainingDailyPublications;
  if (
    typeof remainingDailyPublications !== "number" ||
    !Number.isInteger(remainingDailyPublications) ||
    remainingDailyPublications < 1
  ) {
    return denied("publication_allowance_unavailable");
  }
  if (input.exclusiveItemClaimed !== true) {
    return denied("exclusive_item_claim_required");
  }

  return { allowed: true, action: "publication" };
}

const ReplyIdSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value.trim().length > 0);
const ReplyTextSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine((value) => value.trim().length > 0);
const ReplyHashSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value.trim().length > 0);
const ReplyFailureSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value.trim().length > 0);
const ReplyInstantSchema = z.string().datetime({ offset: true });

export const PublicReplyTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("top_level") }).strict(),
  z
    .object({
      kind: z.literal("nested"),
      parentCommentId: ReplyIdSchema,
    })
    .strict(),
]);
export type PublicReplyTarget = z.infer<typeof PublicReplyTargetSchema>;

export const PublicReplyVideoSchema = z
  .object({
    id: ReplyIdSchema,
    title: ReplyTextSchema,
    uploadingChannel: ReplyTextSchema,
  })
  .strict();
export type PublicReplyVideo = z.infer<typeof PublicReplyVideoSchema>;

export const PublicReplySourceContextSchema = z
  .object({
    commentId: ReplyIdSchema,
    commentText: ReplyTextSchema,
    commentHash: ReplyHashSchema,
    video: PublicReplyVideoSchema,
    target: PublicReplyTargetSchema,
  })
  .strict();
export type PublicReplySourceContext = z.infer<
  typeof PublicReplySourceContextSchema
>;

export const PublicReplyProviderReplySchema = z
  .object({
    replyId: ReplyIdSchema,
    commentId: ReplyIdSchema,
    parentCommentId: ReplyIdSchema,
    videoId: ReplyIdSchema,
    text: ReplyTextSchema,
    updatedAt: ReplyInstantSchema,
  })
  .strict();
export type PublicReplyProviderReply = z.infer<
  typeof PublicReplyProviderReplySchema
>;

export const PublicReplyLifecycleStatusSchema = z.enum([
  "draft_ready",
  "publishing",
  "published",
  "publication_uncertain",
  "failed",
  "deleted",
]);
export type PublicReplyLifecycleStatus = z.infer<
  typeof PublicReplyLifecycleStatusSchema
>;

export const PublicReplyDeletionStatusSchema = z.enum([
  "not_requested",
  "in_progress",
  "uncertain",
  "failed",
  "completed",
]);
export type PublicReplyDeletionStatus = z.infer<
  typeof PublicReplyDeletionStatusSchema
>;

const PublicReplyWorkBindingSchema = z
  .object({
    ownerId: ReplyIdSchema,
    channelId: ReplyIdSchema,
    connectedChannelId: ReplyIdSchema,
    grantId: ReplyIdSchema,
    commentId: ReplyIdSchema,
    commentHash: ReplyHashSchema,
  })
  .strict();

/**
 * The durable control record for one user-approved Public Reply. It keeps the
 * intended text separate from the latest provider observation so an external
 * edit can be identified without offering an in-app editor.
 */
export const PublicReplyControlRecordSchema = z
  .object({
    id: ReplyIdSchema,
    ownerId: ReplyIdSchema,
    channelId: ReplyIdSchema,
    connectedChannelId: ReplyIdSchema,
    grantId: ReplyIdSchema,
    work: PublicReplyWorkBindingSchema,
    source: PublicReplySourceContextSchema,
    finalText: ReplyTextSchema,
    revision: z.number().int().nonnegative(),
    status: PublicReplyLifecycleStatusSchema,
    providerReplyId: ReplyIdSchema.nullable(),
    publishedText: ReplyTextSchema.nullable(),
    publishedAt: ReplyInstantSchema.nullable(),
    lastObservedText: ReplyTextSchema.nullable(),
    lastObservedTextHash: ReplyHashSchema.nullable(),
    lastObservedAt: ReplyInstantSchema.nullable(),
    externallyEdited: z.boolean(),
    publicationFailure: ReplyFailureSchema.nullable(),
    publicationRetryAuthorizedBy: z
      .enum(["provider_rejection", "verified_absence"])
      .nullable(),
    deletionStatus: PublicReplyDeletionStatusSchema,
    deletionRequestedAt: ReplyInstantSchema.nullable(),
    deletionCompletedAt: ReplyInstantSchema.nullable(),
    deletionFailure: ReplyFailureSchema.nullable(),
  })
  .strict();
export type PublicReplyControlRecord = z.infer<
  typeof PublicReplyControlRecordSchema
>;

export const PublicReplyPublicationProviderResultSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("accepted"),
        reply: PublicReplyProviderReplySchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("rejected"),
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
    z
      .object({
        kind: z.literal("ambiguous"),
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
  ],
);
export type PublicReplyPublicationProviderResult = z.infer<
  typeof PublicReplyPublicationProviderResultSchema
>;

export const PublicReplyProviderObservationSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("verified_presence"),
        reply: PublicReplyProviderReplySchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("verified_absence"),
        replyId: ReplyIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("continued_uncertainty"),
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
  ],
);
export type PublicReplyProviderObservation = z.infer<
  typeof PublicReplyProviderObservationSchema
>;

export const PublicReplyDeletionProviderResultSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("confirmed"),
        replyId: ReplyIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("verified_absence"),
        replyId: ReplyIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("rejected"),
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
    z
      .object({
        kind: z.literal("ambiguous"),
        reason: z.string().trim().min(1).max(240),
      })
      .strict(),
  ],
);
export type PublicReplyDeletionProviderResult = z.infer<
  typeof PublicReplyDeletionProviderResultSchema
>;

export type PublicReplyProviderRequest = Readonly<{
  controlId: string;
  providerReplyId: string | null;
  commentId: string;
  parentCommentId: string;
  videoId: string;
}>;

/**
 * Provider operations are deliberately a supplied seam. The merged Channel
 * foundation has no reachable YouTube transport; the synthetic adapter below
 * is suitable for contract tests and cannot access real comments.
 */
export interface PublicReplyLifecycleProvider {
  readonly kind: "synthetic" | "separately_governed";
  recheck?(request: PublicReplyProviderRequest): Promise<unknown>;
  read?(request: PublicReplyProviderRequest): Promise<unknown>;
  delete?(request: PublicReplyProviderRequest): Promise<unknown>;
}

export interface PublicReplyLifecycleStore {
  get(replyId: string): Promise<PublicReplyControlRecord | null>;
  save(record: PublicReplyControlRecord): Promise<void>;
  /** Atomically saves `next` only if the stored revision is unchanged. */
  saveIfCurrent(
    expected: PublicReplyControlRecord,
    next: PublicReplyControlRecord,
  ): Promise<boolean>;
  /** Atomically moves a retryable record into `publishing`. */
  claimForPublication(
    replyId: string,
  ): Promise<PublicReplyControlRecord | null>;
  /** Atomically marks a published record's deletion operation in progress. */
  claimForDeletion(
    replyId: string,
    requestedAt?: string,
  ): Promise<PublicReplyControlRecord | null>;
}

export type InMemoryPublicReplyLifecycleStore = PublicReplyLifecycleStore &
  Readonly<{
    remainingDailyPublications: number;
  }>;

export type PublicReplyDeletionAuthorization = Readonly<{
  ownerId: string;
  channelId: string;
  connectedChannelId: string;
  grantId: string;
  /** Deletion remains available in the active connection or downgrade grace period. */
  connectionState: "active" | "grace_period" | "revoked" | "expired";
  grantStatus: "active" | "revoked";
  provenanceRefreshed: boolean;
}>;

export type BeginPublicReplyPublicationResult =
  | Readonly<{
      outcome: "attempt_started";
      record: PublicReplyControlRecord;
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "reply_not_found"
        | "publication_reconciliation_required"
        | "already_published"
        | "already_deleted"
        | "publication_in_flight"
        | "publication_not_retryable"
        | "publication_claim_lost"
        | "publication_authorization_failed";
      authorization?: ChannelPublicationDecision;
    }>;

export type CompletePublicReplyPublicationResult =
  | Readonly<{
      outcome: "published";
      record: PublicReplyControlRecord;
      reply: PublicReplyProviderReply;
      retryAllowed: false;
    }>
  | Readonly<{
      outcome: "publication_uncertain";
      reason: string;
      retryAllowed: false;
    }>
  | Readonly<{
      outcome: "rejected";
      reason: string;
      retryAllowed: true;
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "reply_not_found"
        | "publication_not_in_flight"
        | "already_published"
        | "already_deleted";
    }>;

export type ReconcilePublicReplyResult =
  | Readonly<{
      outcome: "verified_presence";
      record: PublicReplyControlRecord;
      providerReplyId: string;
      currentText: string;
      externallyEdited: boolean;
      retryAllowed: false;
    }>
  | Readonly<{
      outcome: "verified_absence";
      record: PublicReplyControlRecord;
      retryAllowed: true;
    }>
  | Readonly<{
      outcome: "continued_uncertainty";
      reason: string;
      retryAllowed: false;
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "reply_not_found"
        | "reconciliation_not_required"
        | "provider_unavailable";
    }>;

export type OpenPublishedPublicReplyResult =
  | Readonly<{
      outcome: "opened";
      url: string;
      currentText: string;
      originalText: string;
      externallyEdited: boolean;
      editingSurface: "youtube";
    }>
  | Readonly<{
      outcome: "provider_absent";
      externallyEdited: false;
      editingSurface: "youtube";
    }>
  | Readonly<{
      outcome: "continued_uncertainty";
      reason: string;
      externallyEdited: false;
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "reply_not_found"
        | "published_reply_required"
        | "provider_unavailable";
    }>;

export type DeletePublicReplyResult =
  | Readonly<{
      outcome: "confirmation_required";
      completionReported: false;
    }>
  | Readonly<{
      outcome: "deleted";
      record: PublicReplyControlRecord;
      completionReported: true;
      retryAllowed: false;
    }>
  | Readonly<{
      outcome: "deletion_uncertain";
      reason: string;
      completionReported: false;
      retryAllowed: true;
    }>
  | Readonly<{
      outcome: "deletion_failed";
      reason: string;
      completionReported: false;
      retryAllowed: true;
    }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "reply_not_found"
        | "published_reply_required"
        | "already_deleted"
        | "deletion_in_progress"
        | "deletion_authorization_required"
        | "provider_unavailable"
        | "local_state_unavailable";
      completionReported: false;
    }>;

function isProviderReplyForRecord(
  reply: PublicReplyProviderReply,
  record: PublicReplyControlRecord,
): boolean {
  const expectedParentCommentId =
    record.source.target.kind === "nested"
      ? record.source.target.parentCommentId
      : record.source.commentId;
  return (
    reply.commentId === record.source.commentId &&
    reply.parentCommentId === expectedParentCommentId &&
    reply.videoId === record.source.video.id
  );
}

function isProviderReplyIdentityCompatible(
  reply: PublicReplyProviderReply,
  record: PublicReplyControlRecord,
): boolean {
  return (
    isProviderReplyForRecord(reply, record) &&
    (!record.providerReplyId || record.providerReplyId === reply.replyId)
  );
}

function hasCoherentWorkBinding(record: PublicReplyControlRecord): boolean {
  return (
    record.ownerId === record.work.ownerId &&
    record.channelId === record.work.channelId &&
    record.connectedChannelId === record.work.connectedChannelId &&
    record.grantId === record.work.grantId &&
    record.source.commentId === record.work.commentId &&
    record.source.commentHash === record.work.commentHash
  );
}

export function isCoherentPublicReplyControlRecord(
  value: unknown,
): value is PublicReplyControlRecord {
  const parsed = PublicReplyControlRecordSchema.safeParse(value);
  return parsed.success && hasCoherentWorkBinding(parsed.data);
}

function advanceRecord(
  record: PublicReplyControlRecord,
  changes: Partial<PublicReplyControlRecord>,
): PublicReplyControlRecord {
  return {
    ...record,
    ...changes,
    revision: record.revision + 1,
  };
}

async function persistTransition(
  store: PublicReplyLifecycleStore,
  expected: PublicReplyControlRecord,
  next: PublicReplyControlRecord,
): Promise<void> {
  if (!(await store.saveIfCurrent(expected, next))) {
    throw new Error("Public Reply lifecycle revision is stale");
  }
}

function buildObservedFields(
  record: PublicReplyControlRecord,
  reply: PublicReplyProviderReply,
  now: string,
): Pick<
  PublicReplyControlRecord,
  | "providerReplyId"
  | "lastObservedText"
  | "lastObservedTextHash"
  | "lastObservedAt"
  | "externallyEdited"
> {
  const originalText = record.publishedText ?? record.finalText;
  return {
    providerReplyId: reply.replyId,
    lastObservedText: reply.text,
    lastObservedTextHash: hashCommentText(reply.text),
    lastObservedAt: now,
    externallyEdited: record.externallyEdited || reply.text !== originalText,
  };
}

function providerRequest(record: PublicReplyControlRecord): PublicReplyProviderRequest {
  return {
    controlId: record.id,
    providerReplyId: record.providerReplyId,
    commentId: record.source.commentId,
    parentCommentId:
      record.source.target.kind === "nested"
        ? record.source.target.parentCommentId
        : record.source.commentId,
    videoId: record.source.video.id,
  };
}

function currentTimestamp(now: (() => Date) | undefined): string | null {
  const value = now?.() ?? new Date();
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

/**
 * A small deterministic hash used only for synthetic provenance comparisons.
 * Production adapters must supply the provider's policy-approved comment
 * hash; this helper never contacts a provider or acts as a write credential.
 */
export function hashCommentText(value: string): string {
  const text = value;
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildYouTubeReplyUrl(videoId: string, replyId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(
    videoId,
  )}&lc=${encodeURIComponent(replyId)}`;
}

export function isPublicReplyPublicationRetryable(
  record: PublicReplyControlRecord | null,
): boolean {
  if (!record) return false;
  if (record.status === "draft_ready") return true;
  return (
    record.status === "failed" &&
    record.publicationRetryAuthorizedBy === "provider_rejection"
  );
}

/**
 * Claims the local work item after the existing publication preflight. This
 * function does not call a provider; #477's one-write implementation supplies
 * the eventual provider completion to `completePublicReplyPublication`.
 */
export async function beginPublicReplyPublication(input: Readonly<{
  store: PublicReplyLifecycleStore;
  replyId: string;
  preflight: ChannelPublicationPreflight;
}>): Promise<BeginPublicReplyPublicationResult> {
  const record = await input.store.get(input.replyId);
  if (!record) return { outcome: "blocked", reason: "reply_not_found" };
  if (!isCoherentPublicReplyControlRecord(record)) {
    return { outcome: "blocked", reason: "publication_authorization_failed" };
  }

  if (record.status === "publication_uncertain") {
    return {
      outcome: "blocked",
      reason: "publication_reconciliation_required",
    };
  }
  if (record.status === "published") {
    return { outcome: "blocked", reason: "already_published" };
  }
  if (record.status === "deleted") {
    return { outcome: "blocked", reason: "already_deleted" };
  }
  if (record.status === "publishing") {
    return { outcome: "blocked", reason: "publication_in_flight" };
  }
  if (!isPublicReplyPublicationRetryable(record)) {
    return { outcome: "blocked", reason: "publication_not_retryable" };
  }

  if (
    record.work.ownerId !== input.preflight.work.ownerId ||
    record.work.channelId !== input.preflight.work.channelId ||
    record.work.connectedChannelId !== input.preflight.work.connectedChannelId ||
    record.work.grantId !== input.preflight.work.grantId ||
    record.work.commentId !== input.preflight.work.commentId ||
    record.work.commentHash !== input.preflight.work.commentHash
  ) {
    return { outcome: "blocked", reason: "publication_authorization_failed" };
  }

  const authorization = authorizeChannelPublication(input.preflight);
  if (!authorization.allowed) {
    return {
      outcome: "blocked",
      reason: "publication_authorization_failed",
      authorization,
    };
  }

  let claimed: PublicReplyControlRecord | null;
  try {
    claimed = await input.store.claimForPublication(input.replyId);
  } catch {
    return { outcome: "blocked", reason: "publication_claim_lost" };
  }
  if (!claimed) {
    return { outcome: "blocked", reason: "publication_claim_lost" };
  }
  return { outcome: "attempt_started", record: claimed };
}

async function savePublicationUncertainty(
  store: PublicReplyLifecycleStore,
  record: PublicReplyControlRecord,
  reason: string,
  now: string | null,
): Promise<void> {
  const uncertain = advanceRecord(record, {
    status: "publication_uncertain",
    publicationFailure: reason.slice(0, 240),
    publicationRetryAuthorizedBy: null,
    lastObservedAt: now,
  });
  await persistTransition(store, record, uncertain);
}

/**
 * Applies the result of the single provider write. Every ambiguous or
 * malformed completion is treated as uncertain, never as a safe retry.
 */
export async function completePublicReplyPublication(input: Readonly<{
  store: PublicReplyLifecycleStore;
  replyId: string;
  providerResult: unknown;
  now?: () => Date;
}>): Promise<CompletePublicReplyPublicationResult> {
  const record = await input.store.get(input.replyId);
  if (!record) return { outcome: "blocked", reason: "reply_not_found" };
  if (!isCoherentPublicReplyControlRecord(record)) {
    return {
      outcome: "publication_uncertain",
      reason: "local publication record was incoherent",
      retryAllowed: false,
    };
  }
  if (record.status !== "publishing") {
    if (record.status === "published") {
      return { outcome: "blocked", reason: "already_published" };
    }
    if (record.status === "deleted") {
      return { outcome: "blocked", reason: "already_deleted" };
    }
    return { outcome: "blocked", reason: "publication_not_in_flight" };
  }

  const timestamp = currentTimestamp(input.now);
  const parsed = PublicReplyPublicationProviderResultSchema.safeParse(
    input.providerResult,
  );

  if (!parsed.success) {
    const reason = "provider completion was invalid or ambiguous";
    try {
      await savePublicationUncertainty(input.store, record, reason, timestamp);
    } catch {
      // The caller still receives the safe outcome; it must not retry while
      // the local completion record is unknown.
    }
    return { outcome: "publication_uncertain", reason, retryAllowed: false };
  }

  if (parsed.data.kind === "ambiguous") {
    const reason = parsed.data.reason;
    try {
      await savePublicationUncertainty(input.store, record, reason, timestamp);
    } catch {
      // The caller still receives the safe outcome; it must not retry while
      // the local completion record is unknown.
    }
    return { outcome: "publication_uncertain", reason, retryAllowed: false };
  }

  if (parsed.data.kind === "rejected") {
    const failed = advanceRecord(record, {
      status: "failed",
      publicationFailure: parsed.data.reason,
      publicationRetryAuthorizedBy: "provider_rejection",
      lastObservedAt: timestamp,
    });
    try {
      await persistTransition(input.store, record, failed);
    } catch {
      try {
        await savePublicationUncertainty(
          input.store,
          record,
          "provider rejection was not persisted locally",
          timestamp,
        );
      } catch {
        // Local state remains unknown and therefore cannot authorize a retry.
      }
      return {
        outcome: "publication_uncertain",
        reason: "provider rejection was not persisted locally",
        retryAllowed: false,
      };
    }
    return {
      outcome: "rejected",
      reason: parsed.data.reason,
      retryAllowed: true,
    };
  }

  if (
    !timestamp ||
    !isProviderReplyIdentityCompatible(parsed.data.reply, record)
  ) {
    const reason = !timestamp
      ? "publication completion timestamp was invalid"
      : "provider reply identity did not match the requested comment";
    try {
      await savePublicationUncertainty(input.store, record, reason, timestamp);
    } catch {
      // See the uncertainty contract above.
    }
    return { outcome: "publication_uncertain", reason, retryAllowed: false };
  }

  const observed = buildObservedFields(record, parsed.data.reply, timestamp);
  const published = advanceRecord(record, {
    status: "published",
    publishedText: record.finalText,
    publishedAt: timestamp,
    ...observed,
    publicationFailure: null,
    publicationRetryAuthorizedBy: null,
    deletionStatus: "not_requested",
    deletionRequestedAt: null,
    deletionCompletedAt: null,
    deletionFailure: null,
  });
  try {
    await persistTransition(input.store, record, published);
  } catch {
    try {
      await savePublicationUncertainty(
        input.store,
        record,
        "provider accepted the reply but local publication was not persisted",
        timestamp,
      );
    } catch {
      // Both outcomes are unknown; reporting Published would be unsafe.
    }
    return {
      outcome: "publication_uncertain",
      reason: "provider accepted the reply but local publication was not persisted",
      retryAllowed: false,
    };
  }

  return {
    outcome: "published",
    record: published,
    reply: parsed.data.reply,
    retryAllowed: false,
  };
}

async function continuedUncertainty(
  store: PublicReplyLifecycleStore,
  record: PublicReplyControlRecord,
  reason: string,
  now: string | null,
): Promise<ReconcilePublicReplyResult> {
  const next = advanceRecord(record, {
    status: "publication_uncertain",
    publicationFailure: reason.slice(0, 240),
    publicationRetryAuthorizedBy: null,
    lastObservedAt: now,
  });
  try {
    await persistTransition(store, record, next);
  } catch {
    // Preserve the non-retryable result when local reconciliation state is
    // unavailable; a new write still cannot be authorized safely.
  }
  return { outcome: "continued_uncertainty", reason, retryAllowed: false };
}

/**
 * Rechecks an uncertain publication. Only a verified absence transitions the
 * record back to `draft_ready`; presence becomes Published and all other
 * outcomes remain non-retryable.
 */
export async function reconcilePublicReply(input: Readonly<{
  store: PublicReplyLifecycleStore;
  provider: PublicReplyLifecycleProvider;
  replyId: string;
  now?: () => Date;
}>): Promise<ReconcilePublicReplyResult> {
  const record = await input.store.get(input.replyId);
  if (!record) return { outcome: "blocked", reason: "reply_not_found" };
  if (!isCoherentPublicReplyControlRecord(record)) {
    return {
      outcome: "continued_uncertainty",
      reason: "local publication record was incoherent",
      retryAllowed: false,
    };
  }
  if (record.status !== "publication_uncertain") {
    return { outcome: "blocked", reason: "reconciliation_not_required" };
  }
  if (input.provider.kind !== "synthetic" || typeof input.provider.recheck !== "function") {
    return { outcome: "blocked", reason: "provider_unavailable" };
  }

  const timestamp = currentTimestamp(input.now);
  let raw: unknown;
  try {
    raw = await input.provider.recheck(providerRequest(record));
  } catch {
    return continuedUncertainty(
      input.store,
      record,
      "provider recheck was unavailable",
      timestamp,
    );
  }
  const parsed = PublicReplyProviderObservationSchema.safeParse(raw);
  if (!parsed.success) {
    return continuedUncertainty(
      input.store,
      record,
      "provider recheck was invalid or ambiguous",
      timestamp,
    );
  }
  if (parsed.data.kind === "continued_uncertainty") {
    return continuedUncertainty(
      input.store,
      record,
      parsed.data.reason,
      timestamp,
    );
  }

  if (parsed.data.kind === "verified_absence") {
    if (
      record.providerReplyId &&
      parsed.data.replyId !== record.providerReplyId
    ) {
      return continuedUncertainty(
        input.store,
        record,
        "provider absence did not match the uncertain publication",
        timestamp,
      );
    }
    const ready = advanceRecord(record, {
      status: "draft_ready",
      providerReplyId: null,
      publishedText: null,
      publishedAt: null,
      lastObservedText: null,
      lastObservedTextHash: null,
      lastObservedAt: timestamp,
      externallyEdited: false,
      publicationFailure: null,
      publicationRetryAuthorizedBy: "verified_absence",
      deletionStatus: "not_requested",
      deletionRequestedAt: null,
      deletionCompletedAt: null,
      deletionFailure: null,
    });
    try {
      await persistTransition(input.store, record, ready);
    } catch {
      return continuedUncertainty(
        input.store,
        record,
        "verified absence was not persisted locally",
        timestamp,
      );
    }
    return { outcome: "verified_absence", record: ready, retryAllowed: true };
  }

  if (
    !timestamp ||
    !isProviderReplyIdentityCompatible(parsed.data.reply, record)
  ) {
    return continuedUncertainty(
      input.store,
      record,
      !timestamp
        ? "provider recheck timestamp was invalid"
        : "provider reply identity did not match the uncertain publication",
      timestamp,
    );
  }

  const observed = buildObservedFields(record, parsed.data.reply, timestamp);
  const published = advanceRecord(record, {
    status: "published",
    ...observed,
    publishedText: record.publishedText ?? record.finalText,
    publishedAt: record.publishedAt ?? timestamp,
    publicationFailure: null,
    publicationRetryAuthorizedBy: null,
    deletionStatus: "not_requested",
    deletionRequestedAt: null,
    deletionCompletedAt: null,
    deletionFailure: null,
  });
  try {
    await persistTransition(input.store, record, published);
  } catch {
    return continuedUncertainty(
      input.store,
      record,
      "verified presence was not persisted locally",
      timestamp,
    );
  }
  return {
    outcome: "verified_presence",
    record: published,
    providerReplyId: parsed.data.reply.replyId,
    currentText: parsed.data.reply.text,
    externallyEdited: published.externallyEdited,
    retryAllowed: false,
  };
}

/** Open/read is intentionally the only editing path exposed by this seam. */
export async function openPublishedPublicReply(input: Readonly<{
  store: PublicReplyLifecycleStore;
  provider: PublicReplyLifecycleProvider;
  replyId: string;
  now?: () => Date;
}>): Promise<OpenPublishedPublicReplyResult> {
  const record = await input.store.get(input.replyId);
  if (!record) return { outcome: "blocked", reason: "reply_not_found" };
  if (!isCoherentPublicReplyControlRecord(record)) {
    return { outcome: "blocked", reason: "published_reply_required" };
  }
  if (record.status !== "published" || !record.providerReplyId) {
    return { outcome: "blocked", reason: "published_reply_required" };
  }
  if (input.provider.kind !== "synthetic" || typeof input.provider.read !== "function") {
    return { outcome: "blocked", reason: "provider_unavailable" };
  }

  const timestamp = currentTimestamp(input.now);
  let raw: unknown;
  try {
    raw = await input.provider.read(providerRequest(record));
  } catch {
    return {
      outcome: "continued_uncertainty",
      reason: "provider read was unavailable",
      externallyEdited: false,
    };
  }
  const parsed = PublicReplyProviderObservationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      outcome: "continued_uncertainty",
      reason: "provider read was invalid or ambiguous",
      externallyEdited: false,
    };
  }
  if (parsed.data.kind === "continued_uncertainty") {
    return {
      outcome: "continued_uncertainty",
      reason: parsed.data.reason,
      externallyEdited: false,
    };
  }
  if (parsed.data.kind === "verified_absence") {
    if (
      record.providerReplyId &&
      parsed.data.replyId !== record.providerReplyId
    ) {
      return {
        outcome: "continued_uncertainty",
        reason: "provider absence did not match the published reply",
        externallyEdited: false,
      };
    }
    return {
      outcome: "provider_absent",
      externallyEdited: false,
      editingSurface: "youtube",
    };
  }
  if (
    !timestamp ||
    !isProviderReplyIdentityCompatible(parsed.data.reply, record)
  ) {
    return {
      outcome: "continued_uncertainty",
      reason: !timestamp
        ? "provider read timestamp was invalid"
        : "provider reply identity did not match the published reply",
      externallyEdited: false,
    };
  }

  const observed = buildObservedFields(record, parsed.data.reply, timestamp);
  const updated = advanceRecord(record, {
    ...observed,
  });
  try {
    await persistTransition(input.store, record, updated);
  } catch {
    return {
      outcome: "continued_uncertainty",
      reason: "provider read succeeded but local observation was not persisted",
      externallyEdited: false,
    };
  }
  const originalText = record.publishedText ?? record.finalText;
  return {
    outcome: "opened",
    url: buildYouTubeReplyUrl(record.source.video.id, parsed.data.reply.replyId),
    currentText: parsed.data.reply.text,
    originalText,
    externallyEdited: updated.externallyEdited,
    editingSurface: "youtube",
  };
}

function deletionAuthorizationMatches(
  record: PublicReplyControlRecord,
  authorization: PublicReplyDeletionAuthorization,
): boolean {
  return (
    authorization.ownerId === record.ownerId &&
    authorization.channelId === record.channelId &&
    authorization.connectedChannelId === record.connectedChannelId &&
    authorization.grantId === record.grantId &&
    (authorization.connectionState === "active" ||
      authorization.connectionState === "grace_period") &&
    authorization.grantStatus === "active" &&
    authorization.provenanceRefreshed === true
  );
}

async function saveDeletionUncertainty(
  store: PublicReplyLifecycleStore,
  record: PublicReplyControlRecord,
  reason: string,
  now: string | null,
): Promise<void> {
  const uncertain = advanceRecord(record, {
    deletionStatus: "uncertain",
    deletionFailure: reason.slice(0, 240),
    deletionRequestedAt: record.deletionRequestedAt ?? now,
  });
  await persistTransition(store, record, uncertain);
}

/**
 * Performs one explicitly confirmed delete attempt. Deletion has no
 * entitlement or publication-allowance decrement, but it does require the
 * original active/grace-period grant and refreshed reply provenance.
 */
export async function deletePublicReply(input: Readonly<{
  store: PublicReplyLifecycleStore;
  provider: PublicReplyLifecycleProvider;
  replyId: string;
  authorization: PublicReplyDeletionAuthorization;
  confirmation: boolean;
  now?: () => Date;
}>): Promise<DeletePublicReplyResult> {
  if (input.confirmation !== true) {
    return { outcome: "confirmation_required", completionReported: false };
  }

  const record = await input.store.get(input.replyId);
  if (!record) {
    return {
      outcome: "blocked",
      reason: "reply_not_found",
      completionReported: false,
    };
  }
  if (record.status === "deleted" || record.deletionStatus === "completed") {
    return {
      outcome: "blocked",
      reason: "already_deleted",
      completionReported: false,
    };
  }
  if (!isCoherentPublicReplyControlRecord(record)) {
    return {
      outcome: "blocked",
      reason: "deletion_authorization_required",
      completionReported: false,
    };
  }
  if (record.status !== "published" || !record.providerReplyId) {
    return {
      outcome: "blocked",
      reason: "published_reply_required",
      completionReported: false,
    };
  }
  if (!deletionAuthorizationMatches(record, input.authorization)) {
    return {
      outcome: "blocked",
      reason: "deletion_authorization_required",
      completionReported: false,
    };
  }
  if (input.provider.kind !== "synthetic" || typeof input.provider.delete !== "function") {
    return {
      outcome: "blocked",
      reason: "provider_unavailable",
      completionReported: false,
    };
  }

  const timestamp = currentTimestamp(input.now);
  if (!timestamp) {
    return {
      outcome: "blocked",
      reason: "local_state_unavailable",
      completionReported: false,
    };
  }

  let claimed: PublicReplyControlRecord | null;
  try {
    claimed = await input.store.claimForDeletion(input.replyId, timestamp);
  } catch {
    return {
      outcome: "blocked",
      reason: "local_state_unavailable",
      completionReported: false,
    };
  }
  if (!claimed) {
    return {
      outcome: "blocked",
      reason: "deletion_in_progress",
      completionReported: false,
    };
  }

  let raw: unknown;
  try {
    raw = await input.provider.delete(providerRequest(claimed));
  } catch {
    raw = { kind: "ambiguous", reason: "provider delete was unavailable" };
  }
  const parsed = PublicReplyDeletionProviderResultSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = "provider delete was invalid or ambiguous";
    try {
      await saveDeletionUncertainty(input.store, claimed, reason, timestamp);
    } catch {
      // Do not report completion when even the uncertain local outcome cannot
      // be recorded.
    }
    return {
      outcome: "deletion_uncertain",
      reason,
      completionReported: false,
      retryAllowed: true,
    };
  }
  if (parsed.data.kind === "ambiguous") {
    const reason = parsed.data.reason;
    try {
      await saveDeletionUncertainty(input.store, claimed, reason, timestamp);
    } catch {
      // Do not report completion when even the uncertain local outcome cannot
      // be recorded.
    }
    return {
      outcome: "deletion_uncertain",
      reason,
      completionReported: false,
      retryAllowed: true,
    };
  }

  if (parsed.data.kind === "rejected") {
    const failed = advanceRecord(claimed, {
      deletionStatus: "failed",
      deletionFailure: parsed.data.reason,
      deletionRequestedAt: claimed.deletionRequestedAt ?? timestamp,
    });
    try {
      await persistTransition(input.store, claimed, failed);
    } catch {
      try {
        await saveDeletionUncertainty(
          input.store,
          claimed,
          "provider deletion rejection was not persisted locally",
          timestamp,
        );
      } catch {
        // Keep the outcome non-complete when local state is unknown.
      }
      return {
        outcome: "deletion_uncertain",
        reason: "provider deletion rejection was not persisted locally",
        completionReported: false,
        retryAllowed: true,
      };
    }
    return {
      outcome: "deletion_failed",
      reason: parsed.data.reason,
      completionReported: false,
      retryAllowed: true,
    };
  }

  if (parsed.data.replyId !== claimed.providerReplyId || !timestamp) {
    const reason = !timestamp
      ? "deletion completion timestamp was invalid"
      : "provider deletion identity did not match the published reply";
    try {
      await saveDeletionUncertainty(input.store, claimed, reason, timestamp);
    } catch {
      // Keep the operation non-complete and non-silent.
    }
    return {
      outcome: "deletion_uncertain",
      reason,
      completionReported: false,
      retryAllowed: true,
    };
  }

  const deleted = advanceRecord(claimed, {
    status: "deleted",
    deletionStatus: "completed",
    deletionCompletedAt: timestamp,
    deletionFailure: null,
  });
  try {
    await persistTransition(input.store, claimed, deleted);
  } catch {
    try {
      await saveDeletionUncertainty(
        input.store,
        claimed,
        "provider deletion completed but local deletion was not persisted",
        timestamp,
      );
    } catch {
      // Reporting Deleted here would violate the provider/local completion
      // contract.
    }
    return {
      outcome: "deletion_uncertain",
      reason: "provider deletion completed but local deletion was not persisted",
      completionReported: false,
      retryAllowed: true,
    };
  }
  return {
    outcome: "deleted",
    record: deleted,
    completionReported: true,
    retryAllowed: false,
  };
}

export type SyntheticPublicReplyProvider = PublicReplyLifecycleProvider &
  Readonly<{
    calls: Readonly<{
      recheck: readonly PublicReplyProviderRequest[];
      read: readonly PublicReplyProviderRequest[];
      delete: readonly PublicReplyProviderRequest[];
    }>;
  }>;

export function createSyntheticPublicReplyProvider(input: Readonly<{
  recheckResults?: readonly unknown[];
  readResults?: readonly unknown[];
  deleteResults?: readonly unknown[];
}> = {}): SyntheticPublicReplyProvider {
  const recheckResults = [...(input.recheckResults ?? [])];
  const readResults = [...(input.readResults ?? [])];
  const deleteResults = [...(input.deleteResults ?? [])];
  const calls = {
    recheck: [] as PublicReplyProviderRequest[],
    read: [] as PublicReplyProviderRequest[],
    delete: [] as PublicReplyProviderRequest[],
  };
  return {
    kind: "synthetic",
    calls,
    async recheck(request) {
      calls.recheck.push(request);
      return (
        recheckResults.shift() ?? {
          kind: "continued_uncertainty",
          reason: "no synthetic recheck result was configured",
        }
      );
    },
    async read(request) {
      calls.read.push(request);
      return (
        readResults.shift() ?? {
          kind: "continued_uncertainty",
          reason: "no synthetic read result was configured",
        }
      );
    },
    async delete(request) {
      calls.delete.push(request);
      return (
        deleteResults.shift() ?? {
          kind: "ambiguous",
          reason: "no synthetic delete result was configured",
        }
      );
    },
  };
}

export function createInMemoryPublicReplyLifecycleStore(input: Readonly<{
  records: readonly PublicReplyControlRecord[];
  remainingDailyPublications: number;
}>): InMemoryPublicReplyLifecycleStore {
  if (
    !Number.isInteger(input.remainingDailyPublications) ||
    input.remainingDailyPublications < 0
  ) {
    throw new Error("remainingDailyPublications must be a non-negative integer");
  }
  const records = new Map<string, PublicReplyControlRecord>();
  let remainingDailyPublications = input.remainingDailyPublications;
  for (const record of input.records) {
    const parsed = PublicReplyControlRecordSchema.parse(record);
    if (!hasCoherentWorkBinding(parsed)) {
      throw new Error(`incoherent Public Reply control record: ${parsed.id}`);
    }
    if (records.has(parsed.id)) {
      throw new Error(`duplicate Public Reply control record: ${parsed.id}`);
    }
    records.set(parsed.id, parsed);
  }

  const store: InMemoryPublicReplyLifecycleStore = {
    get remainingDailyPublications() {
      return remainingDailyPublications;
    },
    async get(replyId) {
      return records.get(replyId) ?? null;
    },
    async save(record) {
      const parsed = PublicReplyControlRecordSchema.parse(record);
      if (!hasCoherentWorkBinding(parsed)) {
        throw new Error(`incoherent Public Reply control record: ${parsed.id}`);
      }
      const existing = records.get(parsed.id);
      if (existing && parsed.revision < existing.revision) {
        throw new Error("stale Public Reply control record");
      }
      records.set(parsed.id, parsed);
    },
    async saveIfCurrent(expected, next) {
      const current = records.get(expected.id);
      if (!current || current.revision !== expected.revision) return false;
      const parsed = PublicReplyControlRecordSchema.parse(next);
      if (!hasCoherentWorkBinding(parsed)) {
        throw new Error(`incoherent Public Reply control record: ${parsed.id}`);
      }
      if (parsed.revision !== expected.revision + 1) {
        throw new Error("Public Reply lifecycle revision did not advance");
      }
      records.set(parsed.id, parsed);
      try {
        await store.save(parsed);
      } catch (error) {
        if (records.get(parsed.id) === parsed) records.set(parsed.id, current);
        throw error;
      }
      return true;
    },
    async claimForPublication(replyId) {
      const existing = records.get(replyId);
      if (
        !existing ||
        !isPublicReplyPublicationRetryable(existing) ||
        remainingDailyPublications < 1
      ) {
        return null;
      }
      const claimed: PublicReplyControlRecord = {
        ...existing,
        revision: existing.revision + 1,
        status: "publishing",
      };
      remainingDailyPublications -= 1;
      records.set(replyId, claimed);
      try {
        await store.save(claimed);
      } catch (error) {
        if (records.get(replyId) === claimed) {
          records.set(replyId, existing);
          remainingDailyPublications += 1;
        }
        throw error;
      }
      return claimed;
    },
    async claimForDeletion(replyId, requestedAt) {
      const existing = records.get(replyId);
      if (
        !existing ||
        existing.status !== "published" ||
        !existing.providerReplyId ||
        existing.deletionStatus === "in_progress" ||
        existing.deletionStatus === "completed"
      ) {
        return null;
      }
      const claimed: PublicReplyControlRecord = {
        ...existing,
        revision: existing.revision + 1,
        deletionStatus: "in_progress",
        deletionRequestedAt: existing.deletionRequestedAt ?? requestedAt ?? new Date().toISOString(),
        deletionFailure: null,
      };
      records.set(replyId, claimed);
      try {
        await store.save(claimed);
      } catch (error) {
        if (records.get(replyId) === claimed) records.set(replyId, existing);
        throw error;
      }
      return claimed;
    },
  };
  return store;
}

// Names used by later provider adapters can remain descriptive without
// changing the state-machine contract.
export const applyPublicReplyPublicationOutcome =
  completePublicReplyPublication;
export const openPublicReplyOnYouTube = openPublishedPublicReply;
