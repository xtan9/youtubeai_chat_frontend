import { z } from "zod";

import {
  evaluateYouTubeChannelAssessmentGate,
} from "@/lib/compliance/youtube-channel-clearance";
import { PUBLIC_REPLY_DAILY_LIMIT } from "./publication";
import type {
  PublicReplyLifecycleProvider,
  PublicReplyProviderRequest,
} from "./publication";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "./scopes";
import { evaluateYouTubeOAuthVerificationGate } from "./oauth-verification";

export { PUBLIC_REPLY_DAILY_LIMIT } from "./publication";
export { YOUTUBE_FORCE_SSL_SCOPE, YOUTUBE_READONLY_SCOPE } from "./scopes";
export const YOUTUBE_COMMENTS_INSERT_QUOTA_COST = 50 as const;

export type YouTubeAuthorizationPlan =
  | Readonly<{
      kind: "authorization_required";
      action: "connect" | "first_publication";
      scopes: readonly [string];
    }>
  | Readonly<{
      kind: "already_authorized";
      action: "first_publication";
      scopes: readonly [];
    }>
  | Readonly<{
      kind: "blocked";
      reason: "explicit_user_action_required";
    }>;

/**
 * Plan incremental consent only. This module does not start an OAuth flow,
 * hold a token, or verify a provider callback.
 */
export function planYouTubeAuthorization(input: Readonly<{
  action: "connect" | "first_publication";
  userInitiated: boolean;
  existingScopes?: readonly string[];
}>): YouTubeAuthorizationPlan {
  if (input.userInitiated !== true) {
    return { kind: "blocked", reason: "explicit_user_action_required" };
  }

  if (input.action === "connect") {
    return {
      kind: "authorization_required",
      action: "connect",
      scopes: [YOUTUBE_READONLY_SCOPE],
    };
  }

  if (
    input.existingScopes?.includes(YOUTUBE_READONLY_SCOPE) &&
    input.existingScopes.includes(YOUTUBE_FORCE_SSL_SCOPE)
  ) {
    return {
      kind: "already_authorized",
      action: "first_publication",
      scopes: [],
    };
  }

  return {
    kind: "authorization_required",
    action: "first_publication",
    scopes: [YOUTUBE_FORCE_SSL_SCOPE],
  };
}

export type YouTubeExternalActionGateReason =
  | "written_compliance_clearance_required"
  | "oauth_verification_required"
  | "live_privacy_disclosure_required"
  | "credentials_unavailable"
  | "creator_consent_required"
  | "quota_evidence_required"
  | "transport_unavailable";

type YouTubeExternalActionEvidence = Readonly<{
  privacyDisclosure: Readonly<{
    status: "verified";
    disclosureRef: string;
    verifiedAt: string;
  }>;
  credentials: Readonly<{
    status: "available";
    credentialReferenceId: string;
  }>;
  creatorConsent: Readonly<{
    status: "confirmed";
    consentRef: string;
    confirmedAt: string;
  }>;
  quotaEvidence: Readonly<{
    status: "verified";
    evidenceRef: string;
    verifiedAt: string;
    dailyPublicationLimit: typeof PUBLIC_REPLY_DAILY_LIMIT;
    insertQuotaCost: typeof YOUTUBE_COMMENTS_INSERT_QUOTA_COST;
  }>;
  transport: Readonly<{
    status: "available";
    adapterRef: string;
  }>;
}>;

export type YouTubeExternalActionGateInput = Readonly<{
  compliance: unknown;
  oauthVerification: unknown;
}> & YouTubeExternalActionEvidence;

export type YouTubeExternalActionGate =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reasons: readonly YouTubeExternalActionGateReason[];
    }>;

const EvidenceReferenceSchema = z.string().trim().min(1).max(240);
const EvidenceInstantSchema = z.string().datetime({ offset: true });
const GateInputSchema = z
  .object({
    compliance: z.unknown(),
    oauthVerification: z.unknown(),
    privacyDisclosure: z
      .object({
        status: z.literal("verified"),
        disclosureRef: EvidenceReferenceSchema,
        verifiedAt: EvidenceInstantSchema,
      })
      .strict(),
    credentials: z
      .object({
        status: z.literal("available"),
        credentialReferenceId: EvidenceReferenceSchema,
      })
      .strict(),
    creatorConsent: z
      .object({
        status: z.literal("confirmed"),
        consentRef: EvidenceReferenceSchema,
        confirmedAt: EvidenceInstantSchema,
      })
      .strict(),
    quotaEvidence: z
      .object({
        status: z.literal("verified"),
        evidenceRef: EvidenceReferenceSchema,
        verifiedAt: EvidenceInstantSchema,
        dailyPublicationLimit: z.literal(PUBLIC_REPLY_DAILY_LIMIT),
        insertQuotaCost: z.literal(YOUTUBE_COMMENTS_INSERT_QUOTA_COST),
      })
      .strict(),
    transport: z
      .object({
        status: z.literal("available"),
        adapterRef: EvidenceReferenceSchema,
      })
      .strict(),
  })
  .strict();

