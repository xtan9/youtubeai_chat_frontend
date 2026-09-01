/**
 * The access contract for Channel actions.
 *
 * This module intentionally has no default clients, feature flags, or
 * provider calls. Callers must provide every prerequisite so an omitted or
 * stale dependency cannot accidentally become an authorization decision.
 */

export const CHANNEL_ACTIONS = [
  "connection",
  "scan",
  "review",
  "draft",
  "publication",
] as const;

export type ChannelAction = (typeof CHANNEL_ACTIONS)[number];

export type ChannelPrincipal = Readonly<{
  userId: string;
  isAnonymous: boolean;
}>;

export type ChannelEntitlementState =
  | "active_pro"
  | "pro_pending_cancellation"
  | "free"
  | "billing_issue"
  | "unavailable";

export type ChannelEntitlement = Readonly<{
  /** This is the server-resolved subscription presentation state. */
  state: ChannelEntitlementState;
  /** The lookup was authoritative rather than a client/UI assertion. */
  verified: boolean;
}>;

export type AdultAttestation = Readonly<{
  attested: boolean;
  attestedAt: string;
  policyVersion: string;
}>;

export type ConnectedChannelReference = Readonly<{
  ownerId: string;
  channelId: string;
  connectedChannelId: string;
  grantId: string;
  supportedCreator: boolean;
  status: "active" | "revoked";
}>;

export type PublishingAuthorization = Readonly<{
  grantId: string;
  granted: boolean;
  verified: boolean;
  scopes: readonly string[];
}>;

export type ChannelAccessContext = Readonly<{
  principal: ChannelPrincipal | null;
  entitlement: ChannelEntitlement | null;
  persistenceAvailable: boolean;
  adultAttestation: AdultAttestation | null;
  connectedChannel?: ConnectedChannelReference | null;
  publishingAuthorization?: PublishingAuthorization | null;
}>;

export type ChannelAccessDeniedReason =
  | "authenticated_identity_required"
  | "active_pro_entitlement_required"
  | "persistence_unavailable"
  | "adult_attestation_required"
  | "connected_channel_identity_required"
  | "connected_channel_identity_mismatch"
  | "publishing_authorization_mismatch"
  | "publishing_authorization_required";

export type ChannelAccessDecision =
  | Readonly<{ allowed: true; action: ChannelAction }>
  | Readonly<{
      allowed: false;
      action: ChannelAction;
      reason: ChannelAccessDeniedReason;
    }>;

const ACTIVE_PAID_STATES = new Set<ChannelEntitlementState>([
  "active_pro",
  "pro_pending_cancellation",
]);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidAttestation(
  attestation: AdultAttestation | null | undefined,
): boolean {
  if (!attestation || attestation.attested !== true) return false;
  if (!hasText(attestation.policyVersion)) return false;
  const timestamp = Date.parse(attestation.attestedAt);
  return Number.isFinite(timestamp);
}

function hasConnectedIdentity(
  principal: ChannelPrincipal,
  connectedChannel: ConnectedChannelReference | null | undefined,
): boolean {
  return Boolean(
    connectedChannel &&
      hasText(connectedChannel.ownerId) &&
      hasText(connectedChannel.channelId) &&
      hasText(connectedChannel.connectedChannelId) &&
      hasText(connectedChannel.grantId) &&
      connectedChannel.ownerId === principal.userId &&
      connectedChannel.supportedCreator === true &&
      connectedChannel.status === "active",
  );
}

function deny(
  action: ChannelAction,
  reason: ChannelAccessDeniedReason,
): ChannelAccessDecision {
  return { allowed: false, action, reason };
}

/**
 * Authorize one Channel action from authoritative, server-resolved facts.
 *
 * The order is deliberate: authentication, paid access, durable state, and
 * adult attestation are required for *every* new action. Work actions then
 * require a verified Connected Channel identity, and publication additionally
 * requires the separate write grant.
 */
export function authorizeChannelAction(
  action: ChannelAction,
  context: ChannelAccessContext,
): ChannelAccessDecision {
  const principal = context.principal;
  if (
    !principal ||
    principal.isAnonymous !== false ||
    !hasText(principal.userId)
  ) {
    return deny(action, "authenticated_identity_required");
  }

  const entitlement = context.entitlement;
  if (
    !entitlement ||
    entitlement.verified !== true ||
    !ACTIVE_PAID_STATES.has(entitlement.state)
  ) {
    return deny(action, "active_pro_entitlement_required");
  }

  if (context.persistenceAvailable !== true) {
    return deny(action, "persistence_unavailable");
  }

  if (!hasValidAttestation(context.adultAttestation)) {
    return deny(action, "adult_attestation_required");
  }

  if (action !== "connection") {
    if (!context.connectedChannel) {
      return deny(action, "connected_channel_identity_required");
    }
    if (!hasConnectedIdentity(principal, context.connectedChannel)) {
      return deny(action, "connected_channel_identity_mismatch");
    }
  }

  if (action === "publication") {
    const authorization = context.publishingAuthorization;
    if (
      authorization &&
      authorization.grantId !== context.connectedChannel?.grantId
    ) {
      return deny(action, "publishing_authorization_mismatch");
    }
    if (
      !authorization ||
      authorization.granted !== true ||
      authorization.verified !== true ||
      !hasText(authorization.grantId) ||
      !authorization.scopes.includes("youtube.force-ssl")
    ) {
      return deny(action, "publishing_authorization_required");
    }
  }

  return { allowed: true, action };
}
