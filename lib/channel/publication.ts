import { createHash } from "node:crypto";

export const PUBLIC_REPLY_DAILY_LIMIT = 10 as const;
export const PUBLIC_REPLY_WRITE_SCOPE = "youtube.force-ssl" as const;
export const MAX_PUBLIC_REPLY_TEXT_LENGTH = 4_000 as const;

const ACTIVE_PRO_STATES = new Set<PublicationEntitlementState>([
  "active_pro",
  "pro_pending_cancellation",
]);

export type PublicationEntitlementState =
  | "active_pro"
  | "pro_pending_cancellation"
  | "free"
  | "billing_issue"
  | "unavailable";

export type PublicationAccount = Readonly<{
  accountId: string;
  entitlement: Readonly<{
    state: PublicationEntitlementState;
    verified: boolean;
  }>;
}>;

export type ConnectedPublicationChannel = Readonly<{
  provider: "synthetic";
  accountId: string;
  channelId: string;
  connectedChannelId: string;
  grantId: string;
  providerChannelId: string;
  displayName: string;
  active: boolean;
}>;

export type PublishingAuthorization = Readonly<{
  grantId: string;
  status: "active" | "revoked";
  verified: boolean;
  scopes: readonly string[];
}>;

export type NestedCommentIdentity =
  | Readonly<{
      status: "verified";
      providerAuthorId: string;
      displayName: string;
    }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "ambiguous" }>;

export type PublicReplySourceContext = Readonly<{
  commentId: string;
  commentText: string;
  commentHash: string;
  video: Readonly<{
    id: string;
    title: string;
    uploadingChannel: string;
  }>;
  target:
    | Readonly<{ kind: "top_level" }>
    | Readonly<{
        kind: "nested";
        topLevelCommentId: string;
        identity: NestedCommentIdentity;
      }>;
}>;

export type ChannelReplyDraftStatus =
  | "draft_ready"
  | "publishing"
  | "stale"
  | "failed"
  | "published"
  | "publication_uncertain";

/**
 * #476 owns on-demand generation. This ticket deliberately consumes a
 * draft-shaped input and validates only the exact Steward-edited final text
 * before claiming a simulated publication.
 */
export type ChannelReplyDraft = Readonly<{
  id: string;
  accountId: string;
  channelId: string;
  connectedChannelId: string;
  grantId: string;
  providerChannelId: string;
  source: PublicReplySourceContext;
  generatedText: string;
  eligible: boolean;
  status: ChannelReplyDraftStatus;
}>;

export type FinalTextValidationFailure =
  | "empty"
  | "too_long"
  | "privacy"
  | "threat"
  | "impersonation"
  | "diagnosis"
  | "spam"
  | "link"
  | "instruction_echo";

export type FinalTextValidation =
  | Readonly<{
      valid: true;
      text: string;
    }>
  | Readonly<{
      valid: false;
      text: string;
      reason: FinalTextValidationFailure;
      failedChecks: readonly FinalTextValidationFailure[];
    }>;

export type PublicReplyTargetPlan = Readonly<{
  kind: "normal_thread_reply" | "sibling_thread_reply";
  parentCommentId: string;
  prefix: string | null;
  publishedText: string;
}>;

export type PublicationConfirmation = Readonly<{
  currentComment: Readonly<{
    id: string;
    text: string;
    hash: string;
  }>;
  video: Readonly<{
    id: string;
    title: string;
    uploadingChannel: string;
  }>;
  publishingIdentity: Readonly<{
    provider: "synthetic";
    connectedChannelId: string;
    channelId: string;
    providerChannelId: string;
    displayName: string;
  }>;
  finalText: string;
  publishedText: string;
  target: PublicReplyTargetPlan;
}>;

export type PublicReplyWrite = Readonly<{
  claimId: string;
  draftId: string;
  accountId: string;
  channelId: string;
  connectedChannelId: string;
  providerChannelId: string;
  commentId: string;
  parentCommentId: string;
  targetKind: PublicReplyTargetPlan["kind"];
  text: string;
  attemptedAt: string;
}>;

