import { describe, expect, it } from "vitest";

import { selectActiveConnectedChannel } from "../active";

const CHANNELS = [
  {
    ownerId: "researcher-1",
    channelId: "channel-1",
    connectedChannelId: "connected-1",
    grantId: "grant-1",
    supportedCreator: true,
    status: "active" as const,
  },
  {
    ownerId: "researcher-1",
    channelId: "channel-2",
    connectedChannelId: "connected-2",
    grantId: "grant-2",
    supportedCreator: true,
    status: "active" as const,
  },
];

describe("selectActiveConnectedChannel", () => {
  it("selects one owned supported Connected Channel by its provider-bound ID", () => {
    expect(
      selectActiveConnectedChannel({
        principal: { userId: "researcher-1", isAnonymous: false },
        requestedConnectedChannelId: "connected-2",
        connectedChannels: CHANNELS,
      }),
    ).toEqual({
      kind: "selected",
      connectedChannelId: "connected-2",
    });
  });

  it("rejects an unowned or revoked identity", () => {
    expect(
      selectActiveConnectedChannel({
        principal: { userId: "researcher-1", isAnonymous: false },
        requestedConnectedChannelId: "connected-other",
        connectedChannels: [
          {
            ...CHANNELS[0],
            ownerId: "researcher-2",
          },
        ],
      }),
    ).toEqual({ kind: "blocked", reason: "connected_channel_not_owned" });

    expect(
      selectActiveConnectedChannel({
        principal: { userId: "researcher-1", isAnonymous: false },
        requestedConnectedChannelId: "connected-1",
        connectedChannels: [
          {
            ...CHANNELS[0],
            status: "revoked",
          },
        ],
      }),
    ).toEqual({ kind: "blocked", reason: "connected_channel_not_active" });
  });

  it("fails closed when identity or ownership is ambiguous", () => {
    expect(
      selectActiveConnectedChannel({
        principal: null,
        requestedConnectedChannelId: "connected-1",
        connectedChannels: CHANNELS,
      }),
    ).toEqual({ kind: "blocked", reason: "authenticated_identity_required" });

    expect(
      selectActiveConnectedChannel({
        principal: { userId: "researcher-1", isAnonymous: false },
        requestedConnectedChannelId: "connected-1",
        connectedChannels: [CHANNELS[0], CHANNELS[0]],
      }),
    ).toEqual({
      kind: "blocked",
      reason: "multiple_connected_channels",
    });
  });
});
