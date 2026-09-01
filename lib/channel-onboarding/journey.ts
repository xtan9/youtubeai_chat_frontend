import {
  authorizeChannelAction,
  type ChannelAccessContext,
  type ChannelAccessDeniedReason,
} from "./access";
import {
  isCoherentChannelConnection,
  type ChannelConnection,
} from "./records";
import {
  resolveSupportedCreatorChannel,
} from "./identity";
import {
  ChannelGrantRecordSchema,
  ChannelRecordSchema,
  ConnectedChannelRecordSchema,
} from "./records";

export type ChannelConnectionPersistence = Readonly<{
  /**
   * Persist all three account-owned records and the active selection in one
   * transaction. Implementations must reject rather than partially commit.
   */
  commitConnectionAtomically(connection: ChannelConnection): Promise<void>;
}>;

export type ReadAuthorizationState = Readonly<{
  status: "completed" | "cancelled" | "failed";
  readScopeGranted: boolean;
}>;

export type ChannelOnboardingIds = Readonly<{
  channelId: string;
  grantId: string;
  connectedChannelId: string;
}>;

type OnboardingBlockedReason =
  | ChannelAccessDeniedReason
  | "no_provider_identity"
  | "multiple_provider_identities"
  | "invalid_provider_identity"
  | "unverified_provider_identity"
  | "invalid_clock"
  | "invalid_connection_records"
  | "persistence_write_failed";

export type ChannelOnboardingStartResult =
  | Readonly<{ kind: "awaiting_read_authorization" }>
  | Readonly<{
      kind: "blocked";
      reason: ChannelAccessDeniedReason;
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
      authorization.readScopeGranted === true,
  );
}

/**
 * Start the resumable onboarding step without writing an attempt or opening a
 * provider connection. This makes an interrupted browser flow harmless: no
 * local connection exists until completion has passed every check.
 */
export function beginChannelOnboarding(
  access: ChannelAccessContext,
): ChannelOnboardingStartResult {
  const decision = authorizeChannelAction("connection", access);
  return decision.allowed
    ? { kind: "awaiting_read_authorization" }
    : { kind: "blocked", reason: decision.reason };
}

/**
 * Complete the read-only onboarding step after the provider callback has
 * returned. The only persistence call is the final atomic commit, and it is
 * reached only after exactly one provider-owned identity is verified.
 */
export async function completeChannelOnboarding(
  input: Readonly<{
    access: ChannelAccessContext;
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

  if (!isValidReadAuthorization(input.readAuthorization)) {
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

  const now = input.now?.() ?? new Date();
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

  if (
    !ChannelRecordSchema.safeParse(connection.channel).success ||
    !ChannelGrantRecordSchema.safeParse(connection.grant).success ||
    !ConnectedChannelRecordSchema.safeParse(connection.connectedChannel)
      .success ||
    !isCoherentChannelConnection(connection)
  ) {
    return { kind: "blocked", reason: "invalid_connection_records" };
  }

  if (
    !input.persistence ||
    typeof input.persistence.commitConnectionAtomically !== "function"
  ) {
    return { kind: "blocked", reason: "persistence_write_failed" };
  }

  try {
    await input.persistence.commitConnectionAtomically(connection);
  } catch {
    return { kind: "blocked", reason: "persistence_write_failed" };
  }

  return { kind: "connected", connection };
}
