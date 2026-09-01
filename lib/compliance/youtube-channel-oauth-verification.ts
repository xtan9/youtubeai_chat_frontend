import { z } from "zod";

import verificationRecord from "../../docs/compliance/youtube-channel-oauth-verification.json";
import {
  YOUTUBE_CHANNEL_OAUTH_CALLBACK_URI,
  YOUTUBE_CHANNEL_OAUTH_CONSENT_TEXT,
  YOUTUBE_CHANNEL_OAUTH_SCOPES,
  YOUTUBE_CHANNEL_OAUTH_CONTRACT,
} from "../channel-oauth";

const NonEmptyStringSchema = z.string().trim().min(1).max(2_000);
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected an ISO calendar date (YYYY-MM-DD)");

const OAuthContractSchema = z
  .object({
    provider: z.literal("google"),
    applicationName: z.literal("YouTubeAI"),
    productSurface: z.literal("Channel Hub"),
    authorizedDomains: z.tuple([z.literal("youtubeai.chat")]),
    redirectUris: z.tuple([z.literal(YOUTUBE_CHANNEL_OAUTH_CALLBACK_URI)]),
    requestedScopes: z
      .object({
        readIdentity: z.tuple([
          z.literal(YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity),
        ]),
        writeReply: z.tuple([
          z.literal(YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply),
        ]),
      })
      .strict(),
    consentScreenText: z
      .object({
        readIdentity: z.literal(YOUTUBE_CHANNEL_OAUTH_CONSENT_TEXT.readIdentity),
        writeReply: z.literal(YOUTUBE_CHANNEL_OAUTH_CONSENT_TEXT.writeReply),
      })
      .strict(),
  })
  .strict();

const VerificationEvidenceSchema = z
  .object({
    sourceReference: NonEmptyStringSchema,
    verifiedAt: IsoDateSchema,
    verifiedBy: NonEmptyStringSchema,
  })
  .strict();

const BaseVerificationSchema = z.object({
  recordType: z.literal("youtube-channel-oauth-verification"),
  recordVersion: z.literal(1),
  issueNumber: z.literal(490),
  contract: OAuthContractSchema,
});

const PendingVerificationSchema = BaseVerificationSchema.extend({
  status: z.literal("pending_external_verification"),
  verificationEvidence: z.null(),
}).strict();

const VerifiedVerificationSchema = BaseVerificationSchema.extend({
  status: z.literal("verified"),
  verificationEvidence: VerificationEvidenceSchema,
}).strict();

const RejectedVerificationSchema = BaseVerificationSchema.extend({
  status: z.literal("rejected"),
  verificationEvidence: VerificationEvidenceSchema,
  rejectionReason: NonEmptyStringSchema,
}).strict();

export const YouTubeChannelOAuthVerificationSchema = z.discriminatedUnion(
  "status",
  [
    PendingVerificationSchema,
    VerifiedVerificationSchema,
    RejectedVerificationSchema,
  ],
);

export type YouTubeChannelOAuthVerification = z.infer<
  typeof YouTubeChannelOAuthVerificationSchema
>;

export type YouTubeChannelOAuthVerificationGate =
  | Readonly<{
      status: "open";
      evidenceRef: string;
      reason: string;
    }>
  | Readonly<{
      status: "blocked";
      verificationStatus?: YouTubeChannelOAuthVerification["status"];
      reason: string;
    }>;

function contractMatchesImplementation(
  contract: YouTubeChannelOAuthVerification["contract"],
): boolean {
  return JSON.stringify(contract) === JSON.stringify(YOUTUBE_CHANNEL_OAUTH_CONTRACT);
}

/**
 * Evaluate the repository-side evidence slot. A syntactically valid record is
 * not enough: only a human-supplied verified record with the exact checked-in
 * contract can open the future OAuth adapter.
 */
export function evaluateYouTubeChannelOAuthVerificationGate(
  input: unknown,
): YouTubeChannelOAuthVerificationGate {
  const parsed = YouTubeChannelOAuthVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "blocked",
      reason: "The Google OAuth verification record is invalid or incomplete.",
    };
  }

  const verification = parsed.data;
  if (!contractMatchesImplementation(verification.contract)) {
    return {
      status: "blocked",
      verificationStatus: verification.status,
      reason:
        "The Google OAuth verification record does not match the implemented app identity, consent, domain, redirect, or scope contract.",
    };
  }

  if (verification.status === "pending_external_verification") {
    return {
      status: "blocked",
      verificationStatus: verification.status,
      reason:
        "Google OAuth verification is pending; the Supported Creator Channel OAuth flow remains disabled.",
    };
  }

  if (verification.status === "rejected") {
    return {
      status: "blocked",
      verificationStatus: verification.status,
      reason:
        "Google OAuth verification was rejected; the Supported Creator Channel OAuth flow remains disabled.",
    };
  }

  return {
    status: "open",
    evidenceRef: verification.verificationEvidence.sourceReference,
    reason:
      "Google OAuth verification evidence covers the exact Supported Creator Channel contract.",
  };
}

export const CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION: YouTubeChannelOAuthVerification =
  YouTubeChannelOAuthVerificationSchema.parse(verificationRecord);

export function parseYouTubeChannelOAuthVerification(
  input: unknown,
): YouTubeChannelOAuthVerification {
  const parsed = YouTubeChannelOAuthVerificationSchema.safeParse(input);
  if (!parsed.success) throw new Error("YouTubeChannelOAuthVerificationInvalid");
  return parsed.data;
}
