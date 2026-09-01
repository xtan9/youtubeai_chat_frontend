import type {
  ChannelAccessContext,
  ChannelAccessDeniedReason,
  ChannelEntitlement,
  ChannelEntitlementState,
} from "@/lib/channel-onboarding/access";
import {
  authorizeChannelAction,
  type ChannelAction,
  type ChannelPrincipal,
} from "@/lib/channel-onboarding/access";
import type { ChannelLaunchGate } from "@/lib/compliance/channel-launch";
import type {
  ChannelHubState,
  HubAction,
} from "@/lib/channel-hub/contract";

export const CHANNEL_HUB_PATH = "/channel" as const;

export function channelEntitlementFromState(
  state: ChannelEntitlementState,
): ChannelEntitlement {
  return { state, verified: true };
}

export const CHANNEL_ACCOUNT_ACTIONS = [
  "connect",
  "manage_permissions",
  "revoke",
  "disconnect",
  "export_data",
  "delete_data",
] as const;

export type ChannelAccountAction = (typeof CHANNEL_ACCOUNT_ACTIONS)[number];

export type ChannelReleaseDeniedReason =
  | "channel_release_required"
  | "registered_identity_required"
  | "entitlement_unavailable"
  | "account_control_requires_persistence"
  | ChannelAccessDeniedReason;

export type ChannelExposure =
  | Readonly<{
      kind: "blocked";
      reason: ChannelReleaseDeniedReason;
      blockedGates?: readonly string[];
    }>
  | Readonly<{
      kind: "free_discovery";
      state: Extract<ChannelHubState, { kind: "free_discovery" }>;
    }>
  | Readonly<{
      kind: "pro_onboarding";
      state: Extract<ChannelHubState, { kind: "pro_onboarding" }>;
    }>
  | Readonly<{
      kind: "connected";
      connectedChannel: NonNullable<ChannelAccessContext["connectedChannel"]>;
    }>;

export type ChannelNavigationItem = Readonly<{
  label: "Channel";
  href: typeof CHANNEL_HUB_PATH;
}>;

export type ChannelHubActionDecision =
  | Readonly<{ allowed: true; action: HubAction }>
  | Readonly<{
      allowed: false;
      action: HubAction;
      reason: ChannelReleaseDeniedReason;
    }>;

export type ChannelAccountActionDecision =
  | Readonly<{ allowed: true; action: ChannelAccountAction }>
  | Readonly<{
      allowed: false;
      action: ChannelAccountAction;
      reason: ChannelReleaseDeniedReason;
    }>;

function isRegistered(
  principal: ChannelPrincipal | null | undefined,
): principal is ChannelPrincipal {
  return Boolean(
    principal &&
      principal.isAnonymous === false &&
      typeof principal.userId === "string" &&
      principal.userId.trim().length > 0,
  );
}

function isActivePaid(
  access: ChannelAccessContext,
): boolean {
  return (
    access.entitlement?.verified === true &&
    (access.entitlement.state === "active_pro" ||
      access.entitlement.state === "pro_pending_cancellation")
  );
}

function launchIsOpen(
  launchGate: ChannelLaunchGate | null | undefined,
): launchGate is Extract<ChannelLaunchGate, { status: "open" }> {
  return launchGate?.status === "open";
}

export function buildChannelNavigation(input: Readonly<{
  principal: ChannelPrincipal | null | undefined;
  launchGate: ChannelLaunchGate | null | undefined;
}>): readonly ChannelNavigationItem[] {
  if (!launchIsOpen(input.launchGate) || !isRegistered(input.principal)) {
    return [];
  }
  return [{ label: "Channel", href: CHANNEL_HUB_PATH }];
}

function onboardingStep(
  access: ChannelAccessContext,
): Extract<ChannelHubState, { kind: "pro_onboarding" }>["step"] {
  if (!access.adultAttestation?.attested) return "attest_age";
  return "authorize_read";
}

/**
 * Resolve the user-facing Channel state from server-owned facts. The launch
 * decision comes first so a stale or partial entitlement cannot expose a
 * route before the complete packet is open.
 */
