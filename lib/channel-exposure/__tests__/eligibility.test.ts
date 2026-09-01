import { describe, expect, it } from "vitest";

import {
  authorizeChannelAccountAction,
  authorizeChannelHubAction,
  buildChannelNavigation,
  resolveChannelExposure,
  type ChannelAccountAction,
} from "../eligibility";
import type { ChannelAccessContext } from "@/lib/channel-onboarding/access";
import type { ChannelLaunchGate } from "@/lib/compliance/channel-launch";

const OPEN_GATE: ChannelLaunchGate = {
  status: "open",
  reason: "Every Channel release gate has explicit evidence.",
};

const BLOCKED_GATE: ChannelLaunchGate = {
  status: "blocked",
  blockedGates: ["youtube_compliance", "production_readiness"],
  reason: "Channel release remains blocked on: youtube_compliance, production_readiness.",
};

const CONNECTED_CHANNEL = {
  ownerId: "user-pro",
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  supportedCreator: true,
  status: "active" as const,
};

const GRANT = {
  ownerId: "user-pro",
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  credentialReferenceId: "credential-1",
  provider: "youtube" as const,
  scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
  readScopeGranted: true,
  writeScopeGranted: false,
  status: "active" as const,
};

const BASE_ACCESS: ChannelAccessContext = {
  principal: { userId: "user-pro", isAnonymous: false },
  entitlement: { state: "active_pro", verified: true },
  persistenceAvailable: true,
  adultAttestation: {
    attested: true,
    attestedAt: "2026-09-01T12:00:00.000Z",
    policyVersion: "channel-adult-v1",
  },
  connectedChannel: CONNECTED_CHANNEL,
  grant: GRANT,
};

describe("Channel exposure eligibility", () => {
  it("adds one uniform Channel navigation entry for every registered user only after release", () => {
    expect(
      buildChannelNavigation({
        principal: { userId: "free-user", isAnonymous: false },
        launchGate: OPEN_GATE,
      }),
    ).toEqual([{ label: "Channel", href: "/channel" }]);
    expect(
      buildChannelNavigation({
        principal: { userId: "pro-user", isAnonymous: false },
        launchGate: OPEN_GATE,
      }),
    ).toEqual([{ label: "Channel", href: "/channel" }]);
    expect(
      buildChannelNavigation({
        principal: { userId: "anon", isAnonymous: true },
        launchGate: OPEN_GATE,
      }),
    ).toEqual([]);
    expect(
      buildChannelNavigation({
        principal: { userId: "pro-user", isAnonymous: false },
        launchGate: BLOCKED_GATE,
      }),
    ).toEqual([]);
  });

  it("fails closed before interpreting Free or Pro entitlement when the full packet is not open", () => {
    const result = resolveChannelExposure({
      launchGate: BLOCKED_GATE,
      access: BASE_ACCESS,
    });

    expect(result).toMatchObject({
      kind: "blocked",
      reason: "channel_release_required",
    });
  });

  it("gives a registered Free user discovery and upgrade without action capability", () => {
    const result = resolveChannelExposure({
      launchGate: OPEN_GATE,
      access: {
        ...BASE_ACCESS,
        principal: { userId: "free-user", isAnonymous: false },
        entitlement: { state: "free", verified: true },
        connectedChannel: null,
        grant: null,
      },
    });

    expect(result).toEqual({
      kind: "free_discovery",
      state: { kind: "free_discovery", upgradeHref: "/pricing?source_surface=channel" },
    });
  });

  it("lets every active Pro user enter resumable onboarding or the connected Hub", () => {
    expect(
      resolveChannelExposure({
        launchGate: OPEN_GATE,
        access: { ...BASE_ACCESS, connectedChannel: null, grant: null },
      }),
    ).toEqual({
      kind: "pro_onboarding",
      state: { kind: "pro_onboarding", step: "authorize_read", canContinue: true },
    });

    expect(
      resolveChannelExposure({ launchGate: OPEN_GATE, access: BASE_ACCESS }),
    ).toEqual({
      kind: "connected",
      connectedChannel: CONNECTED_CHANNEL,
    });
  });

  it("revalidates release and Channel authority for each Hub action", () => {
    expect(
      authorizeChannelHubAction({
        action: "start_scan",
        launchGate: BLOCKED_GATE,
        access: BASE_ACCESS,
      }),
    ).toMatchObject({ allowed: false, reason: "channel_release_required" });

    expect(
      authorizeChannelHubAction({
        action: "start_scan",
        launchGate: OPEN_GATE,
        access: {
          ...BASE_ACCESS,
          principal: { userId: "other-user", isAnonymous: false },
        },
      }),
    ).toMatchObject({ allowed: false, reason: "connected_channel_identity_mismatch" });

    expect(
      authorizeChannelHubAction({
        action: "start_scan",
        launchGate: OPEN_GATE,
        access: BASE_ACCESS,
      }),
    ).toEqual({ allowed: true, action: "start_scan" });
  });

  it("keeps connection, permission, revocation, export, and deletion under Account authorization", () => {
    const accountActions: readonly ChannelAccountAction[] = [
      "connect",
      "manage_permissions",
      "disconnect",
      "export_data",
      "delete_data",
    ];

    for (const action of accountActions) {
      const result = authorizeChannelAccountAction({
        action,
        launchGate: OPEN_GATE,
        access: {
          ...BASE_ACCESS,
          entitlement: { state: "free", verified: true },
        },
      });

      if (action === "connect") {
        expect(result).toMatchObject({
          allowed: false,
          reason: "active_pro_entitlement_required",
        });
      } else {
        expect(result).toEqual({ allowed: true, action });
      }
    }

    expect(
      authorizeChannelAccountAction({
        action: "delete_data",
        launchGate: BLOCKED_GATE,
        access: BASE_ACCESS,
      }),
    ).toMatchObject({ allowed: false, reason: "channel_release_required" });
  });
});
