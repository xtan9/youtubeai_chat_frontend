import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  beginSupportedCreatorChannelOAuth,
  completeSupportedCreatorChannelOAuth,
  validateChannelOAuthCallbackState,
  type ChannelOAuthStateStore,
} from "../oauth";
import { CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE } from "@/lib/compliance/youtube-channel-clearance";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const NOW = "2026-09-01T12:00:00.000Z";
const OWNER_ID = "researcher-1";

const VERIFIED_COMPLIANCE = {
  recordType: "youtube-channel-comment-assistance-compliance-clearance",
  recordVersion: 1,
  issueNumber: 470,
  sourceSpec: {
    path: "docs/specs/2026-08-31-comment-assistance-discovery.md",
    url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
  },
  decision: "permitted" as const,
  packet: {
    issueNumber: 469,
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
    customPerCommentBehavioralAssessment: true,
    modelProviderFlow: true,
    retentionApproach: true,
  },
  conditions: [],
} as const;

const VERIFIED_OAUTH = {
  recordType: "youtube-channel-oauth-verification",
  recordVersion: 1,
  provider: "youtube" as const,
  status: "verified" as const,
  verificationReference: "evidence://youtube-oauth-verification",
  verifiedAt: NOW,
  verifiedBy: "external OAuth reviewer",
  approvedScopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
} as const;

const ACCESS = {
  principal: { userId: OWNER_ID, isAnonymous: false },
  entitlement: { state: "active_pro" as const, verified: true },
  persistenceAvailable: true,
  adultAttestation: {
    attested: true,
    attestedAt: NOW,
    policyVersion: "channel-adult-v1",
  },
};

const STATE = {
  state: "oauth-state-value-that-is-long-enough",
  provider: "youtube" as const,
  purpose: "connect_supported_creator_channel" as const,
  ownerId: OWNER_ID,
  scopes: [YOUTUBE_READONLY_SCOPE] as const,
  issuedAt: NOW,
  expiresAt: "2026-09-01T12:10:00.000Z",
};

const PROVIDER_IDENTITY = {
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

const TOKEN_SET = {
  accessToken: "access-token-test-only",
  refreshToken: "refresh-token-test-only",
  scopes: [YOUTUBE_READONLY_SCOPE] as const,
  expiresAt: "2026-09-01T13:00:00.000Z",
};

const ENCRYPTED_TOKEN_ENVELOPE = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  keyVersion: "test-key-v1",
  iv: "AAAAAAAAAAAAAAAA",
  ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
  authTag: "AAAAAAAAAAAAAAAAAAAAAA",
};

const CREDENTIAL_REFERENCE = {
  id: "credential-reference-1",
  provider: "youtube" as const,
  ownerId: OWNER_ID,
  grantId: "grant-1",
  storage: "encrypted" as const,
  keyVersion: "test-key-v1",
  algorithm: "aes-256-gcm" as const,
};

const ONBOARDING_IDS = {
  channelId: "channel-1",
  grantId: "grant-1",
  connectedChannelId: "connected-1",
} as const;

function stateStore(issue = vi.fn().mockResolvedValue(STATE)):
  ChannelOAuthStateStore & { issue: ReturnType<typeof vi.fn> } {
  return {
    issue,
    consume: vi.fn(),
  };
}

