import { z } from "zod";

import {
  authorizeChannelAction,
  type ChannelAccessContext,
  type ChannelAccessDeniedReason,
  type ChannelEntitlement,
} from "../channel-onboarding/access";

const LifecycleIdSchema = z.string().trim().min(1).max(240);
const LifecycleInstantSchema = z.string().datetime({ offset: true });

export const CHANNEL_API_DATA_RETENTION_DAYS = 30 as const;
export const CHANNEL_READ_ONLY_GRACE_DAYS = 7 as const;
export const CHANNEL_CLEANUP_DEADLINE_DAYS = 7 as const;
export const CHANNEL_CLEANUP_ESCALATION_LEAD_DAYS = 1 as const;
export const CHANNEL_GOOGLE_REVOCATION_URL =
  "https://myaccount.google.com/permissions" as const;

const DAY_MS = 24 * 60 * 60 * 1_000;

export const ChannelLifecycleStateSchema = z.enum([
  "active",
  "read_only_grace",
  "cleanup_pending",
  "deleted",
]);
export type ChannelLifecycleState = z.infer<
  typeof ChannelLifecycleStateSchema
>;

export const ChannelLifecycleRecordSchema = z
  .object({
    ownerId: LifecycleIdSchema,
    channelId: LifecycleIdSchema,
    connectedChannelId: LifecycleIdSchema,
    grantId: LifecycleIdSchema,
    state: ChannelLifecycleStateSchema,
    graceStartedAt: LifecycleInstantSchema.nullable(),
    graceEndsAt: LifecycleInstantSchema.nullable(),
    grantStatus: z.enum(["active", "revoked"]),
    provenanceStatus: z.enum(["active", "removed"]),
    provenanceRefreshedAt: LifecycleInstantSchema.nullable(),
    localDataStatus: z.enum(["retained", "deleted"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "active") {
      if (value.graceStartedAt !== null || value.graceEndsAt !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "active lifecycle cannot carry grace dates" });
      }
      if (
        value.grantStatus !== "active" ||
        value.provenanceStatus !== "active" ||
        value.localDataStatus !== "retained"
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "active lifecycle must retain active authorization and local data" });
      }
    }
    if (value.state === "read_only_grace") {
      const graceStartedAt = dateFrom(value.graceStartedAt);
      const graceEndsAt = dateFrom(value.graceEndsAt);
      if (
        !graceStartedAt ||
        !graceEndsAt ||
        graceEndsAt.getTime() <= graceStartedAt.getTime() ||
        value.grantStatus !== "active" ||
        value.provenanceStatus !== "active" ||
        value.localDataStatus !== "retained"
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "read-only grace lifecycle is inconsistent" });
      }
    }
    if (
      value.state === "deleted" &&
      (value.grantStatus !== "revoked" ||
        value.provenanceStatus !== "removed" ||
        value.localDataStatus !== "deleted" ||
        value.graceStartedAt !== null ||
        value.graceEndsAt !== null)
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "deleted lifecycle must have no grant, provenance, or local data" });
    }
  });
export type ChannelLifecycleRecord = z.infer<
  typeof ChannelLifecycleRecordSchema
>;

export type ChannelLifecycleAction =
  | "scan"
  | "draft"
  | "publication"
  | "inspect"
  | "export"
  | "delete"
  | "disconnect"
  | "resubscribe"
  | "delete_published_reply";

export const CHANNEL_LIFECYCLE_ACTIONS = [
  "scan",
  "draft",
  "publication",
  "inspect",
  "export",
  "delete",
  "disconnect",
  "resubscribe",
  "delete_published_reply",
] as const satisfies readonly ChannelLifecycleAction[];

type LifecycleDeniedReason =
  | ChannelAccessDeniedReason
  | "invalid_lifecycle"
  | "invalid_clock"
  | "owner_mismatch"
  | "read_only_grace"
  | "grace_expired"
  | "lifecycle_unavailable"
  | "local_data_deleted"
  | "provider_authorization_removed"
  | "reply_control_unavailable"
  | "reply_control_mismatch"
  | "provenance_expired";

export type ChannelYouTubeDeletionGuidance = Readonly<{
  kind: "youtube_instructions";
  title: "Delete remaining Public Replies on YouTube";
  url: typeof CHANNEL_GOOGLE_REVOCATION_URL;
  message: string;
}>;

export type ChannelLifecycleAuthorizationDecision =
  | Readonly<{ allowed: true; action: ChannelLifecycleAction }>
  | Readonly<{
      allowed: false;
      action: ChannelLifecycleAction;
      reason: LifecycleDeniedReason;
      guidance?: ChannelYouTubeDeletionGuidance;
    }>;

type ChannelLifecycleDeniedDecision = Extract<
  ChannelLifecycleAuthorizationDecision,
  { allowed: false }
>;

export const ChannelReplyControlSchema = z
  .object({
    id: LifecycleIdSchema,
    ownerId: LifecycleIdSchema,
    channelId: LifecycleIdSchema,
    connectedChannelId: LifecycleIdSchema,
    grantId: LifecycleIdSchema,
    providerReplyId: LifecycleIdSchema,
    commentId: LifecycleIdSchema,
    commentHash: LifecycleIdSchema,
    publishedAt: LifecycleInstantSchema,
    lastRefreshedAt: LifecycleInstantSchema,
    status: z.enum(["active", "deleted"]),
  })
  .strict()
  .superRefine((value, context) => {
    const publishedAt = dateFrom(value.publishedAt);
    const lastRefreshedAt = dateFrom(value.lastRefreshedAt);
    if (
      publishedAt &&
      lastRefreshedAt &&
      lastRefreshedAt.getTime() < publishedAt.getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reply provenance cannot predate publication",
      });
    }
  });
export type ChannelReplyControl = z.infer<typeof ChannelReplyControlSchema>;

export type ChannelReplyControlRetentionEvaluation =
  | Readonly<{ action: "retain"; expiresAt: string }>
  | Readonly<{
      action: "refresh_or_delete";
      dueAt: string;
      deleteBy: string;
    }>
  | Readonly<{
      action: "delete";
      reason: "retention_expired" | "invalid_timestamp";
    }>
  | Readonly<{ action: "already_deleted" }>;

