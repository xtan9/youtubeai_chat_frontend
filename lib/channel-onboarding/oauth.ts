import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  authorizeChannelAction,
  type ChannelAccessContext,
  type ChannelAccessDeniedReason,
  type ChannelPrincipal,
} from "./access";
import { YOUTUBE_READONLY_SCOPE_SET, YOUTUBE_READONLY_SCOPE } from "./scopes";
import {
  evaluateChannelOnboardingGates,
  type ChannelOnboardingGates,
} from "./gates";
import {
  beginChannelOnboarding,
  completeChannelOnboarding,
  type ChannelConnectionPersistence,
  type ChannelOnboardingIds,
  type ChannelOnboardingResult,
} from "./journey";
import { resolveSupportedCreatorChannel } from "./identity";
import {
  EncryptedOAuthTokenEnvelopeSchema,
  OAuthCredentialReferenceSchema,
  YouTubeOAuthTokenSetSchema,
  type OAuthCredentialStore,
  type OAuthTokenEncryptor,
} from "./credentials";

const StateTextSchema = z.string().trim().min(16).max(512);
const OwnerIdSchema = z.string().trim().min(1).max(240);
const InstantSchema = z.string().datetime({ offset: true });

export const ChannelOAuthStateSchema = z
  .object({
    state: StateTextSchema,
    provider: z.literal("youtube"),
    purpose: z.literal("connect_supported_creator_channel"),
    ownerId: OwnerIdSchema,
    scopes: z.tuple([z.literal(YOUTUBE_READONLY_SCOPE)]),
    issuedAt: InstantSchema,
    expiresAt: InstantSchema,
  })
  .strict();

export type ChannelOAuthState = z.infer<typeof ChannelOAuthStateSchema>;

export type ChannelOAuthStateIssue = Readonly<{
  state: string;
  provider: "youtube";
  purpose: "connect_supported_creator_channel";
  ownerId: string;
  scopes: typeof YOUTUBE_READONLY_SCOPE_SET;
  issuedAt: string;
  expiresAt: string;
}>;

export type ChannelOAuthStateStore = Readonly<{
  /** Issue an opaque, account-bound state record for one OAuth attempt. */
  issue(input: ChannelOAuthStateIssue): Promise<unknown>;
  /** Atomically consume the state; a second callback must return null. */
  consume(state: string): Promise<unknown | null>;
}>;

export type YouTubeChannelOAuthProvider = Readonly<{
  exchangeAuthorizationCode(input: Readonly<{
    code: string;
    expectedScopes: typeof YOUTUBE_READONLY_SCOPE_SET;
  }>): Promise<unknown>;
  listOwnedChannelIdentities(input: Readonly<{
    accessToken: string;
    mine: true;
  }>): Promise<unknown>;
}>;

export type ChannelOAuthCallbackResult =
  | Extract<ChannelOnboardingResult, { kind: "connected" }>
  | Readonly<{
      kind: "interrupted";
      reason: "oauth_authorization_denied" | "oauth_callback_incomplete";
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | Extract<ChannelOnboardingResult, { kind: "blocked" }>["reason"]
        | "invalid_state"
        | "state_mismatch"
        | "state_account_mismatch"
        | "state_expired"
        | "invalid_clock"
        | "oauth_state_unavailable"
        | "invalid_oauth_callback"
        | "oauth_exchange_failed"
        | "invalid_oauth_response"
        | "token_encryption_failed"
        | "credential_store_failed"
        | "credential_cleanup_failed";
      guidance?: string;
    }>;

export type ChannelOAuthAuthorizationRequest = Readonly<{
  provider: "youtube";
  scopes: typeof YOUTUBE_READONLY_SCOPE_SET;
  state: string;
}>;

export type ChannelOAuthStartResult =
  | Readonly<{
      kind: "ready";
      request: ChannelOAuthAuthorizationRequest;
      expiresAt: string;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | ChannelAccessDeniedReason
        | "compliance_clearance_required"
        | "oauth_verification_required"
        | "invalid_clock"
        | "oauth_state_unavailable";
    }>;