describe("Supported Creator Channel OAuth start", () => {
  it("requests only youtube.readonly after every external gate is explicitly open", async () => {
    const store = stateStore();

    const result = await beginSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      stateStore: store,
      now: () => new Date(NOW),
      randomState: () => STATE.state,
    });

    expect(result).toEqual({
      kind: "ready",
      request: {
        provider: "youtube",
        scopes: [YOUTUBE_READONLY_SCOPE],
        state: STATE.state,
      },
      expiresAt: STATE.expiresAt,
    });
    if (result.kind !== "ready") throw new Error("expected OAuth readiness");
    expect(store.issue).toHaveBeenCalledWith({
      state: STATE.state,
      provider: "youtube",
      purpose: "connect_supported_creator_channel",
      ownerId: OWNER_ID,
      scopes: [YOUTUBE_READONLY_SCOPE],
      issuedAt: NOW,
      expiresAt: STATE.expiresAt,
    });
    expect(result.request.scopes).not.toContain(YOUTUBE_FORCE_SSL_SCOPE);
  });

  it("keeps the checked-in pending compliance record from creating OAuth state", async () => {
    const store = stateStore();

    const result = await beginSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      stateStore: store,
      now: () => new Date(NOW),
    });

    expect(result).toEqual({
      kind: "blocked",
      reason: "compliance_clearance_required",
    });
    expect(store.issue).not.toHaveBeenCalled();
  });

  it("keeps an unverified OAuth application from creating OAuth state", async () => {
    const store = stateStore();

    const result = await beginSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: {
          recordType: "youtube-channel-oauth-verification",
          recordVersion: 1,
          provider: "youtube",
          status: "pending_external_verification",
          reason: "OAuth verification is not evidenced.",
        },
      },
      stateStore: store,
      now: () => new Date(NOW),
    });

    expect(result).toEqual({
      kind: "blocked",
      reason: "oauth_verification_required",
    });
    expect(store.issue).not.toHaveBeenCalled();
  });

  it.each([
    ["a Free account", { entitlement: { state: "free", verified: true } }],
    ["an account without an adult attestation", { adultAttestation: null }],
  ] as const)("does not let %s create OAuth state", async (_label, access) => {
    const store = stateStore();

    const result = await beginSupportedCreatorChannelOAuth({
      access: { ...ACCESS, ...access },
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      stateStore: store,
      now: () => new Date(NOW),
      randomState: () => STATE.state,
    });

    expect(result.kind).toBe("blocked");
    expect(store.issue).not.toHaveBeenCalled();
  });
});

describe("Supported Creator Channel OAuth callback state", () => {
  it("accepts only the stored, unexpired state bound to the authenticated account", () => {
    expect(
      validateChannelOAuthCallbackState({
        storedState: STATE,
        callbackState: STATE.state,
        principal: { userId: OWNER_ID, isAnonymous: false },
        now: new Date("2026-09-01T12:05:00.000Z"),
      }),
    ).toEqual({ kind: "valid", state: STATE });
  });

  it.each([
    ["a mismatched state", { callbackState: "another-state-value-that-is-long-enough" }, "state_mismatch"],
    [
      "an expired state",
      { now: new Date("2026-09-01T12:10:00.000Z") },
      "state_expired",
    ],
    [
      "an unauthenticated callback",
      { principal: null },
      "state_account_mismatch",
    ],
  ] as const)("rejects %s", (_label, overrides, reason) => {
    expect(
      validateChannelOAuthCallbackState({
        storedState: STATE,
        callbackState: STATE.state,
        principal: { userId: OWNER_ID, isAnonymous: false },
        now: new Date("2026-09-01T12:05:00.000Z"),
        ...overrides,
      }),
    ).toEqual({ kind: "blocked", reason });
  });
});

