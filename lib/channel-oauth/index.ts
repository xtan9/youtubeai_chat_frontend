import { z } from "zod";

export const YOUTUBE_CHANNEL_OAUTH_SCOPES = {
  readIdentity: "https://www.googleapis.com/auth/youtube.readonly",
  writeReply: "https://www.googleapis.com/auth/youtube.force-ssl",
} as const;

export const YOUTUBE_CHANNEL_OAUTH_CALLBACK_PATH =
  "/api/channel/oauth/callback";
export const YOUTUBE_CHANNEL_OAUTH_START_PATH = "/api/channel/oauth/start";
export const YOUTUBE_CHANNEL_OAUTH_CALLBACK_URI =
  "https://youtubeai.chat/api/channel/oauth/callback";

export const YOUTUBE_CHANNEL_OAUTH_CONSENT_TEXT = {
  readIdentity:
    "Connect one public YouTube Channel to YouTube AI Chat so we can verify that you own it. This read-only permission is used only for Channel identity verification. It does not allow YouTubeAI to publish, edit, delete, moderate, or access held-for-review or likely-spam comments.",
  writeReply:
    "Allow YouTube AI Chat to publish or delete one reply only after you explicitly confirm that action. This permission is requested separately from Channel connection. YouTubeAI never publishes automatically or in bulk, and you can review and edit the exact reply before publication.",
} as const;

/**
 * The public portion of the Google OAuth configuration. Credentials are
 * intentionally absent: a client secret and a client ID belong to the
 * external provider configuration and must never be invented or committed.
 */
export const YOUTUBE_CHANNEL_OAUTH_CONTRACT = {
  provider: "google",
  applicationName: "YouTubeAI",
  productSurface: "Channel Hub",
  authorizedDomains: ["youtubeai.chat"],
  redirectUris: [YOUTUBE_CHANNEL_OAUTH_CALLBACK_URI],
  requestedScopes: {
    readIdentity: [YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity],
    writeReply: [YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply],
  },
  consentScreenText: YOUTUBE_CHANNEL_OAUTH_CONSENT_TEXT,
} as const;

const OAuthScopeSchema = z.enum([
  YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity,
  YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply,
]);
const NonEmptyTextSchema = z.string().trim().min(1).max(240);
const YouTubeOAuthAuthorizationSchema = z
  .object({
    provider: z.literal("youtube"),
    intent: z.enum(["read_identity", "write_reply"]),
    accountId: NonEmptyTextSchema,
    grantedScopes: z.array(OAuthScopeSchema).min(1).max(2),
    stateValidated: z.literal(true),
    explicitConsent: z.literal(true),
  })
  .strict();

export type YouTubeOAuthIntent = "read_identity" | "write_reply";
export type YouTubeOAuthScope =
  (typeof YOUTUBE_CHANNEL_OAUTH_SCOPES)[keyof typeof YOUTUBE_CHANNEL_OAUTH_SCOPES];

export type YouTubeOAuthAuthorization = Readonly<{
  provider: "youtube";
  intent: YouTubeOAuthIntent;
  accountId: string;
  grantedScopes: readonly YouTubeOAuthScope[];
  stateValidated: true;
  explicitConsent: true;
}>;

export type YouTubeOAuthCallbackBlockedReason =
  | "invalid_callback_payload"
  | "callback_state_unavailable"
  | "callback_state_mismatch"
  | "authenticated_account_required"
  | "explicit_consent_required"
  | "invalid_scope_response"
  | "unexpected_scope"
  | "required_scope_missing";

export type YouTubeOAuthCallbackResult =
  | Readonly<{
      kind: "accepted";
      authorization: YouTubeOAuthAuthorization;
    }>
  | Readonly<{
      kind: "blocked";
      reason: YouTubeOAuthCallbackBlockedReason;
    }>;

export type YouTubeOAuthCallbackInput = Readonly<{
  intent: YouTubeOAuthIntent;
  expectedState: unknown;
  returnedState: unknown;
  authenticatedAccountId: unknown;
  grantedScopes: unknown;
  explicitConsent: unknown;
}>;

const YouTubeOAuthCallbackInputSchema = z
  .object({
    intent: z.enum(["read_identity", "write_reply"]),
    expectedState: z.unknown(),
    returnedState: z.unknown(),
    authenticatedAccountId: z.unknown(),
    grantedScopes: z.unknown(),
    explicitConsent: z.unknown(),
  })
  .strict();

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedScopeSet(
  rawScopes: unknown,
):
  | Readonly<{ kind: "valid"; scopes: readonly string[] }>
  | Readonly<{ kind: "blocked"; reason: YouTubeOAuthCallbackBlockedReason }> {
  if (!Array.isArray(rawScopes) || rawScopes.length === 0) {
    return { kind: "blocked", reason: "invalid_scope_response" };
  }

  const scopes = rawScopes.map((scope) =>
    typeof scope === "string" ? scope.trim() : "",
  );
  if (scopes.some((scope) => !scope)) {
    return { kind: "blocked", reason: "invalid_scope_response" };
  }

  const supportedScopes = new Set<string>([
    YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity,
    YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply,
  ]);
  if (scopes.some((scope) => !supportedScopes.has(scope))) {
    return { kind: "blocked", reason: "unexpected_scope" };
  }
  if (new Set(scopes).size !== scopes.length) {
    return { kind: "blocked", reason: "invalid_scope_response" };
  }

  return {
    kind: "valid",
    scopes: [
      YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity,
      YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply,
    ].filter((scope) => scopes.includes(scope)),
  };
}

