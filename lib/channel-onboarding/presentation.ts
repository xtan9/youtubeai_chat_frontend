import type {
  ChannelEntitlement,
  ChannelPrincipal,
} from "./access";

const CHANNEL_DESCRIPTION =
  "Review interactions for your connected YouTube Channel and keep every reply under your control.";

export type ChannelCapabilityPresentation = Readonly<{
  surface: "Channel";
  hub: "Channel Hub";
  description: string;
  state: "upgrade_required" | "ready_to_connect" | "unavailable";
  capabilities: Readonly<{
    canBeginConnection: boolean;
    canScan: boolean;
    canReview: boolean;
    canDraft: boolean;
    canPublish: boolean;
  }>;
  primaryAction:
    | Readonly<{
        kind: "upgrade" | "begin_connection";
        label: string;
        href?: string;
      }>
    | null;
}>;

const NO_ACTION_CAPABILITIES = {
  canBeginConnection: false,
  canScan: false,
  canReview: false,
  canDraft: false,
  canPublish: false,
} as const;

function isRegisteredResearcher(
  principal: ChannelPrincipal | null | undefined,
): principal is ChannelPrincipal {
  return Boolean(
    principal &&
      principal.isAnonymous === false &&
      typeof principal.userId === "string" &&
      principal.userId.trim().length > 0,
  );
}

function isVerifiedEntitlement(
  entitlement: ChannelEntitlement | null | undefined,
): entitlement is ChannelEntitlement {
  return Boolean(entitlement && entitlement.verified === true);
}

/**
 * Describe the eventual Channel entry without registering it in application
 * navigation. Free users get product education and the existing pricing
 * surface; no Channel action is exposed to them.
 */
export function buildChannelCapabilityPresentation(input: Readonly<{
  principal: ChannelPrincipal | null;
  entitlement: ChannelEntitlement | null;
}>): ChannelCapabilityPresentation {
  if (
    !isRegisteredResearcher(input.principal) ||
    !isVerifiedEntitlement(input.entitlement)
  ) {
    return {
      surface: "Channel",
      hub: "Channel Hub",
      description: CHANNEL_DESCRIPTION,
      state: "unavailable",
      capabilities: NO_ACTION_CAPABILITIES,
      primaryAction: null,
    };
  }

  if (input.entitlement.state === "free") {
    return {
      surface: "Channel",
      hub: "Channel Hub",
      description: CHANNEL_DESCRIPTION,
      state: "upgrade_required",
      capabilities: NO_ACTION_CAPABILITIES,
      primaryAction: {
        kind: "upgrade",
        label: "Upgrade to Pro",
        href: "/pricing?source_surface=channel",
      },
    };
  }

  if (
    input.entitlement.state !== "active_pro" &&
    input.entitlement.state !== "pro_pending_cancellation"
  ) {
    return {
      surface: "Channel",
      hub: "Channel Hub",
      description: CHANNEL_DESCRIPTION,
      state: "unavailable",
      capabilities: NO_ACTION_CAPABILITIES,
      primaryAction: null,
    };
  }

  return {
    surface: "Channel",
    hub: "Channel Hub",
    description: CHANNEL_DESCRIPTION,
    state: "ready_to_connect",
    capabilities: {
      ...NO_ACTION_CAPABILITIES,
      canBeginConnection: true,
    },
    primaryAction: {
      kind: "begin_connection",
      label: "Connect a YouTube Channel",
    },
  };
}