describe("Supported Creator Channel OAuth callback", () => {
  it("commits one token-free, verified connection after the read-only grant is encrypted", async () => {
    const consume = vi.fn().mockResolvedValue(STATE);
    const exchangeAuthorizationCode = vi.fn().mockResolvedValue(TOKEN_SET);
    const listOwnedChannelIdentities = vi
      .fn()
      .mockResolvedValue([PROVIDER_IDENTITY]);
    const encrypt = vi.fn().mockResolvedValue(ENCRYPTED_TOKEN_ENVELOPE);
    const storeEncrypted = vi
      .fn()
      .mockResolvedValue(CREDENTIAL_REFERENCE);
    const remove = vi.fn().mockResolvedValue(undefined);
    const commitConnectionAtomically = vi
      .fn()
      .mockResolvedValue(undefined);

    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, code: "authorization-code" },
      stateStore: { issue: vi.fn(), consume },
      provider: {
        exchangeAuthorizationCode,
        listOwnedChannelIdentities,
      },
      tokenEncryptor: { encrypt },
      credentialStore: { storeEncrypted, remove },
      ids: ONBOARDING_IDS,
      persistence: { commitConnectionAtomically },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "connected",
      connection: {
        grant: {
          credentialReferenceId: CREDENTIAL_REFERENCE.id,
          readScopeGranted: true,
          writeScopeGranted: false,
          oauthScopes: [YOUTUBE_READONLY_SCOPE],
        },
      },
    });
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: "authorization-code",
      expectedScopes: [YOUTUBE_READONLY_SCOPE],
    });
    expect(listOwnedChannelIdentities).toHaveBeenCalledWith({
      accessToken: TOKEN_SET.accessToken,
      mine: true,
    });
    expect(encrypt).toHaveBeenCalledWith(TOKEN_SET);
    expect(storeEncrypted).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      grantId: ONBOARDING_IDS.grantId,
      envelope: ENCRYPTED_TOKEN_ENVELOPE,
    });
    expect(commitConnectionAtomically).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN_SET.accessToken);
    expect(JSON.stringify(result)).not.toContain(TOKEN_SET.refreshToken);
    expect(JSON.stringify(commitConnectionAtomically.mock.calls[0]?.[0])).not.toContain(
      TOKEN_SET.accessToken,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not call the provider for a callback whose state was not stored", async () => {
    const exchangeAuthorizationCode = vi.fn();
    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, code: "authorization-code" },
      stateStore: {
        issue: vi.fn(),
        consume: vi.fn().mockResolvedValue(null),
      },
      provider: {
        exchangeAuthorizationCode,
        listOwnedChannelIdentities: vi.fn(),
      },
      tokenEncryptor: { encrypt: vi.fn() },
      credentialStore: { storeEncrypted: vi.fn(), remove: vi.fn() },
      ids: ONBOARDING_IDS,
      persistence: { commitConnectionAtomically: vi.fn() },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toEqual({ kind: "blocked", reason: "invalid_state" });
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("treats a denied OAuth callback as interrupted without creating a connection", async () => {
    const exchangeAuthorizationCode = vi.fn();
    const commitConnectionAtomically = vi.fn();

    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, error: "access_denied" },
      stateStore: {
        issue: vi.fn(),
        consume: vi.fn().mockResolvedValue(STATE),
      },
      provider: {
        exchangeAuthorizationCode,
        listOwnedChannelIdentities: vi.fn(),
      },
      tokenEncryptor: { encrypt: vi.fn() },
      credentialStore: { storeEncrypted: vi.fn(), remove: vi.fn() },
      ids: ONBOARDING_IDS,
      persistence: { commitConnectionAtomically },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toEqual({
      kind: "interrupted",
      reason: "oauth_authorization_denied",
    });
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(commitConnectionAtomically).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", [], "no_provider_identity"],
    [
      "multiple",
      [PROVIDER_IDENTITY, { ...PROVIDER_IDENTITY, providerChannelId: "UC_other" }],
      "multiple_provider_identities",
    ],
  ] as const)(
    "does not persist when the provider returns %s owned identities",
    async (_label, identities, reason) => {
      const encrypt = vi.fn();
      const storeEncrypted = vi.fn();
      const commitConnectionAtomically = vi.fn();

      const result = await completeSupportedCreatorChannelOAuth({
        access: ACCESS,
        gates: {
          complianceClearance: VERIFIED_COMPLIANCE,
          oauthVerification: VERIFIED_OAUTH,
        },
        callback: { state: STATE.state, code: "authorization-code" },
        stateStore: {
          issue: vi.fn(),
          consume: vi.fn().mockResolvedValue(STATE),
        },
        provider: {
          exchangeAuthorizationCode: vi.fn().mockResolvedValue(TOKEN_SET),
          listOwnedChannelIdentities: vi.fn().mockResolvedValue(identities),
        },
        tokenEncryptor: { encrypt },
        credentialStore: { storeEncrypted, remove: vi.fn() },
        ids: ONBOARDING_IDS,
        persistence: { commitConnectionAtomically },
        now: () => new Date("2026-09-01T12:05:00.000Z"),
      });

      expect(result).toEqual({ kind: "blocked", reason });
      expect(encrypt).not.toHaveBeenCalled();
      expect(storeEncrypted).not.toHaveBeenCalled();
      expect(commitConnectionAtomically).not.toHaveBeenCalled();
    },
  );

  it("rejects multi-host organizations with native YouTube guidance", async () => {
    const identity = {
      ...PROVIDER_IDENTITY,
      ownership: "multi_host_organization" as const,
    };

    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, code: "authorization-code" },
      stateStore: {
        issue: vi.fn(),
        consume: vi.fn().mockResolvedValue(STATE),
      },
      provider: {
        exchangeAuthorizationCode: vi.fn().mockResolvedValue(TOKEN_SET),
        listOwnedChannelIdentities: vi.fn().mockResolvedValue([identity]),
      },
      tokenEncryptor: { encrypt: vi.fn() },
      credentialStore: { storeEncrypted: vi.fn(), remove: vi.fn() },
      ids: ONBOARDING_IDS,
      persistence: { commitConnectionAtomically: vi.fn() },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toEqual({
      kind: "blocked",
      reason: "multi_host_organization_not_supported",
      guidance:
        "This Channel type is not supported here; use native YouTube tools for multi-host organizations or delegated Studio permissions.",
    });
  });

  it("rejects an exchange that grants more than the read-only scope", async () => {
    const listOwnedChannelIdentities = vi.fn();
    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, code: "authorization-code" },
      stateStore: {
        issue: vi.fn(),
        consume: vi.fn().mockResolvedValue(STATE),
      },
      provider: {
        exchangeAuthorizationCode: vi.fn().mockResolvedValue({
          ...TOKEN_SET,
          scopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
        }),
        listOwnedChannelIdentities,
      },
      tokenEncryptor: { encrypt: vi.fn() },
      credentialStore: { storeEncrypted: vi.fn(), remove: vi.fn() },
      ids: ONBOARDING_IDS,
      persistence: { commitConnectionAtomically: vi.fn() },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toEqual({ kind: "blocked", reason: "read_scope_mismatch" });
    expect(listOwnedChannelIdentities).not.toHaveBeenCalled();
  });

  it("removes the encrypted credential reference when the atomic connection commit fails", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, code: "authorization-code" },
      stateStore: {
        issue: vi.fn(),
        consume: vi.fn().mockResolvedValue(STATE),
      },
      provider: {
        exchangeAuthorizationCode: vi.fn().mockResolvedValue(TOKEN_SET),
        listOwnedChannelIdentities: vi.fn().mockResolvedValue([
          PROVIDER_IDENTITY,
        ]),
      },
      tokenEncryptor: {
        encrypt: vi.fn().mockResolvedValue(ENCRYPTED_TOKEN_ENVELOPE),
      },
      credentialStore: {
        storeEncrypted: vi.fn().mockResolvedValue(CREDENTIAL_REFERENCE),
        remove,
      },
      ids: ONBOARDING_IDS,
      persistence: {
        commitConnectionAtomically: vi
          .fn()
          .mockRejectedValue(new Error("database unavailable")),
      },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toEqual({ kind: "blocked", reason: "persistence_write_failed" });
    expect(remove).toHaveBeenCalledWith(CREDENTIAL_REFERENCE);
  });

  it("rejects a credential reference returned for another account or grant", async () => {
    const commitConnectionAtomically = vi.fn();
    const result = await completeSupportedCreatorChannelOAuth({
      access: ACCESS,
      gates: {
        complianceClearance: VERIFIED_COMPLIANCE,
        oauthVerification: VERIFIED_OAUTH,
      },
      callback: { state: STATE.state, code: "authorization-code" },
      stateStore: {
        issue: vi.fn(),
        consume: vi.fn().mockResolvedValue(STATE),
      },
      provider: {
        exchangeAuthorizationCode: vi.fn().mockResolvedValue(TOKEN_SET),
        listOwnedChannelIdentities: vi.fn().mockResolvedValue([
          PROVIDER_IDENTITY,
        ]),
      },
      tokenEncryptor: {
        encrypt: vi.fn().mockResolvedValue(ENCRYPTED_TOKEN_ENVELOPE),
      },
      credentialStore: {
        storeEncrypted: vi.fn().mockResolvedValue({
          ...CREDENTIAL_REFERENCE,
          ownerId: "another-researcher",
        }),
        remove: vi.fn(),
      },
      ids: ONBOARDING_IDS,
      persistence: { commitConnectionAtomically },
      now: () => new Date("2026-09-01T12:05:00.000Z"),
    });

    expect(result).toEqual({ kind: "blocked", reason: "credential_store_failed" });
    expect(commitConnectionAtomically).not.toHaveBeenCalled();
  });
});