/**
 * Validate the provider callback facts before a provider adapter exchanges or
 * stores anything. This is deliberately transport-free: it does not accept a
 * code, token, or provider response and therefore cannot perform an OAuth
 * exchange by accident.
 */
export function validateYouTubeOAuthCallback(
  input: unknown,
): YouTubeOAuthCallbackResult {
  const parsedInput = YouTubeOAuthCallbackInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { kind: "blocked", reason: "invalid_callback_payload" };
  }

  const callback = parsedInput.data;
  if (!hasText(callback.expectedState)) {
    return { kind: "blocked", reason: "callback_state_unavailable" };
  }
  if (
    typeof callback.returnedState !== "string" ||
    callback.returnedState !== callback.expectedState
  ) {
    return { kind: "blocked", reason: "callback_state_mismatch" };
  }
  if (!hasText(callback.authenticatedAccountId)) {
    return { kind: "blocked", reason: "authenticated_account_required" };
  }
  if (callback.explicitConsent !== true) {
    return { kind: "blocked", reason: "explicit_consent_required" };
  }

  const scopeSet = normalizedScopeSet(callback.grantedScopes);
  if (scopeSet.kind === "blocked") return scopeSet;

  if (
    callback.intent === "read_identity" &&
    (scopeSet.scopes.length !== 1 ||
      scopeSet.scopes[0] !== YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity)
  ) {
    return {
      kind: "blocked",
      reason: scopeSet.scopes.includes(YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity)
        ? "unexpected_scope"
        : "required_scope_missing",
    };
  }

  if (
    callback.intent === "write_reply" &&
    !scopeSet.scopes.includes(YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply)
  ) {
    return { kind: "blocked", reason: "required_scope_missing" };
  }

  const authorization = {
    provider: "youtube" as const,
    intent: callback.intent,
    accountId: callback.authenticatedAccountId,
    grantedScopes: scopeSet.scopes,
    stateValidated: true as const,
    explicitConsent: true as const,
  };
  const parsed = YouTubeOAuthAuthorizationSchema.safeParse(authorization);

  if (!parsed.success) {
    return { kind: "blocked", reason: "invalid_scope_response" };
  }

  return {
    kind: "accepted",
    authorization: parsed.data as YouTubeOAuthAuthorization,
  };
}

export type YouTubeReadAuthorization = Readonly<{
  status: "completed";
  readScopeGranted: true;
  provider: "youtube";
  intent: "read_identity";
  accountId: string;
  grantedScopes: readonly [
    (typeof YOUTUBE_CHANNEL_OAUTH_SCOPES)["readIdentity"]
  ];
  stateValidated: true;
  explicitConsent: true;
}>;

const YouTubeReadAuthorizationSchema = z
  .object({
    status: z.literal("completed"),
    readScopeGranted: z.literal(true),
    provider: z.literal("youtube"),
    intent: z.literal("read_identity"),
    accountId: NonEmptyTextSchema,
    grantedScopes: z.tuple([
      z.literal(YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity),
    ]),
    stateValidated: z.literal(true),
    explicitConsent: z.literal(true),
  })
  .strict();

export function toYouTubeReadAuthorization(
  authorization: unknown,
): YouTubeReadAuthorization | null {
  const parsed = YouTubeOAuthAuthorizationSchema.safeParse(authorization);
  if (!parsed.success) return null;

  const normalized = parsed.data;
  if (
    normalized.intent !== "read_identity" ||
    normalized.grantedScopes.length !== 1 ||
    normalized.grantedScopes[0] !== YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity
  ) {
    return null;
  }

  return {
    status: "completed",
    readScopeGranted: true,
    provider: "youtube",
    intent: "read_identity",
    accountId: normalized.accountId,
    grantedScopes: [YOUTUBE_CHANNEL_OAUTH_SCOPES.readIdentity],
    stateValidated: true,
    explicitConsent: true,
  };
}

export function isValidYouTubeReadAuthorization(
  input: unknown,
  expectedAccountId: string,
): input is YouTubeReadAuthorization {
  const parsed = YouTubeReadAuthorizationSchema.safeParse(input);
  return (
    parsed.success &&
    hasText(expectedAccountId) &&
    parsed.data.accountId === expectedAccountId
  );
}

/**
 * Publication may use the read scope plus the later write scope because an
 * incremental provider response can be cumulative, but no other scope is
 * accepted and the write scope is mandatory.
 */
export function hasYouTubeWriteAuthorizationScopes(
  scopes: readonly unknown[],
): boolean {
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 2) {
    return false;
  }
  const scopeSet = normalizedScopeSet(scopes);
  return (
    scopeSet.kind === "valid" &&
    scopeSet.scopes.includes(YOUTUBE_CHANNEL_OAUTH_SCOPES.writeReply)
  );
}
