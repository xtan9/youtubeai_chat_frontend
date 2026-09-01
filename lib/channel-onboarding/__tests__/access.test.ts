import { describe, expect, it } from "vitest";

import {
  CHANNEL_ACTIONS,
  authorizeChannelAction,
  type ChannelAccessContext,
} from "../access";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const PRINCIPAL = {
  userId: "researcher-1",
  isAnonymous: false,
} as const;

const ATTESTATION = {
  attested: true,
  attestedAt: "2026-08-31T12:00:00.000Z",
  policyVersion: "channel-adult-v1",
} as const;

const CONNECTED_CHANNEL = {
  ownerId: PRINCIPAL.userId,
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  supportedCreator: true,
  status: "active" as const,
};

const WRITE_AUTHORIZATION = {
  grantId: CONNECTED_CHANNEL.grantId,
  granted: true,
  verified: true,
  scopes: ["youtube.force-ssl"],
} as const;

const GRANT = {
  ownerId: PRINCIPAL.userId,
  channelId: CONNECTED_CHANNEL.channelId,
  connectedChannelId: CONNECTED_CHANNEL.connectedChannelId,
  grantId: CONNECTED_CHANNEL.grantId,
  credentialReferenceId: "credential-reference-1",
  provider: "youtube" as const,
  scopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
  readScopeGranted: true,
  writeScopeGranted: true,
  status: "active" as const,
};

function context(
  overrides: Partial<ChannelAccessContext> = {},
): ChannelAccessContext {
  return {
    principal: PRINCIPAL,
    entitlement: { state: "active_pro", verified: true },
    persistenceAvailable: true,
    adultAttestation: ATTESTATION,
    connectedChannel: CONNECTED_CHANNEL,
    grant: GRANT,
    publishingAuthorization: WRITE_AUTHORIZATION,
    ...overrides,
  };
}

describe("authorizeChannelAction", () => {
  it("allows every new action only for a fully verified Channel Steward", () => {
    for (const action of CHANNEL_ACTIONS) {
      expect(authorizeChannelAction(action, context())).toEqual({
        allowed: true,
        action,
      });
    }
  });

  it("fails closed for every new action when the entitlement is Free", () => {
    for (const action of CHANNEL_ACTIONS) {
      expect(
        authorizeChannelAction(action, context({
          entitlement: { state: "free", verified: true },
        })),
      ).toEqual({
        allowed: false,
        action,
        reason: "active_pro_entitlement_required",
      });
    }
  });

  it("does not trust an unverified or unavailable entitlement as Pro", () => {
    expect(
      authorizeChannelAction(
        "connection",
        context({ entitlement: { state: "active_pro", verified: false } }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "active_pro_entitlement_required",
    });
    expect(
      authorizeChannelAction(
        "connection",
        context({ entitlement: { state: "unavailable", verified: false } }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "active_pro_entitlement_required",
    });
  });

  it("requires an authenticated non-anonymous identity before other checks", () => {
    expect(
      authorizeChannelAction(
        "connection",
        context({ principal: { userId: "", isAnonymous: false } }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "authenticated_identity_required",
    });
    expect(
      authorizeChannelAction(
        "connection",
        context({ principal: { userId: PRINCIPAL.userId, isAnonymous: true } }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "authenticated_identity_required",
    });
  });

  it("fails closed when persistence or adult attestation is unavailable", () => {
    for (const action of CHANNEL_ACTIONS) {
      expect(
        authorizeChannelAction(action, context({ persistenceAvailable: false })),
      ).toMatchObject({
        allowed: false,
        reason: "persistence_unavailable",
      });
      expect(
        authorizeChannelAction(action, context({ adultAttestation: null })),
      ).toMatchObject({
        allowed: false,
        reason: "adult_attestation_required",
      });
    }
  });

  it("requires a verified connected identity for work after connection", () => {
    expect(
      authorizeChannelAction("scan", context({ connectedChannel: null })),
    ).toEqual({
      allowed: false,
      action: "scan",
      reason: "connected_channel_identity_required",
    });
    expect(
      authorizeChannelAction(
        "review",
        context({
          connectedChannel: {
            ...CONNECTED_CHANNEL,
            ownerId: "another-researcher",
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "review",
      reason: "connected_channel_identity_mismatch",
    });
  });

  it("requires an active grant matching the account, Channel, and read scope for every subsequent action", () => {
    for (const action of ["scan", "review", "draft", "publication"] as const) {
      expect(
        authorizeChannelAction(action, context({ grant: null })),
      ).toMatchObject({
        allowed: false,
        reason: "connected_channel_grant_required",
      });
      expect(
        authorizeChannelAction(
          action,
          context({
            grant: { ...GRANT, connectedChannelId: "connected-other" },
          }),
        ),
      ).toMatchObject({
        allowed: false,
        reason: "connected_channel_grant_mismatch",
      });
      expect(
        authorizeChannelAction(
          action,
          context({
            grant: { ...GRANT, status: "revoked" },
          }),
        ),
      ).toMatchObject({
        allowed: false,
        reason: "connected_channel_grant_mismatch",
      });
      expect(
        authorizeChannelAction(
          action,
          context({
            grant: { ...GRANT, scopes: [], readScopeGranted: false },
          }),
        ),
      ).toMatchObject({
        allowed: false,
        reason: "connected_channel_grant_mismatch",
      });
    }
  });

  it("requires explicit verified write authorization for publication", () => {
    expect(
      authorizeChannelAction(
        "publication",
        context({ publishingAuthorization: null }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "publishing_authorization_required",
    });
    expect(
      authorizeChannelAction(
        "publication",
        context({
          publishingAuthorization: {
            ...WRITE_AUTHORIZATION,
            scopes: ["youtube.readonly"],
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "publishing_authorization_required",
    });
    expect(
      authorizeChannelAction(
        "publication",
        context({
          publishingAuthorization: {
            ...WRITE_AUTHORIZATION,
            grantId: "grant-from-another-channel",
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "publishing_authorization_mismatch",
    });
  });

  it("continues to allow a paid pending cancellation until access ends", () => {
    expect(
      authorizeChannelAction(
        "connection",
        context({
          entitlement: { state: "pro_pending_cancellation", verified: true },
        }),
      ),
    ).toEqual({ allowed: true, action: "connection" });
  });
});