export type ChannelPublicReplyProvider = Readonly<{
  kind: "synthetic" | "separately_governed";
  publish(input: PublicReplyWrite): Promise<unknown>;
}>;

export type SyntheticPublicReplyProvider = ChannelPublicReplyProvider &
  Readonly<{
    kind: "synthetic";
    calls: readonly PublicReplyWrite[];
  }>;

export type PublicationBlockReason =
  | "account_identity_mismatch"
  | "pro_entitlement_required"
  | "channel_identity_unavailable"
  | "channel_identity_mismatch"
  | "publishing_authorization_required"
  | "publishing_authorization_mismatch"
  | "draft_unavailable"
  | "draft_not_publishable"
  | "current_comment_unavailable"
  | "current_comment_changed"
  | "stale_draft"
  | "final_text_rejected"
  | "daily_allowance_exhausted"
  | "item_claimed"
  | "already_published"
  | "publication_uncertain"
  | "non_synthetic_provider"
  | "clock_unavailable";

export type PublicReplyPublicationResult =
  | Readonly<{
      outcome: "published";
      providerReplyId: string;
      publishedAt: string;
      publishedText: string;
      confirmation: PublicationConfirmation;
    }>
  | Readonly<{
      outcome: "blocked";
      reason: PublicationBlockReason;
      confirmation?: PublicationConfirmation;
      validation?: FinalTextValidation;
    }>
  | Readonly<{
      outcome: "open_in_youtube";
      reason: "nested_identity_unavailable";
      url: string;
    }>
  | Readonly<{
      outcome: "failed";
      reason: "provider_rejected";
      retryable: true;
      confirmation: PublicationConfirmation;
    }>
  | Readonly<{
      outcome: "publication_uncertain";
      reason: "provider_result_unavailable";
      confirmation: PublicationConfirmation;
    }>;

export type PublicationClaim = Readonly<{
  claimId: string;
  draftId: string;
  write: PublicReplyWrite;
  confirmation: PublicationConfirmation;
}>;

export type PublicationClaimResult =
  | Readonly<{ outcome: "claimed"; claim: PublicationClaim }>
  | Extract<
      PublicReplyPublicationResult,
      { outcome: "blocked" | "open_in_youtube" }
    >;

type ProviderPublishedResult = Readonly<{
  outcome: "published";
  providerReplyId: string;
  publishedAt: string;
}>;

type ProviderRejectedResult = Readonly<{
  outcome: "rejected";
  reason: string;
}>;

export interface ChannelPublicationStore {
  /**
   * Revalidates all publication inputs and claims the item and one daily
   * allowance before any provider write is attempted.
   */
  claimPublication(input: Readonly<{
    accountId: string;
    draftId: string;
    finalText: string;
    now: Date;
  }>): Promise<PublicationClaimResult>;
  completePublication(input: Readonly<{
    claimId: string;
    providerReplyId: string;
    publishedAt: string;
  }>): Promise<void>;
  recordProviderRejection(input: Readonly<{ claimId: string }>): Promise<void>;
  markPublicationUncertain(input: Readonly<{ claimId: string }>): Promise<void>;
}

export type PublishedPublicReply = Readonly<{
  draftId: string;
  providerReplyId: string;
  publishedAt: string;
  text: string;
}>;

export type InMemoryChannelPublicationStore = ChannelPublicationStore &
  Readonly<{
    updateAccess(input: Readonly<{
      account?: PublicationAccount;
      activeConnectedChannel?: ConnectedPublicationChannel | null;
      publishingAuthorization?: PublishingAuthorization | null;
    }>): void;
    updateCurrentSource(
      draftId: string,
      source: PublicReplySourceContext | null,
    ): void;
    getDraft(draftId: string): ChannelReplyDraft | null;
    getPublishedReplies(): readonly PublishedPublicReply[];
    getDailyAttemptCount(accountId: string, day: string): number;
  }>;

export type CreateInMemoryChannelPublicationStoreInput = Readonly<{
  account: PublicationAccount;
  activeConnectedChannel: ConnectedPublicationChannel | null;
  publishingAuthorization: PublishingAuthorization | null;
  drafts: readonly ChannelReplyDraft[];
}>;

