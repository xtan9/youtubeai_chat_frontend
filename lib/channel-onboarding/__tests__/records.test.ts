import { describe, expect, it } from "vitest";

import {
  ChannelGrantRecordSchema,
  ChannelRecordSchema,
  isCoherentChannelConnection,
} from "../records";

const CONNECTION = {
  channel: {
    id: "channel-1",
    ownerId: "researcher-1",
    createdAt: "2026-08-31T12:00:00.000Z",
  },
  grant: {
    id: "grant-1",
    ownerId: "researcher-1",
    channelId: "channel-1",
    provider: "youtube" as const,
    providerSubject: "google-subject-1",
    readScopeGranted: true as const,
    writeScopeGranted: false,
    status: "active" as const,
    createdAt: "2026-08-31T12:00:00.000Z",
  },
  connectedChannel: {
    id: "connected-1",
    ownerId: "researcher-1",
    channelId: "channel-1",
    grantId: "grant-1",
    provider: "youtube" as const,
    providerChannelId: "UC_verified",
    displayName: "Verified creator channel",
    supportedCreator: true as const,
    status: "active" as const,
    createdAt: "2026-08-31T12:00:00.000Z",
  },
  activeConnectedChannelId: "connected-1",
};

describe("Channel onboarding records", () => {
  it("keeps the account-owned Channel record separate from its provider grant", () => {
    expect(ChannelRecordSchema.safeParse(CONNECTION.channel).success).toBe(true);
    expect(ChannelGrantRecordSchema.safeParse(CONNECTION.grant).success).toBe(
      true,
    );
    expect(isCoherentChannelConnection(CONNECTION)).toBe(true);
    expect(CONNECTION.channel).not.toHaveProperty("providerChannelId");
    expect(CONNECTION.grant).not.toHaveProperty("accessToken");
  });

  it("rejects cross-account, cross-Channel, or stale-active bindings", () => {
    expect(
      isCoherentChannelConnection({
        ...CONNECTION,
        grant: { ...CONNECTION.grant, ownerId: "researcher-2" },
      }),
    ).toBe(false);
    expect(
      isCoherentChannelConnection({
        ...CONNECTION,
        connectedChannel: {
          ...CONNECTION.connectedChannel,
          channelId: "channel-other",
        },
      }),
    ).toBe(false);
    expect(
      isCoherentChannelConnection({
        ...CONNECTION,
        activeConnectedChannelId: "connected-old",
      }),
    ).toBe(false);
  });
});