export type ChannelReplyControlRefreshResult =
  | Readonly<{ kind: "refreshed"; replyControl: ChannelReplyControl }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_control"
        | "invalid_clock"
        | "already_deleted"
        | "retention_window_expired";
    }>;

export const ChannelRetainedDataKindSchema = z.enum([
  "review_text",
  "youtube_api_data",
  "draft_text",
  "review_decision",
  "audit_provenance",
  "reply_control",
  "aggregate",
]);
export type ChannelRetainedDataKind = z.infer<
  typeof ChannelRetainedDataKindSchema
>;

export const ChannelRetentionRecordSchema = z
  .object({
    id: LifecycleIdSchema,
    ownerId: LifecycleIdSchema,
    channelId: LifecycleIdSchema,
    kind: ChannelRetainedDataKindSchema,
    retainedAt: LifecycleInstantSchema,
    refreshedAt: LifecycleInstantSchema.nullable(),
    deletedAt: LifecycleInstantSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const retainedAt = dateFrom(value.retainedAt);
    const refreshedAt = dateFrom(value.refreshedAt);
    const deletedAt = dateFrom(value.deletedAt);
    if (
      retainedAt &&
      refreshedAt &&
      refreshedAt.getTime() < retainedAt.getTime()
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "refresh cannot predate retention" });
    }
    if (retainedAt && deletedAt && deletedAt.getTime() < retainedAt.getTime()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "deletion cannot predate retention" });
    }
    if (value.kind === "aggregate" && value.deletedAt !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "aggregate data cannot be deleted by identifying-data retention" });
    }
  });
export type ChannelRetentionRecord = z.infer<
  typeof ChannelRetentionRecordSchema
>;

export type ChannelRetentionEvaluation =
  | Readonly<{
      action: "retain";
      expiresAt: string;
    }>
  | Readonly<{ action: "retain_aggregate" }>
  | Readonly<{
      action: "refresh_or_delete";
      dueAt: string;
      deleteBy: string;
    }>
  | Readonly<{
      action: "delete";
      reason: "retention_expired" | "invalid_timestamp";
    }>
  | Readonly<{ action: "already_deleted"; deletedAt: string }>;

export type ChannelRetentionRefreshResult =
  | Readonly<{
      kind: "refreshed";
      record: ChannelRetentionRecord;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_record"
        | "invalid_clock"
        | "aggregate_not_refreshable"
        | "already_deleted"
        | "retention_window_expired";
    }>;

export type ChannelGraceTransitionResult =
  | Readonly<{
      kind: "started";
      lifecycle: ChannelLifecycleRecord;
    }>
  | Readonly<{
      kind: "already_in_grace";
      lifecycle: ChannelLifecycleRecord;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_lifecycle"
        | "invalid_clock"
        | "grace_expired"
        | "cleanup_already_started"
        | "already_deleted";
    }>;

export type ChannelResubscriptionResult =
  | Readonly<{ kind: "resubscribed"; lifecycle: ChannelLifecycleRecord }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_lifecycle"
        | "invalid_clock"
        | "entitlement_unavailable"
        | "grace_expired"
        | "not_in_grace"
        | "cleanup_already_started";
    }>;

export type ChannelGraceExpiryResult =
  | Readonly<{
      kind: "cleanup_required";
      lifecycle: ChannelLifecycleRecord;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_lifecycle"
        | "invalid_clock"
        | "not_in_grace"
        | "grace_not_expired"
        | "already_deleted";
    }>;

function dateFrom(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validNow(now: Date): boolean {
  return Number.isFinite(now.getTime());
}

function hasActiveAuthorizationAndLocalData(
  lifecycle: ChannelLifecycleRecord,
): boolean {
  return (
    lifecycle.grantStatus === "active" &&
    lifecycle.provenanceStatus === "active" &&
    lifecycle.localDataStatus === "retained"
  );
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

function isRegisteredOwner(
  access: ChannelAccessContext,
  lifecycle: ChannelLifecycleRecord,
): boolean {
  return Boolean(
    access.principal &&
      access.principal.isAnonymous === false &&
      access.principal.userId.trim().length > 0 &&
      access.principal.userId === lifecycle.ownerId,
  );
}

function deny(
  action: ChannelLifecycleAction,
  reason: LifecycleDeniedReason,
): ChannelLifecycleDeniedDecision {
  return { allowed: false, action, reason };
}

/**
 * Materialize the one-way subscription transition into a bounded grace
 * period. The operation is idempotent while the grace period is still open.
 */
export function startChannelReadOnlyGracePeriod(input: Readonly<{
  lifecycle: ChannelLifecycleRecord;
  now?: Date;
}>): ChannelGraceTransitionResult {
  const parsed = ChannelLifecycleRecordSchema.safeParse(input.lifecycle);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_lifecycle" };

  const now = input.now ?? new Date();
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };

  const lifecycle = parsed.data;
  if (lifecycle.state === "read_only_grace") {
    const graceEndsAt = dateFrom(lifecycle.graceEndsAt);
    if (!graceEndsAt || now.getTime() >= graceEndsAt.getTime()) {
      return { kind: "blocked", reason: "grace_expired" };
    }
    return { kind: "already_in_grace", lifecycle };
  }
  if (lifecycle.state === "cleanup_pending") {
    return { kind: "blocked", reason: "cleanup_already_started" };
  }
  if (lifecycle.state === "deleted") {
    return { kind: "blocked", reason: "already_deleted" };
  }

  const nextLifecycle: ChannelLifecycleRecord = {
    ...lifecycle,
    state: "read_only_grace",
    graceStartedAt: now.toISOString(),
    graceEndsAt: addDays(now, CHANNEL_READ_ONLY_GRACE_DAYS),
  };
  return { kind: "started", lifecycle: nextLifecycle };
}

export function resubscribeChannel(input: Readonly<{
  lifecycle: ChannelLifecycleRecord;
  entitlement: ChannelEntitlement | null;
  now?: Date;
}>): ChannelResubscriptionResult {
  const parsed = ChannelLifecycleRecordSchema.safeParse(input.lifecycle);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_lifecycle" };
  const now = input.now ?? new Date();
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };
  if (parsed.data.state !== "read_only_grace") {
    return {
      kind: "blocked",
      reason:
        parsed.data.state === "cleanup_pending"
          ? "cleanup_already_started"
          : "not_in_grace",
    };
  }
  const graceEndsAt = dateFrom(parsed.data.graceEndsAt);
  if (!graceEndsAt || now.getTime() >= graceEndsAt.getTime()) {
    return { kind: "blocked", reason: "grace_expired" };
  }
  if (
    !input.entitlement ||
    input.entitlement.verified !== true ||
    (input.entitlement.state !== "active_pro" &&
      input.entitlement.state !== "pro_pending_cancellation")
  ) {
    return { kind: "blocked", reason: "entitlement_unavailable" };
  }

  return {
    kind: "resubscribed",
    lifecycle: {
      ...parsed.data,
      state: "active",
      graceStartedAt: null,
      graceEndsAt: null,
    },
  };
}