const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_PATTERN = /(?<!\w)\+?[\d][\d\s().-]{7,}[\d](?!\w)/u;
const STREET_ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Z0-9][\w.-]*(?:\s+[A-Z0-9][\w.-]*){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)\b/iu;
const THREAT_PATTERNS = [
  /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:going to|will)\s+(?:kill|hurt|dox|find)\b/iu,
  /\b(?:kill|hurt)\s+(?:yourself|you)\b/iu,
  /\b(?:you should|go)\s+(?:die|kill yourself)\b/iu,
  /\b(?:i|we)\s+(?:hope|want)\s+(?:you\s+)?die\b/iu,
  /\b(?:drop dead)\b/iu,
  /\b(?:i|we)\s+(?:know|will find)\s+where\s+you\s+live\b/iu,
  /(?:去死|杀了你|弄死你)/u,
];
const IMPERSONATION_PATTERN =
  /\b(?:i(?:'m| am)|this is|we are)\s+(?:official\s+)?(?:youtube|google|youtube support|a youtube moderator|the police)\b/iu;
const DIAGNOSIS_PATTERN =
  /\b(?:you(?:'re| are)|u\s+r|you have)\s+(?:a\s+)?(?:narcissist|psychopath|sociopath|mentally ill|bipolar|schizophrenic|depressed|depression|crazy|autistic)\b/iu;
const REPEATED_PHRASE_PATTERN =
  /\b(\w+(?:\s+\w+){1,4})\b(?:\s+\1){2,}/iu;
const REPEATED_CHARACTER_PATTERN = /(.)\1{7,}/u;
const URL_PATTERN =
  /(?:(?:[a-z][a-z0-9+.-]*):(?:\/\/)?)[^\s<>"']+/giu;
const BARE_URL_PATTERN =
  /(?<![\w@])(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s<>"']*)?/giu;
const INSTRUCTION_ECHO_PATTERN =
  /\b(?:ignore|disregard)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions\b/iu;

/** SHA-256 is computed over the exact provider comment text, without trim. */
export function hashCommentText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isSafePublicUrl(rawValue: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    /^127\./u.test(hostname) ||
    /^169\.254\./u.test(hostname) ||
    hostname === "0.0.0.0" ||
    /^10\./u.test(hostname) ||
    /^192\.168\./u.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname) ||
    /^\[?(?:fc|fd|fe80):/iu.test(hostname)
  ) {
    return false;
  }
  return hostname.length > 0;
}

function failsLinkCheck(text: string): boolean {
  const links = [
    ...(text.match(URL_PATTERN) ?? []),
    ...(text.match(BARE_URL_PATTERN) ?? []),
  ];
  return links.some((link) => {
    const normalized = link.replace(/[),.!?]+$/u, "");
    return !isSafePublicUrl(
      /^[a-z][a-z0-9+.-]*:/iu.test(normalized)
        ? normalized
        : `https://${normalized}`,
    );
  });
}

function failsPrivacyCheck(text: string): boolean {
  const textWithoutLinks = text
    .replace(URL_PATTERN, " ")
    .replace(BARE_URL_PATTERN, " ");
  return (
    EMAIL_PATTERN.test(textWithoutLinks) ||
    PHONE_PATTERN.test(textWithoutLinks) ||
    STREET_ADDRESS_PATTERN.test(textWithoutLinks)
  );
}

function failsSpamCheck(text: string): boolean {
  return REPEATED_PHRASE_PATTERN.test(text) || REPEATED_CHARACTER_PATTERN.test(text);
}

/**
 * Validates the exact text the Steward supplied. This function never trims,
 * normalizes, redacts, or substitutes text; a caller must handle rejection.
 */
export function validateFinalPublicReplyText(
  text: unknown,
): FinalTextValidation {
  const exactText = typeof text === "string" ? text : "";
  const failedChecks: FinalTextValidationFailure[] = [];

  if (typeof text !== "string" || text.trim().length === 0) {
    failedChecks.push("empty");
  } else if (text.length > MAX_PUBLIC_REPLY_TEXT_LENGTH) {
    failedChecks.push("too_long");
  }
  if (failsPrivacyCheck(exactText)) {
    failedChecks.push("privacy");
  }
  if (THREAT_PATTERNS.some((pattern) => pattern.test(exactText))) {
    failedChecks.push("threat");
  }
  if (IMPERSONATION_PATTERN.test(exactText)) {
    failedChecks.push("impersonation");
  }
  if (DIAGNOSIS_PATTERN.test(exactText)) {
    failedChecks.push("diagnosis");
  }
  if (failsSpamCheck(exactText)) {
    failedChecks.push("spam");
  }
  if (failsLinkCheck(exactText)) {
    failedChecks.push("link");
  }
  if (INSTRUCTION_ECHO_PATTERN.test(exactText)) {
    failedChecks.push("instruction_echo");
  }

  if (failedChecks.length > 0) {
    return {
      valid: false,
      text: exactText,
      reason: failedChecks[0],
      failedChecks,
    };
  }
  return { valid: true, text: exactText };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUsableIdentityShape(value: unknown): value is NestedCommentIdentity {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "missing" || value.status === "ambiguous") return true;
  return (
    value.status === "verified" &&
    isSafeLabel(value.providerAuthorId) &&
    isSafeLabel(value.displayName)
  );
}

function hasUsableIdentity(identity: unknown): identity is Extract<
  NestedCommentIdentity,
  { status: "verified" }
> {
  return (
    isRecord(identity) &&
    identity.status === "verified" &&
    isSafeLabel(identity.providerAuthorId) &&
    isSafeLabel(identity.displayName) &&
    identity.displayName === identity.displayName.trim() &&
    identity.displayName.length <= 100
  );
}

export type PublicReplyTargetResolution =
  | Readonly<{ action: "publish"; plan: PublicReplyTargetPlan }>
  | Readonly<{
      action: "open_in_youtube";
      reason: "nested_identity_unavailable";
      url: string;
    }>;

function openInYouTubeResult(
  resolution: Extract<PublicReplyTargetResolution, { action: "open_in_youtube" }>,
): Extract<PublicReplyPublicationResult, { outcome: "open_in_youtube" }> {
  return {
    outcome: "open_in_youtube",
    reason: resolution.reason,
    url: resolution.url,
  };
}

export function resolvePublicReplyTarget(input: Readonly<{
  source: PublicReplySourceContext;
  finalText: string;
}>): PublicReplyTargetResolution {
  if (input.source.target.kind === "top_level") {
    return {
      action: "publish",
      plan: {
        kind: "normal_thread_reply",
        parentCommentId: input.source.commentId,
        prefix: null,
        publishedText: input.finalText,
      },
    };
  }

  if (!hasUsableIdentity(input.source.target.identity)) {
    return {
      action: "open_in_youtube",
      reason: "nested_identity_unavailable",
      url: buildYouTubeCommentUrl(input.source.video.id, input.source.commentId),
    };
  }

  const prefix = `@${input.source.target.identity.displayName} `;
  return {
    action: "publish",
    plan: {
      kind: "sibling_thread_reply",
      parentCommentId: input.source.target.topLevelCommentId,
      prefix,
      publishedText: `${prefix}${input.finalText}`,
    },
  };
}

export function buildYouTubeCommentUrl(videoId: string, commentId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
}

export function buildPublicationConfirmation(input: Readonly<{
  source: PublicReplySourceContext;
  channel: ConnectedPublicationChannel;
  finalText: string;
}>): PublicationConfirmation | Extract<PublicReplyTargetResolution, { action: "open_in_youtube" }> {
  const target = resolvePublicReplyTarget({
    source: input.source,
    finalText: input.finalText,
  });
  if (target.action === "open_in_youtube") return target;
  return {
    currentComment: {
      id: input.source.commentId,
      text: input.source.commentText,
      hash: input.source.commentHash,
    },
    video: input.source.video,
    publishingIdentity: {
      provider: "synthetic",
      connectedChannelId: input.channel.connectedChannelId,
      channelId: input.channel.channelId,
      providerChannelId: input.channel.providerChannelId,
      displayName: input.channel.displayName,
    },
    finalText: input.finalText,
    publishedText: target.plan.publishedText,
    target: target.plan,
  };
}

function isActivePro(account: PublicationAccount): boolean {
  return (
    account.entitlement.verified === true &&
    ACTIVE_PRO_STATES.has(account.entitlement.state)
  );
}

function isUsableAccount(value: unknown): value is PublicationAccount {
  if (!isRecord(value) || !isSafeLabel(value.accountId) || !isRecord(value.entitlement)) {
    return false;
  }
  return (
    typeof value.entitlement.state === "string" &&
    typeof value.entitlement.verified === "boolean"
  );
}

function isUsableConnectedChannel(
  value: unknown,
): value is ConnectedPublicationChannel {
  return (
    isRecord(value) &&
    value.provider === "synthetic" &&
    isSafeLabel(value.accountId) &&
    isSafeLabel(value.channelId) &&
    isSafeLabel(value.connectedChannelId) &&
    isSafeLabel(value.grantId) &&
    isSafeLabel(value.providerChannelId) &&
    isSafeLabel(value.displayName) &&
    value.active === true
  );
}

function isUsablePublishingAuthorization(
  value: unknown,
): value is PublishingAuthorization {
  return (
    isRecord(value) &&
    validText(value.grantId) &&
    value.status === "active" &&
    value.verified === true &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === "string")
  );
}

function isUsableSourceContext(
  value: unknown,
): value is PublicReplySourceContext {
  if (
    !isRecord(value) ||
    !isSafeLabel(value.commentId) ||
    !validText(value.commentText) ||
    !isSafeLabel(value.commentHash) ||
    !isRecord(value.video) ||
    !isSafeLabel(value.video.id) ||
    !validText(value.video.title) ||
    !validText(value.video.uploadingChannel) ||
    !isRecord(value.target) ||
    typeof value.target.kind !== "string"
  ) {
    return false;
  }
  if (
    typeof value.commentText !== "string" ||
    value.commentHash !== hashCommentText(value.commentText)
  ) {
    return false;
  }
  if (value.target.kind === "top_level") return true;
  return (
    value.target.kind === "nested" &&
    isSafeLabel(value.target.topLevelCommentId) &&
    isUsableIdentityShape(value.target.identity)
  );
}

function sameSourceContext(
  left: PublicReplySourceContext,
  right: PublicReplySourceContext,
): boolean {
  if (
    left.commentId !== right.commentId ||
    left.commentText !== right.commentText ||
    left.commentHash !== right.commentHash ||
    left.video.id !== right.video.id ||
    left.video.title !== right.video.title ||
    left.video.uploadingChannel !== right.video.uploadingChannel ||
    left.target.kind !== right.target.kind
  ) {
    return false;
  }
  if (left.target.kind === "top_level" || right.target.kind === "top_level") {
    return left.target.kind === right.target.kind;
  }
  return (
    left.target.topLevelCommentId === right.target.topLevelCommentId &&
    left.target.identity.status === right.target.identity.status &&
    (left.target.identity.status !== "verified" ||
      (right.target.identity.status === "verified" &&
        left.target.identity.providerAuthorId === right.target.identity.providerAuthorId &&
        left.target.identity.displayName === right.target.identity.displayName))
  );
}

function dayFor(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeLabel(value: unknown): value is string {
  return (
    validText(value) &&
    value.length <= 240 &&
    !/[\r\n\u0000-\u001f\u007f]/u.test(value)
  );
}

function cloneSource(source: PublicReplySourceContext): PublicReplySourceContext {
  return {
    ...source,
    video: { ...source.video },
    target:
      source.target.kind === "top_level"
        ? { kind: "top_level" }
        : {
            ...source.target,
            identity: { ...source.target.identity },
          },
  };
}

function denied(
  reason: PublicationBlockReason,
  extras: Readonly<{
    confirmation?: PublicationConfirmation;
    validation?: FinalTextValidation;
  }> = {},
): Extract<PublicReplyPublicationResult, { outcome: "blocked" }> {
  return { outcome: "blocked", reason, ...extras };
}

function cloneDraft(draft: ChannelReplyDraft): ChannelReplyDraft {
  return {
    ...draft,
    source: cloneSource(draft.source),
  };
}

function parseProviderResult(raw: unknown): ProviderPublishedResult | ProviderRejectedResult | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    value.outcome === "published" &&
    validText(value.providerReplyId) &&
    typeof value.publishedAt === "string" &&
    Number.isFinite(Date.parse(value.publishedAt))
  ) {
    return {
      outcome: "published",
      providerReplyId: value.providerReplyId,
      publishedAt: value.publishedAt,
    };
  }
  if (value.outcome === "rejected") {
    return {
      outcome: "rejected",
      reason: validText(value.reason) ? value.reason : "provider_rejected",
    };
  }
  return null;
}

export async function publishPublicReply(input: Readonly<{
  store: ChannelPublicationStore;
  provider: ChannelPublicReplyProvider;
  accountId: string;
  draftId: string;
  finalText: string;
  now?: () => Date;
}>): Promise<PublicReplyPublicationResult> {
  if (
    !input.provider ||
    input.provider.kind !== "synthetic" ||
    typeof input.provider.publish !== "function"
  ) {
    return denied("non_synthetic_provider");
  }
  const now = input.now?.() ?? new Date();
  if (Number.isNaN(now.getTime())) return denied("clock_unavailable");

  let claim: PublicationClaimResult;
  try {
    claim = await input.store.claimPublication({
      accountId: input.accountId,
      draftId: input.draftId,
      finalText: input.finalText,
      now,
    });
  } catch {
    return denied("draft_unavailable");
  }
  if (claim.outcome !== "claimed") return claim;

  // A successful claim authorizes exactly this one provider call. The
  // uncertain path deliberately does not retry because the provider may have
  // accepted the write before the response was lost.
  try {
    const parsed = parseProviderResult(await input.provider.publish(claim.claim.write));
    if (!parsed) {
      await input.store.markPublicationUncertain({ claimId: claim.claim.claimId });
      return {
        outcome: "publication_uncertain",
        reason: "provider_result_unavailable",
        confirmation: claim.claim.confirmation,
      };
    }
    if (parsed.outcome === "rejected") {
      await input.store.recordProviderRejection({ claimId: claim.claim.claimId });
      return {
        outcome: "failed",
        reason: "provider_rejected",
        retryable: true,
        confirmation: claim.claim.confirmation,
      };
    }
    try {
      await input.store.completePublication({
        claimId: claim.claim.claimId,
        providerReplyId: parsed.providerReplyId,
        publishedAt: parsed.publishedAt,
      });
    } catch {
      await input.store.markPublicationUncertain({ claimId: claim.claim.claimId });
      return {
        outcome: "publication_uncertain",
        reason: "provider_result_unavailable",
        confirmation: claim.claim.confirmation,
      };
    }
    return {
      outcome: "published",
      providerReplyId: parsed.providerReplyId,
      publishedAt: parsed.publishedAt,
      publishedText: claim.claim.write.text,
      confirmation: claim.claim.confirmation,
    };
  } catch {
    try {
      await input.store.markPublicationUncertain({ claimId: claim.claim.claimId });
    } catch {
      // The original provider error is still ambiguous; fail closed either way.
    }
    return {
      outcome: "publication_uncertain",
      reason: "provider_result_unavailable",
      confirmation: claim.claim.confirmation,
    };
  }
}

export function createInMemoryChannelPublicationStore(
  input: CreateInMemoryChannelPublicationStoreInput,
): InMemoryChannelPublicationStore {
  let account = input.account;
  let activeConnectedChannel = input.activeConnectedChannel;
  let publishingAuthorization = input.publishingAuthorization;
  const drafts = new Map<string, ChannelReplyDraft>(
    input.drafts.map((draft) => [draft.id, cloneDraft(draft)]),
  );
  const currentSources = new Map<string, PublicReplySourceContext | null>(
    input.drafts.map((draft) => [draft.id, cloneSource(draft.source)]),
  );
  const attempts = new Map<string, number>();
  const claimsByDraft = new Map<string, PublicationClaim>();
  const claimStatuses = new Map<string, "publishing" | "published" | "failed" | "uncertain">();
  const publishedReplies: PublishedPublicReply[] = [];
  let nextAttempt = 1;

  const store: InMemoryChannelPublicationStore = {
    updateAccess(update) {
      if (update.account !== undefined) account = update.account;
      if (update.activeConnectedChannel !== undefined) {
        activeConnectedChannel = update.activeConnectedChannel;
      }
      if (update.publishingAuthorization !== undefined) {
        publishingAuthorization = update.publishingAuthorization;
      }
    },

    updateCurrentSource(draftId, source) {
      currentSources.set(draftId, source ? cloneSource(source) : null);
    },

    getDraft(draftId) {
      const draft = drafts.get(draftId);
      return draft ? cloneDraft(draft) : null;
    },

    getPublishedReplies() {
      return publishedReplies.map((reply) => ({ ...reply }));
    },

    getDailyAttemptCount(accountId, day) {
      return attempts.get(`${accountId}:${day}`) ?? 0;
    },

    async claimPublication({ accountId, draftId, finalText, now }) {
      const draft = drafts.get(draftId);
      if (!draft) return denied("draft_unavailable");
      if (!isUsableAccount(account) || accountId !== account.accountId || draft.accountId !== accountId) {
        return denied("account_identity_mismatch");
      }
      if (!isActivePro(account)) return denied("pro_entitlement_required");
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        return denied("clock_unavailable");
      }

      const channel = activeConnectedChannel;
      if (!isUsableConnectedChannel(channel) || channel.accountId !== accountId) {
        return denied("channel_identity_unavailable");
      }
      if (
        channel.channelId !== draft.channelId ||
        channel.connectedChannelId !== draft.connectedChannelId ||
        channel.grantId !== draft.grantId ||
        channel.providerChannelId !== draft.providerChannelId
      ) {
        return denied("channel_identity_mismatch");
      }

      const authorization = publishingAuthorization;
      if (
        !isUsablePublishingAuthorization(authorization) ||
        !authorization.scopes.includes(PUBLIC_REPLY_WRITE_SCOPE)
      ) {
        return denied("publishing_authorization_required");
      }
      if (authorization.grantId !== channel.grantId) {
        return denied("publishing_authorization_mismatch");
      }

      if (draft.status === "published") return denied("already_published");
      if (draft.status === "publication_uncertain") return denied("publication_uncertain");
      if (draft.status === "stale") return denied("stale_draft");
      if (draft.status === "publishing") return denied("item_claimed");
      if (draft.eligible !== true || draft.status !== "draft_ready" && draft.status !== "failed") {
        return denied("draft_not_publishable");
      }

      const currentSource = currentSources.get(draftId);
      if (!currentSource) return denied("current_comment_unavailable");
      if (!isUsableSourceContext(draft.source)) {
        return denied("draft_not_publishable");
      }
      if (!isUsableSourceContext(currentSource)) {
        drafts.set(draftId, { ...draft, status: "stale" });
        return denied("stale_draft");
      }
      if (
        currentSource.commentId !== draft.source.commentId ||
        currentSource.commentHash !== draft.source.commentHash
      ) {
        drafts.set(draftId, { ...draft, status: "stale" });
        return denied("current_comment_changed");
      }
      if (
        currentSource.target.kind === "nested" &&
        !hasUsableIdentity(currentSource.target.identity)
      ) {
        return openInYouTubeResult({
          action: "open_in_youtube",
          reason: "nested_identity_unavailable",
          url: buildYouTubeCommentUrl(
            currentSource.video.id,
            currentSource.commentId,
          ),
        });
      }
      if (!sameSourceContext(currentSource, draft.source)) {
        drafts.set(draftId, { ...draft, status: "stale" });
        return denied("stale_draft");
      }

      const target = resolvePublicReplyTarget({ source: currentSource, finalText });
      if (target.action === "open_in_youtube") {
        return openInYouTubeResult(target);
      }

      const validation = validateFinalPublicReplyText(finalText);
      if (!validation.valid) return denied("final_text_rejected", { validation });

      const renderedValidation = validateFinalPublicReplyText(target.plan.publishedText);
      if (!renderedValidation.valid) {
        return denied("final_text_rejected", { validation: renderedValidation });
      }

      const day = dayFor(now);
      const attemptKey = `${accountId}:${day}`;
      const attemptCount = attempts.get(attemptKey) ?? 0;
      if (attemptCount >= PUBLIC_REPLY_DAILY_LIMIT) {
        return denied("daily_allowance_exhausted");
      }
      if (claimsByDraft.has(draftId)) return denied("item_claimed");

      const claimId = `publication-claim:${draftId}:${nextAttempt++}`;
      const confirmation = buildPublicationConfirmation({
        source: currentSource,
        channel,
        finalText,
      });
      if ("action" in confirmation) {
        return openInYouTubeResult(confirmation);
      }
      const write: PublicReplyWrite = {
        claimId,
        draftId,
        accountId,
        channelId: channel.channelId,
        connectedChannelId: channel.connectedChannelId,
        providerChannelId: channel.providerChannelId,
        commentId: currentSource.commentId,
        parentCommentId: confirmation.target.parentCommentId,
        targetKind: confirmation.target.kind,
        text: confirmation.publishedText,
        attemptedAt: now.toISOString(),
      };
      const claim: PublicationClaim = { claimId, draftId, write, confirmation };
      claimsByDraft.set(draftId, claim);
      claimStatuses.set(claimId, "publishing");
      attempts.set(attemptKey, attemptCount + 1);
      drafts.set(draftId, { ...draft, status: "publishing" });
      return { outcome: "claimed", claim };
    },

    async completePublication({ claimId, providerReplyId, publishedAt }) {
      const claim = [...claimsByDraft.values()].find((candidate) => candidate.claimId === claimId);
      if (!claim || claimStatuses.get(claimId) !== "publishing") throw new Error("claim unavailable");
      if (!validText(providerReplyId) || !Number.isFinite(Date.parse(publishedAt))) {
        throw new Error("provider completion is invalid");
      }
      const draft = drafts.get(claim.draftId);
      if (!draft) throw new Error("draft unavailable");
      claimStatuses.set(claimId, "published");
      drafts.set(claim.draftId, { ...draft, status: "published" });
      publishedReplies.push({
        draftId: claim.draftId,
        providerReplyId,
        publishedAt,
        text: claim.write.text,
      });
    },

    async recordProviderRejection({ claimId }) {
      const claim = [...claimsByDraft.values()].find((candidate) => candidate.claimId === claimId);
      if (!claim || claimStatuses.get(claimId) !== "publishing") throw new Error("claim unavailable");
      claimStatuses.set(claimId, "failed");
      claimsByDraft.delete(claim.draftId);
      const draft = drafts.get(claim.draftId);
      if (draft) drafts.set(claim.draftId, { ...draft, status: "failed" });
    },

    async markPublicationUncertain({ claimId }) {
      const claim = [...claimsByDraft.values()].find((candidate) => candidate.claimId === claimId);
      if (!claim || claimStatuses.get(claimId) !== "publishing") throw new Error("claim unavailable");
      claimStatuses.set(claimId, "uncertain");
      const draft = drafts.get(claim.draftId);
      if (draft) drafts.set(claim.draftId, { ...draft, status: "publication_uncertain" });
    },
  };

  return store;
}

export type SyntheticPublicReplyProviderOptions = Readonly<{
  outcome?: "published" | "rejected" | "uncertain";
}>;

export function createSyntheticPublicReplyProvider(
  options: SyntheticPublicReplyProviderOptions = {},
): SyntheticPublicReplyProvider {
  const calls: PublicReplyWrite[] = [];
  const outcome = options.outcome ?? "published";
  return {
    kind: "synthetic",
    calls,
    async publish(input) {
      calls.push(input);
      if (outcome === "uncertain") throw new Error("simulated provider timeout");
      if (outcome === "rejected") {
        return { outcome: "rejected", reason: "simulated provider rejection" };
      }
      return {
        outcome: "published",
        providerReplyId: `synthetic-public-reply:${input.claimId}`,
        publishedAt: input.attemptedAt,
      };
    },
  };
}