export const CHANNEL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type ChannelOAuthStateValidationResult =
  | Readonly<{ kind: "valid"; state: ChannelOAuthState }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "invalid_state"
        | "state_mismatch"
        | "state_account_mismatch"
        | "state_expired";
    }>;

function isAuthenticatedPrincipal(
  principal: ChannelPrincipal | null | undefined,
): principal is ChannelPrincipal {
  return Boolean(
    principal &&
      principal.isAnonymous === false &&
      typeof principal.userId === "string" &&
      principal.userId.trim().length > 0,
  );
}

function stateMatches(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function validateChannelOAuthCallbackState(input: Readonly<{
  storedState: unknown;
  callbackState: unknown;
  principal: ChannelPrincipal | null | undefined;
  now?: Date;
}>): ChannelOAuthStateValidationResult {
  const parsedState = ChannelOAuthStateSchema.safeParse(input.storedState);
  if (!parsedState.success || typeof input.callbackState !== "string") {
    return { kind: "blocked", reason: "invalid_state" };
  }
  if (!stateMatches(parsedState.data.state, input.callbackState)) {
    return { kind: "blocked", reason: "state_mismatch" };
  }
  if (!isAuthenticatedPrincipal(input.principal)) {
    return { kind: "blocked", reason: "state_account_mismatch" };
  }
  if (parsedState.data.ownerId !== input.principal.userId) {
    return { kind: "blocked", reason: "state_account_mismatch" };
  }

  const now = input.now ?? new Date();
  const issuedAt = Date.parse(parsedState.data.issuedAt);
  const expiresAt = Date.parse(parsedState.data.expiresAt);
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > expiresAt ||
    issuedAt > now.getTime()
  ) {
    return { kind: "blocked", reason: "invalid_state" };
  }
  if (now.getTime() >= expiresAt) {
    return { kind: "blocked", reason: "state_expired" };
  }

  return { kind: "valid", state: parsedState.data };
}

function onboardingGatesAreOpen(
  gates: ChannelOnboardingGates | null | undefined,
): ChannelOAuthStartResult | null {
  const result = evaluateChannelOnboardingGates(gates);
  return result.status === "open"
    ? null
    : { kind: "blocked", reason: result.reason };
}

