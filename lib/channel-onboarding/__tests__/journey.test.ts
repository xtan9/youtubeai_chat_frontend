import { describe, expect, it, vi } from "vitest";

import { type ChannelAccessContext } from "../access";
import {
  beginChannelOnboarding,
  completeChannelOnboarding,
  planChannelOnboardingAuthorization,
  type ChannelConnectionPersistence,
} from "../journey";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const NOW = "2026-08-31T12:00:00.000Z";
const OWNER_ID = "researcher-1";

const IDENTITY = {
  provider: "youtube" as const,
  providerSubject: "google-subject-1",
  providerChannelId: "UC_verified",
  displayName: "Verified creator channel",
  mine: true as const,
  ownership: "account_owned" as const,
  authorization: "direct_owner" as const,
  visibility: "public" as const,
  persona: "creator" as const,
};

const GATES = {
  complianceClearance: {
    recordType:
      "youtube-channel-comment-assistance-compliance-clearance" as const,
    recordVersion: 1 as const,
    issueNumber: 470 as const,
    sourceSpec: {
      path: "docs/specs/2026-08-31-comment-assistance-discovery.md" as const,
      url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
    },
    decision: "permitted" as const,
    packet: {
      issueNumber: 469 as const,
      status: "reviewed" as const,
      artifactPath:
        "docs/compliance/youtube-channel-comment-assistance-audit-packet.md",
      revision: "reviewed-packet-revision",
      reviewedAt: "2026-09-01",
      reviewedBy: "external reviewer",
    },
    determination: {
      responseDate: "2026-09-01",
      reviewerOrAuthority: "YouTube API Compliance Audit authority",
      applicablePolicies: ["YouTube API Services Developer Policies"],
      permittedScope: "The approved Channel use case.",
      prohibitedScope: "Unapproved uses.",
      sourceReference: "evidence://youtube-clearance",
      verbatimResponse: "The written determination is preserved externally.",
    },
    coverage: {
      customPerCommentBehavioralAssessment: true as const,
      modelProviderFlow: true as const,
      retentionApproach: true as const,
    },
    conditions: [],
  },
  oauthVerification: {
    recordType: "youtube-channel-oauth-verification" as const,
    recordVersion: 1 as const,
    provider: "youtube" as const,
    status: "verified" as const,
    verificationReference: "evidence://youtube-oauth-verification",
    verifiedAt: NOW,
    verifiedBy: "external OAuth reviewer",
    approvedScopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
  },
} as const;

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
  credentialReferenceId: "credential-reference-1",
} as const;

const READ_AUTHORIZATION = {
  status: "completed" as const,
  readScopeGranted: true,
  scopes: [YOUTUBE_READONLY_SCOPE] as const,
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
    gates: GATES,
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
    expect(beginChannelOnboarding(ACCESS, GATES)).toEqual({
      kind: "awaiting_read_authorization",
    });
    expect(beginChannelOnboarding(ACCESS)).toEqual({
      kind: "blocked",
      reason: "compliance_clearance_required",
    });
  });

  it("binds the onboarding authorization request to the read-only scope", () => {
    expect(
      planChannelOnboardingAuthorization({
        access: ACCESS,
        gates: GATES,
        userInitiated: true,
      }),
    ).toEqual({
      kind: "authorization_required",
      action: "connect",
      scopes: [YOUTUBE_READONLY_SCOPE],
    });
    expect(
      planChannelOnboardingAuthorization({
        access: ACCESS,
        gates: GATES,
        userInitiated: false,
      }),
    ).toEqual({
      kind: "blocked",
      reason: "explicit_user_action_required",
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
        credentialReferenceId: IDS.credentialReferenceId,
        oauthScopes: [YOUTUBE_READONLY_SCOPE],
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
          scopes: [],
        },
      }),
    );

    expect(result).toEqual({
      kind: "interrupted",
      reason: "read_authorization_incomplete",
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a completed authorization that contains anything beyond youtube.readonly", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({
        persistence: adapter,
        readAuthorization: {
          status: "completed",
          readScopeGranted: true,
          scopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
        },
      }),
    );

    expect(result).toEqual({ kind: "blocked", reason: "read_scope_mismatch" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps the real onboarding contract blocked while compliance evidence is pending", async () => {
    const { adapter, commit } = persistence();

    const result = await completeChannelOnboarding(
      input({
        gates: {
          ...GATES,
          complianceClearance: {
            ...GATES.complianceClearance,
            decision: "pending_external_determination" as const,
            packet: {
              issueNumber: 469 as const,
              status: "not_available" as const,
              reason: "No reviewed packet is available.",
            },
            determination: null,
          },
        },
        persistence: adapter,
      }),
    );

    expect(result).toEqual({
      kind: "blocked",
      reason: "compliance_clearance_required",
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