export function resolveChannelExposure(input: Readonly<{
  launchGate: ChannelLaunchGate | null | undefined;
  access: ChannelAccessContext;
}>): ChannelExposure {
  if (!launchIsOpen(input.launchGate)) {
    return {
      kind: "blocked",
      reason: "channel_release_required",
      blockedGates:
        input.launchGate?.status === "blocked"
          ? input.launchGate.blockedGates
          : ["launch_packet"],
    };
  }

  const access = input.access;
  if (!isRegistered(access.principal)) {
    return { kind: "blocked", reason: "registered_identity_required" };
  }

  if (access.entitlement?.verified !== true) {
    return { kind: "blocked", reason: "entitlement_unavailable" };
  }

  if (access.entitlement.state === "free") {
    return {
      kind: "free_discovery",
      state: {
        kind: "free_discovery",
        upgradeHref: "/pricing?source_surface=channel",
      },
    };
  }

  if (!isActivePaid(access)) {
    return { kind: "blocked", reason: "entitlement_unavailable" };
  }

  if (access.connectedChannel || access.grant) {
    const decision = authorizeChannelAction("scan", access);
    if (!decision.allowed) {
      return { kind: "blocked", reason: decision.reason };
    }
    if (!access.connectedChannel) {
      return { kind: "blocked", reason: "connected_channel_identity_required" };
    }
    return { kind: "connected", connectedChannel: access.connectedChannel };
  }

  const connectionDecision = authorizeChannelAction("connection", access);
  return {
    kind: "pro_onboarding",
    state: {
      kind: "pro_onboarding",
      step: onboardingStep(access),
      canContinue: connectionDecision.allowed,
    },
  };
}

const HUB_ACTION_TO_CHANNEL_ACTION: Readonly<
  Partial<Record<HubAction, ChannelAction>>
> = {
  connect: "connection",
  continue_onboarding: "connection",
  start_scan: "scan",
  cancel_scan: "scan",
  open_review: "review",
  dismiss: "review",
  defer: "review",
  mark_allowed_criticism: "review",
  confirm_actionable_abuse: "review",
  continue_safety_guidance: "review",
  open_on_youtube: "review",
  request_draft: "draft",
  edit_draft: "draft",
  publish: "publication",
  retry_publication: "publication",
  recheck_publication: "publication",
  delete_published_reply: "publication",
};

function releaseDenied<T extends string>(
  action: T,
): { allowed: false; action: T; reason: "channel_release_required" } {
  return { allowed: false, action, reason: "channel_release_required" };
}

export function authorizeChannelHubAction(input: Readonly<{
  action: HubAction;
  launchGate: ChannelLaunchGate | null | undefined;
  access: ChannelAccessContext;
}>): ChannelHubActionDecision {
  if (!launchIsOpen(input.launchGate)) {
    return releaseDenied(input.action);
  }

  if (input.action === "upgrade") {
    return isRegistered(input.access.principal)
      ? { allowed: true, action: input.action }
      : { allowed: false, action: input.action, reason: "registered_identity_required" };
  }

  if (
    input.action === "disconnect" ||
    input.action === "export_data" ||
    input.action === "delete_data"
  ) {
    const decision = authorizeChannelAccountAction({
      action: input.action,
      launchGate: input.launchGate,
      access: input.access,
    });
    return decision.allowed
      ? { allowed: true, action: input.action }
      : { allowed: false, action: input.action, reason: decision.reason };
  }

  const channelAction = HUB_ACTION_TO_CHANNEL_ACTION[input.action];
  if (!channelAction) {
    return {
      allowed: false,
      action: input.action,
      reason: "registered_identity_required",
    };
  }
  const decision = authorizeChannelAction(channelAction, input.access);
  return decision.allowed
    ? { allowed: true, action: input.action }
    : { allowed: false, action: input.action, reason: decision.reason };
}

/**
 * Account is the owner of connection, permission, revocation, export, and
 * deletion controls. These controls intentionally do not call a global OAuth
 * revocation endpoint; they operate on this account's Channel grant.
 */
export function authorizeChannelAccountAction(input: Readonly<{
  action: ChannelAccountAction;
  launchGate: ChannelLaunchGate | null | undefined;
  access: ChannelAccessContext;
}>): ChannelAccountActionDecision {
  if (!launchIsOpen(input.launchGate)) {
    return releaseDenied(input.action);
  }
  if (!isRegistered(input.access.principal)) {
    return {
      allowed: false,
      action: input.action,
      reason: "registered_identity_required",
    };
  }

  if (input.action === "connect") {
    const decision = authorizeChannelAction("connection", input.access);
    return decision.allowed
      ? { allowed: true, action: input.action }
      : { allowed: false, action: input.action, reason: decision.reason };
  }

  if (
    input.action === "disconnect" ||
    input.action === "revoke" ||
    input.action === "export_data" ||
    input.action === "delete_data"
  ) {
    return input.access.persistenceAvailable === true
      ? { allowed: true, action: input.action }
      : {
          allowed: false,
          action: input.action,
          reason: "account_control_requires_persistence",
        };
  }

  return { allowed: true, action: input.action };
}