export function expireChannelReadOnlyGracePeriod(input: Readonly<{
  lifecycle: ChannelLifecycleRecord;
  now?: Date;
}>): ChannelGraceExpiryResult {
  const parsed = ChannelLifecycleRecordSchema.safeParse(input.lifecycle);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_lifecycle" };
  const now = input.now ?? new Date();
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };
  if (parsed.data.state === "deleted") {
    return { kind: "blocked", reason: "already_deleted" };
  }
  if (parsed.data.state !== "read_only_grace") {
    return { kind: "blocked", reason: "not_in_grace" };
  }
  const graceEndsAt = dateFrom(parsed.data.graceEndsAt);
  if (!graceEndsAt || now.getTime() < graceEndsAt.getTime()) {
    return { kind: "blocked", reason: "grace_not_expired" };
  }

  return {
    kind: "cleanup_required",
    lifecycle: {
      ...parsed.data,
      state: "cleanup_pending",
    },
  };
}

/**
 * Authorize Channel work and lifecycle controls from the same server-owned
 * record. Paid actions stop at the grace transition; owner controls remain
 * available until cleanup actually begins.
 */
export function authorizeChannelLifecycleAction(input: Readonly<{
  action: ChannelLifecycleAction;
  access: ChannelAccessContext;
  lifecycle: ChannelLifecycleRecord;
  replyControl?: ChannelReplyControl | null;
  now?: Date;
}>): ChannelLifecycleAuthorizationDecision {
  const action = input.action;
  const parsed = ChannelLifecycleRecordSchema.safeParse(input.lifecycle);
  if (!parsed.success) return deny(action, "invalid_lifecycle");

  const lifecycle = parsed.data;
  if (!input.access.principal) {
    return deny(action, "authenticated_identity_required");
  }
  if (!isRegisteredOwner(input.access, lifecycle)) {
    return deny(action, "owner_mismatch");
  }

  const now = input.now ?? new Date();
  if (!validNow(now)) return deny(action, "invalid_clock");

  if (action === "delete_published_reply") {
    return authorizeProductReplyDeletion({
      access: input.access,
      lifecycle,
      replyControl: input.replyControl,
      now,
    });
  }

  const graceEndsAt = dateFrom(lifecycle.graceEndsAt);
  const graceExpired =
    lifecycle.state === "read_only_grace" &&
    (!graceEndsAt || now.getTime() >= graceEndsAt.getTime());

  if (action === "scan" || action === "draft" || action === "publication") {
    if (lifecycle.state === "read_only_grace") {
      return deny(action, graceExpired ? "grace_expired" : "read_only_grace");
    }
    if (lifecycle.state !== "active") {
      if (!hasActiveAuthorizationAndLocalData(lifecycle)) {
        return {
          ...deny(action, "provider_authorization_removed"),
          guidance: buildYouTubeDeletionGuidance(),
        };
      }
      return deny(action, "lifecycle_unavailable");
    }

    if (!hasActiveAuthorizationAndLocalData(lifecycle)) {
      return {
        ...deny(action, "provider_authorization_removed"),
        guidance: buildYouTubeDeletionGuidance(),
      };
    }

    const accessDecision = authorizeChannelAction(action, input.access);
    return accessDecision.allowed
      ? { allowed: true, action }
      : { allowed: false, action, reason: accessDecision.reason };
  }

  if (action === "delete" || action === "disconnect") {
    if (input.access.persistenceAvailable !== true) {
      return deny(action, "persistence_unavailable");
    }
    return { allowed: true, action };
  }

  if (lifecycle.state === "deleted" || lifecycle.localDataStatus === "deleted") {
    return {
      ...deny(action, "local_data_deleted"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }
  if (
    lifecycle.grantStatus !== "active" ||
    lifecycle.provenanceStatus !== "active"
  ) {
    return {
      ...deny(action, "provider_authorization_removed"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }
  if (lifecycle.state === "cleanup_pending") {
    return deny(action, "lifecycle_unavailable");
  }
  if (graceExpired) return deny(action, "grace_expired");
  if (input.access.persistenceAvailable !== true) {
    return deny(action, "persistence_unavailable");
  }

  return { allowed: true, action };
}

export function buildYouTubeDeletionGuidance(): ChannelYouTubeDeletionGuidance {
  return {
    kind: "youtube_instructions",
    title: "Delete remaining Public Replies on YouTube",
    url: CHANNEL_GOOGLE_REVOCATION_URL,
    message:
      "This Channel grant or reply provenance is no longer available. Open your Google account permissions and YouTube Studio to review and delete any remaining Public Replies.",
  };
}

/**
 * Keep product-assisted deletion honest: once the original grant or its
 * refreshed provenance is gone, the only safe promise is a YouTube handoff.
 */
export function authorizeProductReplyDeletion(input: Readonly<{
  access: ChannelAccessContext;
  lifecycle: ChannelLifecycleRecord;
  replyControl?: ChannelReplyControl | null;
  now?: Date;
}>): ChannelLifecycleAuthorizationDecision {
  const action: ChannelLifecycleAction = "delete_published_reply";
  const parsed = ChannelLifecycleRecordSchema.safeParse(input.lifecycle);
  if (!parsed.success) return deny(action, "invalid_lifecycle");
  if (!isRegisteredOwner(input.access, parsed.data)) {
    return deny(action, "owner_mismatch");
  }
  if (input.access.persistenceAvailable !== true) {
    return deny(action, "persistence_unavailable");
  }

  const lifecycle = parsed.data;
  if (
    lifecycle.grantStatus !== "active" ||
    lifecycle.provenanceStatus !== "active"
  ) {
    return {
      ...deny(action, "provider_authorization_removed"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }
  if (lifecycle.localDataStatus === "deleted") {
    return {
      ...deny(action, "local_data_deleted"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }

  const parsedReplyControl = input.replyControl
    ? ChannelReplyControlSchema.safeParse(input.replyControl)
    : null;
  if (!parsedReplyControl?.success || parsedReplyControl.data.status !== "active") {
    return {
      ...deny(action, "reply_control_unavailable"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }
  const replyControl = parsedReplyControl.data;
  if (
    replyControl.ownerId !== lifecycle.ownerId ||
    replyControl.channelId !== lifecycle.channelId ||
    replyControl.connectedChannelId !== lifecycle.connectedChannelId ||
    replyControl.grantId !== lifecycle.grantId
  ) {
    return {
      ...deny(action, "reply_control_mismatch"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }

  const now = input.now ?? new Date();
  const refreshedAt = dateFrom(replyControl.lastRefreshedAt);
  if (!validNow(now) || !refreshedAt) return deny(action, "invalid_clock");
  if (
    now.getTime() >=
    refreshedAt.getTime() + CHANNEL_API_DATA_RETENTION_DAYS * DAY_MS
  ) {
    return {
      ...deny(action, "provenance_expired"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }

  const graceEndsAt = dateFrom(lifecycle.graceEndsAt);
  if (lifecycle.state === "read_only_grace") {
    if (!graceEndsAt || now.getTime() >= graceEndsAt.getTime()) {
      return {
        ...deny(action, "grace_expired"),
        guidance: buildYouTubeDeletionGuidance(),
      };
    }
  } else if (lifecycle.state === "cleanup_pending") {
    // Disconnect and account-deletion cleanup is intentionally pending while
    // the owner still has a live grant. Grace-expiry cleanup is different:
    // its grace dates prove the product-assisted window has closed.
    if (lifecycle.graceStartedAt !== null || lifecycle.graceEndsAt !== null) {
      return {
        ...deny(action, "grace_expired"),
        guidance: buildYouTubeDeletionGuidance(),
      };
    }
  } else if (lifecycle.state !== "active") {
    return {
      ...deny(action, "lifecycle_unavailable"),
      guidance: buildYouTubeDeletionGuidance(),
    };
  }

  return { allowed: true, action };
}

function replyControlRetentionDeadline(
  replyControl: ChannelReplyControl,
): Date | null {
  const lastRefreshedAt = dateFrom(replyControl.lastRefreshedAt);
  if (!lastRefreshedAt) return null;
  return new Date(
    lastRefreshedAt.getTime() + CHANNEL_API_DATA_RETENTION_DAYS * DAY_MS,
  );
}

/**
 * Reply controls are bounded provenance, not a permanent publication log.
 * They must be refreshed by a provider-backed operation or deleted at the
 * same 30-day boundary as other identifying YouTube API Data.
 */
export function evaluateChannelReplyControlRetention(input: Readonly<{
  replyControl: ChannelReplyControl;
  now?: Date;
}>): ChannelReplyControlRetentionEvaluation {
  const parsed = ChannelReplyControlSchema.safeParse(input.replyControl);
  if (!parsed.success) {
    return { action: "delete", reason: "invalid_timestamp" };
  }
  if (parsed.data.status === "deleted") {
    return { action: "already_deleted" };
  }

  const now = input.now ?? new Date();
  const deadline = replyControlRetentionDeadline(parsed.data);
  if (!validNow(now) || !deadline) {
    return { action: "delete", reason: "invalid_timestamp" };
  }
  if (now.getTime() < deadline.getTime()) {
    return { action: "retain", expiresAt: deadline.toISOString() };
  }
  return {
    action: "refresh_or_delete",
    dueAt: deadline.toISOString(),
    deleteBy: deadline.toISOString(),
  };
}

/**
 * Persist a provider-verified provenance refresh. This function does not
 * perform the provider read itself, so callers must invoke it only after that
 * read has succeeded.
 */
export function refreshChannelReplyControl(input: Readonly<{
  replyControl: ChannelReplyControl;
  now?: Date;
}>): ChannelReplyControlRefreshResult {
  const parsed = ChannelReplyControlSchema.safeParse(input.replyControl);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_control" };
  if (parsed.data.status === "deleted") {
    return { kind: "blocked", reason: "already_deleted" };
  }

  const now = input.now ?? new Date();
  const deadline = replyControlRetentionDeadline(parsed.data);
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };
  if (!deadline || now.getTime() > deadline.getTime()) {
    return { kind: "blocked", reason: "retention_window_expired" };
  }

  return {
    kind: "refreshed",
    replyControl: {
      ...parsed.data,
      lastRefreshedAt: now.toISOString(),
    },
  };
}

export const ChannelCleanupReasonSchema = z.enum([
  "disconnect",
  "account_deletion",
  "grace_expiry",
]);
export type ChannelCleanupReason = z.infer<typeof ChannelCleanupReasonSchema>;

export const ChannelCleanupStatusSchema = z.enum([
  "pending",
  "running",
  "retryable",
  "completed",
  "escalated",
  "cancelled",
]);
export type ChannelCleanupStatus = z.infer<typeof ChannelCleanupStatusSchema>;

const CleanupReplyDecisionSchema = z.enum([
  "not_required",
  "pending",
  "delete_requested",
  "skip_requested",
  "timed_out",
]);

const CleanupReplyStatusSchema = z.enum([
  "not_required",
  "pending",
  "completed",
  "skipped",
  "failed",
  "instructions_required",
]);
type CleanupReplyStatus = z.infer<typeof CleanupReplyStatusSchema>;

const CleanupOperationStatusSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
]);
type CleanupOperationStatus = z.infer<
  typeof CleanupOperationStatusSchema
>;

export const ChannelCleanupJobSchema = z
  .object({
    id: LifecycleIdSchema,
    ownerId: LifecycleIdSchema,
    channelId: LifecycleIdSchema,
    connectedChannelId: LifecycleIdSchema,
    grantId: LifecycleIdSchema,
    reason: ChannelCleanupReasonSchema,
    status: ChannelCleanupStatusSchema,
    createdAt: LifecycleInstantSchema,
    deadlineAt: LifecycleInstantSchema,
    nextAttemptAt: LifecycleInstantSchema,
    attemptCount: z.number().int().nonnegative(),
    replyDeletionDecision: CleanupReplyDecisionSchema,
    replyDeletionStatus: CleanupReplyStatusSchema,
    grantRevocationStatus: CleanupOperationStatusSchema,
    localDeletionStatus: CleanupOperationStatusSchema,
    lastErrorCode: z.string().trim().min(1).max(80).nullable(),
    escalatedAt: LifecycleInstantSchema.nullable(),
    cancelledAt: LifecycleInstantSchema.nullable().optional(),
    completedAt: LifecycleInstantSchema.nullable().optional(),
  })
  .strict();
export type ChannelCleanupJob = z.infer<typeof ChannelCleanupJobSchema>;

export type ChannelReplyDeletionOffer =
  | Readonly<{
      kind: "offered";
      controlCount: number;
      message: string;
    }>
  | Readonly<{ kind: "not_required" }>
  | Readonly<{
      kind: "instructions_only";
      guidance: ChannelYouTubeDeletionGuidance;
    }>;

export type ChannelCleanupPlanResult =
  | Readonly<{
      kind: "planned";
      job: ChannelCleanupJob;
      replyDeletionOffer: ChannelReplyDeletionOffer;
      lifecycle: ChannelLifecycleRecord;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_lifecycle"
        | "invalid_clock"
        | "grace_period_required";
    }>;

export type ChannelCleanupReplyChoiceResult =
  | Readonly<{ kind: "updated"; job: ChannelCleanupJob }>
  | Readonly<{
      kind: "blocked";
      reason: "invalid_job" | "reply_deletion_not_pending" | "cleanup_complete";
    }>;

export type ChannelProviderCleanupResult = "succeeded" | "already_absent";

export interface ChannelCleanupProvider {
  deletePublishedReply(
    replyControl: ChannelReplyControl,
  ): Promise<ChannelProviderCleanupResult>;
  revokeGrant(grantId: string): Promise<ChannelProviderCleanupResult>;
}

export type ChannelLocalDeletionResult = "deleted" | "already_deleted";

export interface ChannelCleanupPersistence {
  recordCleanupAttempt(attempt: ChannelCleanupAttempt): Promise<void>;
  saveCleanupJob(job: ChannelCleanupJob): Promise<void>;
}

export type ChannelCleanupAttempt = Readonly<{
  jobId: string;
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  outcome: Exclude<ChannelCleanupStatus, "pending" | "running">;
  replyDeletionStatus: CleanupReplyStatus;
  grantRevocationStatus: CleanupOperationStatus;
  localDeletionStatus: CleanupOperationStatus;
  errorCode: string | null;
}>;

export type ChannelCleanupAttemptResult =
  | Readonly<{
      kind: "not_due";
      job: ChannelCleanupJob;
      reason:
        | "scheduled_for_later"
        | "cleanup_complete"
        | "cleanup_cancelled"
        | "cleanup_escalated";
    }>
  | Readonly<{
      kind: "awaiting_user";
      job: ChannelCleanupJob;
      replyDeletionOffer: ChannelReplyDeletionOffer;
    }>
  | Readonly<{
      kind: "completed" | "retryable" | "escalated";
      job: ChannelCleanupJob;
      attempt: ChannelCleanupAttempt;
      guidance?: ChannelYouTubeDeletionGuidance;
    }>
  | Readonly<{
      kind: "persistence_failed";
      job: ChannelCleanupJob;
      errorCode: "cleanup_persistence_failed";
    }>;

export type ChannelCleanupLifecycleApplyResult =
  | Readonly<{
      kind: "applied";
      lifecycle: ChannelLifecycleRecord;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_lifecycle"
        | "invalid_job"
        | "invalid_clock"
        | "cleanup_not_complete"
        | "cleanup_cancelled";
      lifecycle?: ChannelLifecycleRecord;
    }>;

function matchingActiveReplyControls(
  lifecycle: ChannelLifecycleRecord,
  replyControls: readonly ChannelReplyControl[],
): ChannelReplyControl[] {
  return replyControls.filter((replyControl) => {
    const parsed = ChannelReplyControlSchema.safeParse(replyControl);
    return Boolean(
      parsed.success &&
        parsed.data.status === "active" &&
        parsed.data.ownerId === lifecycle.ownerId &&
        parsed.data.channelId === lifecycle.channelId &&
        parsed.data.connectedChannelId === lifecycle.connectedChannelId &&
        parsed.data.grantId === lifecycle.grantId,
    );
  });
}

function matchingFreshReplyControls(
  lifecycle: ChannelLifecycleRecord,
  replyControls: readonly ChannelReplyControl[],
  now: Date,
): ChannelReplyControl[] {
  const activeControls = matchingActiveReplyControls(lifecycle, replyControls);
  return activeControls.filter((replyControl) => {
    const refreshedAt = dateFrom(replyControl.lastRefreshedAt);
    return Boolean(
      refreshedAt &&
        now.getTime() <
          refreshedAt.getTime() + CHANNEL_API_DATA_RETENTION_DAYS * DAY_MS,
    );
  });
}

function lifecycleForCleanupJob(
  job: ChannelCleanupJob,
  now: Date,
): ChannelLifecycleRecord {
  return {
    ownerId: job.ownerId,
    channelId: job.channelId,
    connectedChannelId: job.connectedChannelId,
    grantId: job.grantId,
    state: "active",
    graceStartedAt: null,
    graceEndsAt: null,
    grantStatus: "active",
    provenanceStatus: "active",
    provenanceRefreshedAt: now.toISOString(),
    localDataStatus: "retained",
  };
}

function replyDeletionOffer(
  lifecycle: ChannelLifecycleRecord,
  replyControls: readonly ChannelReplyControl[],
  now: Date,
): ChannelReplyDeletionOffer {
  const matchingControls = matchingActiveReplyControls(
    lifecycle,
    replyControls,
  );
  const freshControls = matchingFreshReplyControls(lifecycle, replyControls, now);
  if (
    lifecycle.grantStatus === "active" &&
    lifecycle.provenanceStatus === "active" &&
    freshControls.length > 0
  ) {
    return {
      kind: "offered",
      controlCount: freshControls.length,
      message:
        "Delete product-published Public Replies before the Channel grant and provenance are removed.",
    };
  }
  if (
    lifecycle.grantStatus === "active" &&
    lifecycle.provenanceStatus === "active" &&
    matchingControls.length > 0
  ) {
    return {
      kind: "instructions_only",
      guidance: buildYouTubeDeletionGuidance(),
    };
  }
  if (
    lifecycle.grantStatus !== "active" ||
    lifecycle.provenanceStatus !== "active"
  ) {
    return {
      kind: "instructions_only",
      guidance: buildYouTubeDeletionGuidance(),
    };
  }
  return { kind: "not_required" };
}

/**
 * Create an idempotent-shaped compliance job. Disconnect and account
 * deletion begin immediately; grace expiry is durable from the downgrade but
 * cannot run until the seven-day boundary.
 */
export function planChannelCleanup(input: Readonly<{
  lifecycle: ChannelLifecycleRecord;
  reason: ChannelCleanupReason;
  replyControls: readonly ChannelReplyControl[];
  now?: Date;
}>): ChannelCleanupPlanResult {
  const parsed = ChannelLifecycleRecordSchema.safeParse(input.lifecycle);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_lifecycle" };
  const now = input.now ?? new Date();
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };

  const lifecycle = parsed.data;
  let deadline: Date;
  let nextAttemptAt: Date;
  if (input.reason === "grace_expiry") {
    const hasGraceWindow =
      lifecycle.graceStartedAt !== null && lifecycle.graceEndsAt !== null;
    if (
      lifecycle.state !== "read_only_grace" &&
      !(lifecycle.state === "cleanup_pending" && hasGraceWindow)
    ) {
      return { kind: "blocked", reason: "grace_period_required" };
    }
    const graceEndsAt = dateFrom(lifecycle.graceEndsAt);
    if (!graceEndsAt) return { kind: "blocked", reason: "invalid_lifecycle" };
    deadline = graceEndsAt;
    nextAttemptAt =
      now.getTime() < graceEndsAt.getTime() ? graceEndsAt : now;
  } else {
    deadline = new Date(
      now.getTime() + CHANNEL_CLEANUP_DEADLINE_DAYS * DAY_MS,
    );
    nextAttemptAt = now;
  }

  const offer = replyDeletionOffer(lifecycle, input.replyControls, now);
  const hasReplyDeletionOffer = offer.kind === "offered";
  const job: ChannelCleanupJob = {
    id: `channel-cleanup:${input.reason}:${lifecycle.channelId}:${deadline.toISOString()}`,
    ownerId: lifecycle.ownerId,
    channelId: lifecycle.channelId,
    connectedChannelId: lifecycle.connectedChannelId,
    grantId: lifecycle.grantId,
    reason: input.reason,
    status: "pending",
    createdAt: now.toISOString(),
    deadlineAt: deadline.toISOString(),
    nextAttemptAt: nextAttemptAt.toISOString(),
    attemptCount: 0,
    replyDeletionDecision:
      input.reason !== "grace_expiry" && hasReplyDeletionOffer
        ? "pending"
        : "not_required",
    replyDeletionStatus:
      input.reason !== "grace_expiry" && hasReplyDeletionOffer
        ? "pending"
        : offer.kind === "instructions_only"
          ? "instructions_required"
          : "not_required",
    grantRevocationStatus: "pending",
    localDeletionStatus: "pending",
    lastErrorCode: null,
    escalatedAt: null,
  };

  return {
    kind: "planned",
    job: ChannelCleanupJobSchema.parse(job),
    replyDeletionOffer: offer,
    lifecycle:
      input.reason === "grace_expiry"
        ? lifecycle
        : { ...lifecycle, state: "cleanup_pending" },
  };
}

export function chooseCleanupReplyDeletion(input: Readonly<{
  job: ChannelCleanupJob;
  choice: "delete" | "skip";
}>): ChannelCleanupReplyChoiceResult {
  const parsed = ChannelCleanupJobSchema.safeParse(input.job);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_job" };
  if (
    parsed.data.status === "completed" ||
    parsed.data.status === "cancelled" ||
    parsed.data.status === "escalated" ||
    parsed.data.localDeletionStatus === "succeeded"
  ) {
    return { kind: "blocked", reason: "cleanup_complete" };
  }
  if (parsed.data.replyDeletionDecision !== "pending") {
    return { kind: "blocked", reason: "reply_deletion_not_pending" };
  }

  return {
    kind: "updated",
    job: {
      ...parsed.data,
      replyDeletionDecision:
        input.choice === "delete" ? "delete_requested" : "skip_requested",
      replyDeletionStatus: input.choice === "delete" ? "pending" : "skipped",
    },
  };
}

export function isChannelCleanupEscalationDue(
  job: ChannelCleanupJob,
  now: Date = new Date(),
): boolean {
  const parsed = ChannelCleanupJobSchema.safeParse(job);
  if (!parsed.success || !validNow(now)) return false;
  if (
    parsed.data.status === "completed" ||
    parsed.data.status === "cancelled" ||
    parsed.data.status === "escalated"
  ) {
    return false;
  }
  const deadline = dateFrom(parsed.data.deadlineAt);
  if (!deadline) return true;
  return (
    now.getTime() >=
    deadline.getTime() - CHANNEL_CLEANUP_ESCALATION_LEAD_DAYS * DAY_MS
  );
}

function retryAt(job: ChannelCleanupJob, now: Date): string {
  const deadline = dateFrom(job.deadlineAt);
  const delay = Math.min(
    60 * 60 * 1_000,
    Math.max(60 * 1_000, 2 ** Math.min(job.attemptCount, 6) * 60 * 1_000),
  );
  const candidate = new Date(now.getTime() + delay);
  if (!deadline) return candidate.toISOString();
  return new Date(Math.min(candidate.getTime(), deadline.getTime())).toISOString();
}

/**
 * Execute one claimed cleanup attempt. Provider failures never prevent the
 * local deletion attempt, and durable persistence happens before a success
 * result is returned to a caller.
 */
export async function runChannelCleanupAttempt(input: Readonly<{
  job: ChannelCleanupJob;
  replyControls: readonly ChannelReplyControl[];
  provider: ChannelCleanupProvider;
  deleteLocalChannelData: (input: Readonly<{
    ownerId: string;
    channelId: string;
  }>) => Promise<ChannelLocalDeletionResult>;
  persistence: ChannelCleanupPersistence;
  now?: Date;
}>): Promise<ChannelCleanupAttemptResult> {
  const parsed = ChannelCleanupJobSchema.safeParse(input.job);
  if (!parsed.success) {
    return {
      kind: "persistence_failed",
      job: input.job,
      errorCode: "cleanup_persistence_failed",
    };
  }
  const job = parsed.data;
  const now = input.now ?? new Date();
  if (!validNow(now)) {
    return {
      kind: "persistence_failed",
      job,
      errorCode: "cleanup_persistence_failed",
    };
  }
  if (job.status === "completed") {
    return { kind: "not_due", job, reason: "cleanup_complete" };
  }
  if (job.status === "cancelled") {
    return { kind: "not_due", job, reason: "cleanup_cancelled" };
  }
  if (job.status === "escalated") {
    return { kind: "not_due", job, reason: "cleanup_escalated" };
  }
  const nextAttemptAt = dateFrom(job.nextAttemptAt);
  if (nextAttemptAt && now.getTime() < nextAttemptAt.getTime()) {
    return { kind: "not_due", job, reason: "scheduled_for_later" };
  }
  let replyDeletionDecision = job.replyDeletionDecision;
  let replyDeletionChoiceTimedOut = false;
  if (replyDeletionDecision === "pending") {
    if (isChannelCleanupEscalationDue(job, now)) {
      // A missing answer must not hold local deletion past the compliance
      // deadline. This chooses the safe side: leave the public reply alone,
      // complete local cleanup, and hand the owner to YouTube.
      replyDeletionDecision = "timed_out";
      replyDeletionChoiceTimedOut = true;
    } else {
      return {
        kind: "awaiting_user",
        job,
        replyDeletionOffer: {
          kind: "offered",
          controlCount: matchingFreshReplyControls(
            lifecycleForCleanupJob(job, now),
            input.replyControls,
            now,
          ).length,
          message:
            "Choose whether to delete product-published Public Replies before cleanup removes the grant and provenance.",
        },
      };
    }
  }

  const attemptNumber = job.attemptCount + 1;
  const startedAt = now.toISOString();
  const cleanupLifecycle = lifecycleForCleanupJob(job, now);
  const activeControls = matchingActiveReplyControls(
    cleanupLifecycle,
    input.replyControls,
  );
  const controls = matchingFreshReplyControls(
    cleanupLifecycle,
    input.replyControls,
    now,
  );

  let replyDeletionStatus: CleanupReplyStatus =
    job.replyDeletionStatus === "instructions_required"
      ? "instructions_required"
      : replyDeletionDecision === "skip_requested" ||
          replyDeletionDecision === "timed_out"
        ? "skipped"
        : replyDeletionDecision === "not_required"
          ? "not_required"
          : "completed";
  let replyDeletionFailed = false;
  if (replyDeletionDecision === "delete_requested") {
    const providerReplyDeletionStillAvailable =
      job.grantRevocationStatus !== "succeeded" &&
      job.localDeletionStatus !== "succeeded";
    if (!providerReplyDeletionStillAvailable) {
      replyDeletionStatus = "instructions_required";
    } else if (
      job.replyDeletionStatus === "completed"
    ) {
      replyDeletionStatus = "completed";
    } else if (
      activeControls.length === 0 ||
      activeControls.length !== controls.length
    ) {
      replyDeletionStatus = "instructions_required";
    } else {
      for (const replyControl of controls) {
        try {
          const result = await input.provider.deletePublishedReply(replyControl);
          if (result !== "succeeded" && result !== "already_absent") {
            replyDeletionFailed = true;
          }
        } catch {
          replyDeletionFailed = true;
        }
      }
      if (replyDeletionFailed) replyDeletionStatus = "failed";
    }
  }

  let grantRevocationStatus: CleanupOperationStatus = "failed";
  let grantRevocationFailed = false;
  let grantAlreadyAbsent = false;
  try {
    const result = await input.provider.revokeGrant(job.grantId);
    if (result === "succeeded" || result === "already_absent") {
      grantRevocationStatus = "succeeded";
      grantAlreadyAbsent = result === "already_absent";
    } else {
      grantRevocationFailed = true;
    }
  } catch {
    grantRevocationFailed = true;
  }

  let localDeletionStatus: CleanupOperationStatus = "failed";
  let localDeletionFailed = false;
  try {
    const result = await input.deleteLocalChannelData({
      ownerId: job.ownerId,
      channelId: job.channelId,
    });
    if (result === "deleted" || result === "already_deleted") {
      localDeletionStatus = "succeeded";
    } else {
      localDeletionFailed = true;
    }
  } catch {
    localDeletionFailed = true;
  }

  const hasFailure =
    replyDeletionFailed || grantRevocationFailed || localDeletionFailed;
  const escalationDue = isChannelCleanupEscalationDue(job, now);
  const kind: "completed" | "retryable" | "escalated" = !hasFailure
    ? "completed"
    : escalationDue
      ? "escalated"
      : "retryable";
  const errorCode = localDeletionFailed
    ? "local_deletion_failed"
    : grantRevocationFailed
      ? "grant_revocation_failed"
      : replyDeletionFailed
        ? "reply_deletion_failed"
        : replyDeletionChoiceTimedOut
          ? "reply_deletion_choice_expired"
          : null;
  const nextJob: ChannelCleanupJob = {
    ...job,
    status: kind,
    nextAttemptAt: kind === "retryable" ? retryAt(job, now) : now.toISOString(),
    attemptCount: attemptNumber,
    replyDeletionDecision,
    replyDeletionStatus,
    grantRevocationStatus,
    localDeletionStatus,
    lastErrorCode: errorCode,
    escalatedAt:
      kind === "escalated" ? now.toISOString() : job.escalatedAt,
    completedAt: kind === "completed" ? now.toISOString() : job.completedAt,
  };
  const attempt: ChannelCleanupAttempt = {
    jobId: job.id,
    attemptNumber,
    startedAt,
    completedAt: now.toISOString(),
    outcome: kind,
    replyDeletionStatus,
    grantRevocationStatus,
    localDeletionStatus,
    errorCode,
  };

  try {
    await input.persistence.recordCleanupAttempt(attempt);
    await input.persistence.saveCleanupJob(nextJob);
  } catch {
    return {
      kind: "persistence_failed",
      job: nextJob,
      errorCode: "cleanup_persistence_failed",
    };
  }

  const needsYouTubeGuidance =
    grantRevocationFailed ||
    grantAlreadyAbsent ||
    replyDeletionFailed ||
    replyDeletionStatus === "skipped" ||
    replyDeletionStatus === "instructions_required";
  return {
    kind,
    job: nextJob,
    attempt,
    ...(needsYouTubeGuidance
      ? { guidance: buildYouTubeDeletionGuidance() }
      : {}),
  };
}

/**
 * Apply only provider/local outcomes that are durably known to the lifecycle.
 * A retryable or escalated job remains cleanup-pending; it is never presented
 * as deleted until both the grant and local data deletion have succeeded.
 */
export function applyChannelCleanupResultToLifecycle(input: Readonly<{
  lifecycle: ChannelLifecycleRecord;
  job: ChannelCleanupJob;
  now?: Date;
}>): ChannelCleanupLifecycleApplyResult {
  const parsedLifecycle = ChannelLifecycleRecordSchema.safeParse(
    input.lifecycle,
  );
  if (!parsedLifecycle.success) {
    return { kind: "blocked", reason: "invalid_lifecycle" };
  }
  const parsedJob = ChannelCleanupJobSchema.safeParse(input.job);
  if (!parsedJob.success) return { kind: "blocked", reason: "invalid_job" };
  const now = input.now ?? new Date();
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };

  const lifecycle = parsedLifecycle.data;
  const job = parsedJob.data;
  if (job.status === "cancelled") {
    return { kind: "blocked", reason: "cleanup_cancelled", lifecycle };
  }
  if (job.status === "pending" || job.status === "running") {
    return { kind: "blocked", reason: "cleanup_not_complete", lifecycle };
  }

  const grantRevoked =
    lifecycle.grantStatus === "revoked" ||
    job.grantRevocationStatus === "succeeded";
  const localDeleted =
    lifecycle.localDataStatus === "deleted" ||
    job.localDeletionStatus === "succeeded";
  const provenanceRemoved =
    lifecycle.provenanceStatus === "removed" || grantRevoked || localDeleted;
  const complete = grantRevoked && localDeleted;

  return {
    kind: "applied",
    lifecycle: {
      ...lifecycle,
      state: complete ? "deleted" : "cleanup_pending",
      graceStartedAt: complete ? null : lifecycle.graceStartedAt,
      graceEndsAt: complete ? null : lifecycle.graceEndsAt,
      grantStatus: grantRevoked ? "revoked" : lifecycle.grantStatus,
      provenanceStatus: provenanceRemoved ? "removed" : lifecycle.provenanceStatus,
      provenanceRefreshedAt: provenanceRemoved
        ? null
        : lifecycle.provenanceRefreshedAt,
      localDataStatus: localDeleted ? "deleted" : lifecycle.localDataStatus,
    },
  };
}

function retentionDeadline(record: ChannelRetentionRecord): Date | null {
  const lastRetainedAt = dateFrom(record.refreshedAt ?? record.retainedAt);
  if (!lastRetainedAt) return null;
  return new Date(
    lastRetainedAt.getTime() + CHANNEL_API_DATA_RETENTION_DAYS * DAY_MS,
  );
}

/**
 * Decide what a retention worker must do without ever treating an aggregate
 * as permission to keep identifying API data. At the deadline, a failed or
 * unavailable refresh becomes a delete operation.
 */
export function evaluateChannelRetention(input: Readonly<{
  record: ChannelRetentionRecord;
  now?: Date;
  canRefresh: boolean;
}>): ChannelRetentionEvaluation {
  const parsed = ChannelRetentionRecordSchema.safeParse(input.record);
  if (!parsed.success) {
    return { action: "delete", reason: "invalid_timestamp" };
  }
  if (parsed.data.deletedAt !== null) {
    return { action: "already_deleted", deletedAt: parsed.data.deletedAt };
  }
  if (parsed.data.kind === "aggregate") {
    return { action: "retain_aggregate" };
  }

  const now = input.now ?? new Date();
  const deadline = retentionDeadline(parsed.data);
  if (!validNow(now) || !deadline) {
    return { action: "delete", reason: "invalid_timestamp" };
  }
  if (now.getTime() < deadline.getTime()) {
    return { action: "retain", expiresAt: deadline.toISOString() };
  }
  if (input.canRefresh === true) {
    return {
      action: "refresh_or_delete",
      dueAt: deadline.toISOString(),
      deleteBy: deadline.toISOString(),
    };
  }
  return { action: "delete", reason: "retention_expired" };
}

/**
 * Record a successful provider refresh. Refreshing after the policy deadline
 * is rejected so a stale local record cannot be used to extend retention.
 */
export function refreshChannelData(input: Readonly<{
  record: ChannelRetentionRecord;
  now?: Date;
}>): ChannelRetentionRefreshResult {
  const parsed = ChannelRetentionRecordSchema.safeParse(input.record);
  if (!parsed.success) return { kind: "blocked", reason: "invalid_record" };
  if (parsed.data.kind === "aggregate") {
    return { kind: "blocked", reason: "aggregate_not_refreshable" };
  }
  if (parsed.data.deletedAt !== null) {
    return { kind: "blocked", reason: "already_deleted" };
  }

  const now = input.now ?? new Date();
  const deadline = retentionDeadline(parsed.data);
  if (!validNow(now)) return { kind: "blocked", reason: "invalid_clock" };
  if (!deadline || now.getTime() > deadline.getTime()) {
    return { kind: "blocked", reason: "retention_window_expired" };
  }

  return {
    kind: "refreshed",
    record: {
      ...parsed.data,
      refreshedAt: now.toISOString(),
    },
  };
}
