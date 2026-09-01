import { describe, expect, it, vi } from "vitest";

import { type ChannelAccessContext } from "../access";
import {
  beginChannelOnboarding,
  completeChannelOnboarding,
  type ChannelConnectionPersistence,
} from "../journey";

const NOW = "2026-08-31T12:00:00.000Z";
const OWNER_ID = "researcher-1";

const IDENTITY = {
  provider: "youtube" as const,
  providerSubject: "google-subject-1",
  providerChannelId: "UC_verified",
  displayName: "Verified creator channel",
  mine: true as const,
};

const ACCESS: ChannelAccessContext = {
  principal: { userId: OWNER_ID, isAnonymous: false },
  entitlement: { state: "active_pro", verified: true },
  persistenceAvailable: true,
  adultAttestation: {
    attested: true,
    attestedAt: NOW,
    policyVersion: "channel-adult-v1",
  },
};

const IDS = {
  channelId: "channel-1",
  grantId: "grant-1",
  connectedChannelId: "connected-1",
} as const;

const READ_AUTHORIZATION = {
  status: "completed" as const,
  readScopeGranted: true,
};

function persistence(): {
  adapter: ChannelConnectionPersistence;
  commit: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn().mockResolvedValue(undefined);
  return {
    commit,
    adapter: { commitConnectionAtomically: commit },
  };
}

function input(
  overrides: Partial<Parameters<typeof completeChannelOnboarding>[0]> = {},
) {
  return {
    access: ACCESS,
    providerIdentityResults: [IDENTITY],
    readAuthorization: READ_AUTHORIZATION,
    ids: IDS,
    persistence: persistence().adapter,
    now: () => new Date(NOW),
    ...overrides,
  };
}

describe("Channel onboarding journey", () => {
  it("lets a fully eligible Pro Researcher start read-only identity authorization without persisting an attempt", () => {
    expect(beginChannelOnboarding(ACCESS)).toEqual({
      kind: "awaiting_read_authorization",
    });
  });

  it("atomically commits one Channel, one grant, and one verified Connected Channel", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({ persistence: adapter }),
    );

    expect(result).toMatchObject({ kind: "connected" });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({
      activeConnectedChannelId: IDS.connectedChannelId,
      channel: {
        id: IDS.channelId,
        ownerId: OWNER_ID,
        createdAt: NOW,
      },
      grant: {
        id: IDS.grantId,
        ownerId: OWNER_ID,
        channelId: IDS.channelId,
        provider: "youtube",
        providerSubject: IDENTITY.providerSubject,
        readScopeGranted: true,
        writeScopeGranted: false,
        status: "active",
        createdAt: NOW,
      },
      connectedChannel: {
        id: IDS.connectedChannelId,
        ownerId: OWNER_ID,
        channelId: IDS.channelId,
        grantId: IDS.grantId,
        provider: "youtube",
        providerChannelId: IDENTITY.providerChannelId,
        displayName: IDENTITY.displayName,
        supportedCreator: true,
        status: "active",
        createdAt: NOW,
      },
    });
  });

  it("creates no partial connection when read authorization is interrupted", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({
        persistence: adapter,
        readAuthorization: {
          status: "cancelled",
          readScopeGranted: false,
        },
      }),
    );

    expect(result).toEqual({
      kind: "interrupted",
      reason: "read_authorization_incomplete",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("creates no connection for zero provider identities", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({ persistence: adapter, providerIdentityResults: [] }),
    );

    expect(result).toEqual({
      kind: "blocked",
      reason: "no_provider_identity",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("creates no connection for multiple provider identities", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({
        persistence: adapter,
        providerIdentityResults: [
          IDENTITY,
          { ...IDENTITY, providerChannelId: "UC_other" },
        ],
      }),
    );

    expect(result).toEqual({
      kind: "blocked",
      reason: "multiple_provider_identities",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not persist when the account loses a required prerequisite", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({
        access: { ...ACCESS, entitlement: { state: "free", verified: true } },
        persistence: adapter,
      }),
    );

    expect(result).toEqual({
      kind: "blocked",
      reason: "active_pro_entitlement_required",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("reports persistence failure after identity verification without exposing a partial success", async () => {
    const commit = vi.fn().mockRejectedValue(new Error("database unavailable"));

    const result = await completeChannelOnboarding(
      input({
        persistence: { commitConnectionAtomically: commit },
      }),
    );

    expect(result).toEqual({
      kind: "blocked",
      reason: "persistence_write_failed",
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
