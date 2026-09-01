import type {
  ChannelPrincipal,
  ConnectedChannelReference,
} from "./access";

export type ActiveChannelSelectionResult =
  | Readonly<{
      kind: "selected";
      connectedChannelId: string;
    }>
  | Readonly<{
      kind: "blocked";
      reason:
        | "authenticated_identity_required"
        | "connected_channel_not_owned"
        | "multiple_connected_channels"
        | "connected_channel_not_active"
        | "unsupported_creator_channel";
    }>;

function isAuthenticated(
  principal: ChannelPrincipal | null | undefined,
): principal is ChannelPrincipal {
  return Boolean(
    principal &&
      principal.isAnonymous === false &&
      typeof principal.userId === "string" &&
      principal.userId.trim().length > 0,
  );
}

/**
 * Validate an active-channel switch against account-owned, provider-verified
 * records. The persistence adapter should apply the returned selection with
 * a transaction that replaces the account's single active selection row.
 */
export function selectActiveConnectedChannel(input: Readonly<{
  principal: ChannelPrincipal | null;
  requestedConnectedChannelId: string;
  connectedChannels: readonly ConnectedChannelReference[];
}>): ActiveChannelSelectionResult {
  if (!isAuthenticated(input.principal)) {
    return { kind: "blocked", reason: "authenticated_identity_required" };
  }
  if (
    typeof input.requestedConnectedChannelId !== "string" ||
    input.requestedConnectedChannelId.trim().length === 0
  ) {
    return { kind: "blocked", reason: "connected_channel_not_owned" };
  }

  const matches = input.connectedChannels.filter(
    (channel) =>
      channel.connectedChannelId === input.requestedConnectedChannelId,
  );
  if (matches.length > 1) {
    return { kind: "blocked", reason: "multiple_connected_channels" };
  }
  const channel = matches[0];
  if (!channel || channel.ownerId !== input.principal.userId) {
    return { kind: "blocked", reason: "connected_channel_not_owned" };
  }
  if (channel.supportedCreator !== true) {
    return { kind: "blocked", reason: "unsupported_creator_channel" };
  }
  if (channel.status !== "active") {
    return { kind: "blocked", reason: "connected_channel_not_active" };
  }

  return {
    kind: "selected",
    connectedChannelId: channel.connectedChannelId,
  };
}