/**
 * A positive result can only be supplied by a separately governed launch
 * integration. There is intentionally no default or environment fallback.
 */
export function evaluateYouTubeExternalActionGate(
  input: unknown,
): YouTubeExternalActionGate {
  const reasons: YouTubeExternalActionGateReason[] = [];
  const candidate =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : null;

  const compliance = evaluateYouTubeChannelAssessmentGate(
    candidate?.compliance,
  );
  if (compliance.status !== "open") {
    reasons.push("written_compliance_clearance_required");
  }
  const oauth = evaluateYouTubeOAuthVerificationGate(
    candidate?.oauthVerification,
    [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
  );
  if (oauth.status !== "open") {
    reasons.push("oauth_verification_required");
  }
  if (
    !GateInputSchema.shape.privacyDisclosure.safeParse(
      candidate?.privacyDisclosure,
    ).success
  ) {
    reasons.push("live_privacy_disclosure_required");
  }
  if (
    !GateInputSchema.shape.credentials.safeParse(candidate?.credentials)
      .success
  ) {
    reasons.push("credentials_unavailable");
  }
  if (
    !GateInputSchema.shape.creatorConsent.safeParse(candidate?.creatorConsent)
      .success
  ) {
    reasons.push("creator_consent_required");
  }
  if (
    !GateInputSchema.shape.quotaEvidence.safeParse(candidate?.quotaEvidence)
      .success
  ) {
    reasons.push("quota_evidence_required");
  }
  if (
    !GateInputSchema.shape.transport.safeParse(candidate?.transport).success
  ) {
    reasons.push("transport_unavailable");
  }

  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}

/**
 * The real adapter is an injected transport slot. It has no default client,
 * credential lookup, network primitive, or production registration here.
 */
export interface YouTubePublicReplyTransport {
  insertPublicReply(request: PublicReplyProviderRequest): Promise<unknown>;
  observePublicReply(request: PublicReplyProviderRequest): Promise<unknown>;
  deletePublicReply(request: PublicReplyProviderRequest): Promise<unknown>;
}

export type YouTubePublicReplyProvider = PublicReplyLifecycleProvider &
  Readonly<{
    kind: "youtube";
    isAvailable(
      operation: "publish" | "reconcile" | "open" | "delete",
    ): boolean;
  }>;

export function createYouTubePublicReplyProvider(input: Readonly<{
  transport: YouTubePublicReplyTransport;
  resolveGate: () => unknown;
}>): YouTubePublicReplyProvider {
  const isAvailable = (
    operation: "publish" | "reconcile" | "open" | "delete",
  ): boolean => {
    try {
      const transportMethod =
        operation === "publish"
          ? input.transport.insertPublicReply
          : operation === "delete"
            ? input.transport.deletePublicReply
            : input.transport.observePublicReply;
      return (
        typeof transportMethod === "function" &&
        evaluateYouTubeExternalActionGate(input.resolveGate()).allowed
      );
    } catch {
      return false;
    }
  };

  return {
    kind: "youtube",
    isAvailable,
    async insert(request) {
      if (!isAvailable("publish")) {
        return {
          kind: "ambiguous",
          reason: "external integration gate is closed",
        };
      }
      return input.transport.insertPublicReply(request);
    },
    async recheck(request) {
      if (!isAvailable("reconcile")) {
        return {
          kind: "continued_uncertainty",
          reason: "external integration gate is closed",
        };
      }
      return input.transport.observePublicReply(request);
    },
    async read(request) {
      if (!isAvailable("open")) {
        return {
          kind: "continued_uncertainty",
          reason: "external integration gate is closed",
        };
      }
      return input.transport.observePublicReply(request);
    },
    async delete(request) {
      if (!isAvailable("delete")) {
        return {
          kind: "ambiguous",
          reason: "external integration gate is closed",
        };
      }
      return input.transport.deletePublicReply(request);
    },
  };
}
