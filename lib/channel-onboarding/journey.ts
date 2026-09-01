import {
  authorizeChannelAction,
  type ChannelAccessContext,
  type ChannelAccessDeniedReason,
} from "./access";
import {
  evaluateChannelOnboardingGates,
  type ChannelOnboardingGates,
} from "./gates";
import {
  ChannelConnectionSchema,
  isCoherentChannelConnection,
  type ChannelConnection,
} from "./records";
import {
  resolveSupportedCreatorChannel,
} from "./identity";
import { YOUTUBE_READONLY_SCOPE, type YouTubeOAuthScope } from "./scopes";

export type ChannelConnectionPersistence = Readonly<{
  /**
   * Persist all three account-owned records and the active selection in one
   * transaction. Implementations must reject rather than partially commit.
   */
  commitConnectionAtomically(connection: ChannelConnection): Promise<void>;
}>;

/**
 * External launch evidence is supplied by a server-owned caller. Keeping it
 * out of the account access record prevents a client assertion from opening
 * either gate.
 */
export type { ChannelOnboardingGates } from "./gates";

export type ReadAuthorizationState = Readonly<{
  status: "completed" | "cancelled" | "failed";
  readScopeGranted: boolean;
  scopes: readonly YouTubeOAuthScope[];
}>;

export type ChannelOnboardingIds = Readonly<{
  channelId: string;
  grantId: string;
  connectedChannelId: string;
  credentialReferenceId: string;
}>;

type OnboardingBlockedReason =
  | ChannelAccessDeniedReason
  | "no_provider_identity"
  | "multiple_provider_identities"
  | "invalid_provider_identity"
  | "unverified_provider_identity"
  | "multi_host_organization_not_supported"
  | "delegated_studio_not_supported"
  | "not_public_creator_persona"
  | "compliance_clearance_required"
  | "oauth_verification_required"
  | "read_scope_mismatch"
  | "invalid_clock"
  | "invalid_connection_records"
  | "persistence_write_failed";

export type ChannelOnboardingStartResult =
  | Readonly<{ kind: "awaiting_read_authorization" }>
  | Readonly<{
      kind: "blocked";
      reason:
        | ChannelAccessDeniedReason
        | "compliance_clearance_required"
        | "oauth_verification_required";
    }>;

export type ChannelOnboardingResult =
  | Readonly<{
      kind: "connected";
      connection: ChannelConnection;
    }>
  | Readonly<{
      kind: "interrupted";
      reason: "read_authorization_incomplete";
    }>
  | Readonly<{
      kind: "blocked";
      reason: OnboardingBlockedReason;
    }>;

function isValidReadAuthorization(
  authorization: ReadAuthorizationState | null | undefined,
): authorization is ReadAuthorizationState {
  return Boolean(
    authorization &&
      authorization.status === "completed" &&
      authorization.readScopeGranted === true &&
      authorization.scopes.length === 1 &&
      authorization.scopes[0] === YOUTUBE_READONLY_SCOPE,
  );
}

function readAuthorizationHasWrongScope(
  authorization: ReadAuthorizationState | null | undefined,
): boolean {
  return Boolean(
    authorization &&
      authorization.status === "completed" &&
      authorization.readScopeGranted === true &&
      (!Array.isArray(authorization.scopes) ||
        authorization.scopes.length !== 1 ||
        authorization.scopes[0] !== YOUTUBE_READONLY_SCOPE),
  );
}

/**
 * Start the resumable onboarding step without writing an attempt or opening a
 * provider connection. This makes an interrupted browser flow harmless: no
 * local connection exists until completion has passed every check.
 */
export function beginChannelOnboarding(
  access: ChannelAccessContext,
  gates?: ChannelOnboardingGates | null,
): ChannelOnboardingStartResult {
  const decision = authorizeChannelAction("connection", access);
  if (!decision.allowed) return { kind: "blocked", reason: decision.reason };

  const gate = evaluateChannelOnboardingGates(gates);
  return gate.status === "open"
    ? { kind: "awaiting_read_authorization" }
    : { kind: "blocked", reason: gate.reason };
}

/**
 * Complete the read-only onboarding step after the provider callback has
 * returned. The only persistence call is the final atomic commit, and it is
 * reached only after exactly one provider-owned identity is verified.
 */
export async function completeChannelOnboarding(
  input: Readonly<{
    access: ChannelAccessContext;
    gates?: ChannelOnboardingGates | null;
    providerIdentityResults: unknown;
    readAuthorization: ReadAuthorizationState;
    ids: ChannelOnboardingIds;
    persistence: ChannelConnectionPersistence;
    now?: () => Date;
  }>,
): Promise<ChannelOnboardingResult> {
  const accessDecision = authorizeChannelAction("connection", input.access);
  if (!accessDecision.allowed) {
    return { kind: "blocked", reason: accessDecision.reason };
  }

  const gate = evaluateChannelOnboardingGates(input.gates);
  if (gate.status !== "open") {
    return { kind: "blocked", reason: gate.reason };
  }

  if (!isValidReadAuthorization(input.readAuthorization)) {
    if (readAuthorizationHasWrongScope(input.readAuthorization)) {
      return { kind: "blocked", reason: "read_scope_mismatch" };
    }
    return {
      kind: "interrupted",
      reason: "read_authorization_incomplete",
    };
  }

  const identity = resolveSupportedCreatorChannel(
    input.providerIdentityResults,
  );
  if (identity.kind === "rejected") {
    return { kind: "blocked", reason: identity.reason };
  }

  const principal = input.access.principal;
  if (!principal) {
    // The access gate already rejects this state. Keep the second check local
    // to the commit boundary so a future refactor cannot create an ownerless
    // record from a narrowed or stale context.
    return {
      kind: "blocked",
      reason: "authenticated_identity_required",
    };
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
  const createdAt = now.toISOString();
  const { channelId, grantId, connectedChannelId } = input.ids;
  const connection: ChannelConnection = {
    channel: {
      id: channelId,
      ownerId: principal.userId,
      createdAt,
    },
    grant: {
      id: grantId,
      ownerId: principal.userId,
      channelId,
      provider: "youtube",
      providerSubject: identity.identity.providerSubject,
      credentialReferenceId: input.ids.credentialReferenceId,
      oauthScopes: [YOUTUBE_READONLY_SCOPE],
      readScopeGranted: true,
      writeScopeGranted: false,
      status: "active",
      createdAt,
    },
    connectedChannel: {
      id: connectedChannelId,
      ownerId: principal.userId,
      channelId,
      grantId,
      provider: "youtube",
      providerChannelId: identity.identity.providerChannelId,
      displayName: identity.identity.displayName,
      supportedCreator: true,
      status: "active",
      createdAt,
    },
    activeConnectedChannelId: connectedChannelId,
  };

  const parsedConnection = ChannelConnectionSchema.safeParse(connection);
  if (!parsedConnection.success || !isCoherentChannelConnection(parsedConnection.data)) {
    return { kind: "blocked", reason: "invalid_connection_records" };
  }

  if (
    !input.persistence ||
    typeof input.persistence.commitConnectionAtomically !== "function"
  ) {
    return { kind: "blocked", reason: "persistence_write_failed" };
  }

  try {
    await input.persistence.commitConnectionAtomically(parsedConnection.data);
  } catch {
    return { kind: "blocked", reason: "persistence_write_failed" };
  }

  return { kind: "connected", connection: parsedConnection.data };
}