export async function beginSupportedCreatorChannelOAuth(input: Readonly<{
  access: ChannelAccessContext;
  gates: ChannelOnboardingGates | null | undefined;
  stateStore: ChannelOAuthStateStore;
  now?: () => Date;
  randomState?: () => string;
}>): Promise<ChannelOAuthStartResult> {
  const access = authorizeChannelAction("connection", input.access);
  if (!access.allowed) return { kind: "blocked", reason: access.reason };

  const gateFailure = onboardingGatesAreOpen(input.gates);
  if (gateFailure) return gateFailure;

  const principal = input.access.principal;
  if (!principal) {
    return { kind: "blocked", reason: "authenticated_identity_required" };
  }

  let now: Date;
  try {
    now = input.now?.() ?? new Date();
  } catch {
    return { kind: "blocked", reason: "invalid_clock" };
  }
  if (!Number.isFinite(now.getTime())) {
    return { kind: "blocked", reason: "invalid_clock" };
  }
  const issuedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + CHANNEL_OAUTH_STATE_TTL_MS,
  ).toISOString();

  let state: string;
  try {
    state = input.randomState?.() ?? randomBytes(32).toString("base64url");
  } catch {
    return { kind: "blocked", reason: "oauth_state_unavailable" };
  }
  if (!StateTextSchema.safeParse(state).success) {
    return { kind: "blocked", reason: "oauth_state_unavailable" };
  }

  let rawState: unknown;
  try {
    rawState = await input.stateStore.issue({
      state,
      provider: "youtube",
      purpose: "connect_supported_creator_channel",
      ownerId: principal.userId,
      scopes: YOUTUBE_READONLY_SCOPE_SET,
      issuedAt,
      expiresAt,
    });
  } catch {
    return { kind: "blocked", reason: "oauth_state_unavailable" };
  }

  const parsedState = ChannelOAuthStateSchema.safeParse(rawState);
  if (
    !parsedState.success ||
    parsedState.data.state !== state ||
    parsedState.data.ownerId !== principal.userId ||
    parsedState.data.issuedAt !== issuedAt ||
    parsedState.data.expiresAt !== expiresAt
  ) {
    return { kind: "blocked", reason: "oauth_state_unavailable" };
  }

  return {
    kind: "ready",
    request: {
      provider: "youtube",
      scopes: YOUTUBE_READONLY_SCOPE_SET,
      state: parsedState.data.state,
    },
    expiresAt: parsedState.data.expiresAt,
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function callbackBlocked(
  reason: Extract<ChannelOAuthCallbackResult, { kind: "blocked" }>["reason"],
  guidance?: string,
): ChannelOAuthCallbackResult {
  return guidance
    ? { kind: "blocked", reason, guidance }
    : { kind: "blocked", reason };
}

function stateFailure(
  reason: Extract<
    ChannelOAuthStateValidationResult,
    { kind: "blocked" }
  >["reason"],
): ChannelOAuthCallbackResult {
  return callbackBlocked(reason);
}

/**
 * Complete the read-only callback through injected provider and credential
 * boundaries. No provider client, OAuth secret, or persistence client is
 * constructed here; a future route must supply all of them explicitly.
 */
export async function completeSupportedCreatorChannelOAuth(input: Readonly<{
  access: ChannelAccessContext;
  gates: ChannelOnboardingGates | null | undefined;
  callback: Readonly<{
    state: unknown;
    code?: unknown;
    error?: unknown;
  }>;
  stateStore: ChannelOAuthStateStore;
  provider: YouTubeChannelOAuthProvider;
  tokenEncryptor: OAuthTokenEncryptor;
  credentialStore: OAuthCredentialStore;
  ids: Omit<ChannelOnboardingIds, "credentialReferenceId">;
  persistence: ChannelConnectionPersistence;
  now?: () => Date;
}>): Promise<ChannelOAuthCallbackResult> {
  const onboarding = beginChannelOnboarding(input.access, input.gates);
  if (onboarding.kind === "blocked") {
    return { kind: "blocked", reason: onboarding.reason };
  }

  if (!nonEmptyString(input.callback.state)) {
    return callbackBlocked("invalid_state");
  }

  let storedState: unknown;
  try {
    storedState = await input.stateStore.consume(input.callback.state);
  } catch {
    return callbackBlocked("oauth_state_unavailable");
  }
  if (storedState === null || storedState === undefined) {
    return callbackBlocked("invalid_state");
  }

  let callbackNow: Date;
  try {
    callbackNow = input.now?.() ?? new Date();
  } catch {
    return callbackBlocked("invalid_clock");
  }
  if (!Number.isFinite(callbackNow.getTime())) {
    return callbackBlocked("invalid_clock");
  }

  const state = validateChannelOAuthCallbackState({
    storedState,
    callbackState: input.callback.state,
    principal: input.access.principal,
    now: callbackNow,
  });
  if (state.kind === "blocked") return stateFailure(state.reason);

  const principal = input.access.principal;
  if (!principal) {
    return callbackBlocked("state_account_mismatch");
  }

  if (nonEmptyString(input.callback.error)) {
    return {
      kind: "interrupted",
      reason: "oauth_authorization_denied",
    };
  }
  if (!nonEmptyString(input.callback.code)) {
    return callbackBlocked("invalid_oauth_callback");
  }
  if (
    typeof input.provider?.exchangeAuthorizationCode !== "function" ||
    typeof input.provider?.listOwnedChannelIdentities !== "function"
  ) {
    return callbackBlocked("oauth_exchange_failed");
  }
  if (typeof input.tokenEncryptor?.encrypt !== "function") {
    return callbackBlocked("token_encryption_failed");
  }
  if (
    typeof input.credentialStore?.storeEncrypted !== "function" ||
    typeof input.credentialStore?.remove !== "function"
  ) {
    return callbackBlocked("credential_store_failed");
  }
  if (typeof input.persistence?.commitConnectionAtomically !== "function") {
    return callbackBlocked("persistence_write_failed");
  }

  let rawTokenSet: unknown;
  try {
    rawTokenSet = await input.provider.exchangeAuthorizationCode({
      code: input.callback.code,
      expectedScopes: YOUTUBE_READONLY_SCOPE_SET,
    });
  } catch {
    return callbackBlocked("oauth_exchange_failed");
  }
  const tokenSet = YouTubeOAuthTokenSetSchema.safeParse(rawTokenSet);
  if (!tokenSet.success) {
    return callbackBlocked("invalid_oauth_response");
  }
  if (
    tokenSet.data.scopes.length !== 1 ||
    tokenSet.data.scopes[0] !== YOUTUBE_READONLY_SCOPE
  ) {
    return callbackBlocked("read_scope_mismatch");
  }

  let providerIdentityResults: unknown;
  try {
    providerIdentityResults =
      await input.provider.listOwnedChannelIdentities({
        accessToken: tokenSet.data.accessToken,
        mine: true,
      });
  } catch {
    return callbackBlocked("oauth_exchange_failed");
  }

  const identity = resolveSupportedCreatorChannel(providerIdentityResults);
  if (identity.kind === "rejected") {
    return callbackBlocked(identity.reason, identity.guidance);
  }

  let rawEnvelope: unknown;
  try {
    rawEnvelope = await input.tokenEncryptor.encrypt(tokenSet.data);
  } catch {
    return callbackBlocked("token_encryption_failed");
  }
  const envelope = EncryptedOAuthTokenEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelope.success) {
    return callbackBlocked("token_encryption_failed");
  }

  let rawCredentialReference: unknown;
  try {
    rawCredentialReference = await input.credentialStore.storeEncrypted({
      ownerId: principal.userId,
      grantId: input.ids.grantId,
      envelope: envelope.data,
    });
  } catch {
    return callbackBlocked("credential_store_failed");
  }
  const credentialReference = OAuthCredentialReferenceSchema.safeParse(
    rawCredentialReference,
  );
  if (
    !credentialReference.success ||
    credentialReference.data.ownerId !== principal.userId ||
    credentialReference.data.grantId !== input.ids.grantId ||
    credentialReference.data.keyVersion !== envelope.data.keyVersion
  ) {
    return callbackBlocked("credential_store_failed");
  }

  let completion: ChannelOnboardingResult;
  try {
    completion = await completeChannelOnboarding({
      access: input.access,
      gates: input.gates,
      providerIdentityResults,
      readAuthorization: {
        status: "completed",
        readScopeGranted: true,
        scopes: [YOUTUBE_READONLY_SCOPE],
      },
      ids: {
        ...input.ids,
        credentialReferenceId: credentialReference.data.id,
      },
      persistence: input.persistence,
      now: input.now,
    });
  } catch {
    try {
      await input.credentialStore.remove(credentialReference.data);
    } catch {
      return callbackBlocked("credential_cleanup_failed");
    }
    return {
      kind: "interrupted",
      reason: "oauth_callback_incomplete",
    };
  }
  if (completion.kind === "connected") return completion;

  try {
    await input.credentialStore.remove(credentialReference.data);
  } catch {
    return callbackBlocked("credential_cleanup_failed");
  }
  if (completion.kind === "interrupted") {
    return {
      kind: "interrupted",
      reason: "oauth_callback_incomplete",
    };
  }
  return completion;
}
