import { z } from "zod";

import pendingVerification from "../../docs/compliance/youtube-channel-oauth-verification.json";
import {
  YOUTUBE_READONLY_SCOPE_SET,
  YouTubeOAuthScopeSchema,
} from "./scopes";

const TextSchema = z.string().trim().min(1).max(240);
const InstantSchema = z.string().datetime({ offset: true });
const RequiredScopesSchema = z
  .array(YouTubeOAuthScopeSchema)
  .min(1)
  .max(2)
  .superRefine((scopes, context) => {
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({
        code: "custom",
        message: "OAuth scopes must not be duplicated.",
      });
    }
  });

const BaseVerificationSchema = z.object({
  recordType: z.literal("youtube-channel-oauth-verification"),
  recordVersion: z.literal(1),
  provider: z.literal("youtube"),
});

const PendingVerificationSchema = BaseVerificationSchema.extend({
  status: z.literal("pending_external_verification"),
  reason: TextSchema,
}).strict();

const VerifiedVerificationSchema = BaseVerificationSchema.extend({
  status: z.literal("verified"),
  verificationReference: TextSchema,
  verifiedAt: InstantSchema,
  verifiedBy: TextSchema,
  approvedScopes: z
    .array(YouTubeOAuthScopeSchema)
    .min(1)
    .max(2)
    .superRefine((scopes, context) => {
      if (new Set(scopes).size !== scopes.length) {
        context.addIssue({
          code: "custom",
          message: "OAuth scopes must not be duplicated.",
        });
      }
    }),
}).strict();

const RejectedVerificationSchema = BaseVerificationSchema.extend({
  status: z.literal("rejected"),
  reason: TextSchema,
}).strict();

export const YouTubeOAuthVerificationSchema = z.discriminatedUnion(
  "status",
  [
    PendingVerificationSchema,
    VerifiedVerificationSchema,
    RejectedVerificationSchema,
  ],
);

export type YouTubeOAuthVerification = z.infer<
  typeof YouTubeOAuthVerificationSchema
>;

export type YouTubeOAuthVerificationGate =
  | Readonly<{
      status: "open";
      approvedScopes: readonly string[];
      reason: string;
    }>
  | Readonly<{
      status: "blocked";
      reason:
        | "invalid_record"
        | "pending_external_verification"
        | "rejected"
        | "required_scope_not_verified";
      message: string;
    }>;

export const CURRENT_YOUTUBE_OAUTH_VERIFICATION: YouTubeOAuthVerification =
  YouTubeOAuthVerificationSchema.parse(pendingVerification);

function hasRequiredScopes(
  approvedScopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  return requiredScopes.every((scope) => approvedScopes.includes(scope));
}

export function evaluateYouTubeOAuthVerificationGate(
  input: unknown,
  requiredScopes: readonly string[] = YOUTUBE_READONLY_SCOPE_SET,
): YouTubeOAuthVerificationGate {
  const parsedRequiredScopes = RequiredScopesSchema.safeParse(requiredScopes);
  if (!parsedRequiredScopes.success) {
    return {
      status: "blocked",
      reason: "required_scope_not_verified",
      message: "The requested YouTube OAuth scope is invalid or incomplete.",
    };
  }

  const parsed = YouTubeOAuthVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "blocked",
      reason: "invalid_record",
      message: "OAuth verification evidence is invalid or incomplete.",
    };
  }

  if (parsed.data.status === "pending_external_verification") {
    return {
      status: "blocked",
      reason: "pending_external_verification",
      message:
        "External OAuth verification is pending; YouTube authorization cannot begin.",
    };
  }

  if (parsed.data.status === "rejected") {
    return {
      status: "blocked",
      reason: "rejected",
      message:
        "External OAuth verification rejected this authorization; YouTube authorization cannot begin.",
    };
  }

  if (
    !hasRequiredScopes(
      parsed.data.approvedScopes,
      parsedRequiredScopes.data,
    )
  ) {
    return {
      status: "blocked",
      reason: "required_scope_not_verified",
      message:
        "The requested YouTube OAuth scope is not covered by verified OAuth evidence.",
    };
  }

  return {
    status: "open",
    approvedScopes: parsed.data.approvedScopes,
    reason: "Required YouTube OAuth scopes are externally verified.",
  };
}
