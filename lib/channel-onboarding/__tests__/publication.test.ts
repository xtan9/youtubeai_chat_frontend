import { describe, expect, it } from "vitest";

import type { ChannelAccessContext } from "../access";
import {
  authorizeChannelPublication,
  type ChannelPublicationPreflight,
} from "../publication";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const ACTIVE_CHANNEL = {
  ownerId: "researcher-1",
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  supportedCreator: true,
  status: "active" as const,
};

const CONTEXT: ChannelAccessContext = {
  principal: { userId: ACTIVE_CHANNEL.ownerId, isAnonymous: false },
  entitlement: { state: "active_pro", verified: true },
  persistenceAvailable: true,
  adultAttestation: {
    attested: true,
    attestedAt: "2026-08-31T12:00:00.000Z",
    policyVersion: "channel-adult-v1",
  },
  connectedChannel: ACTIVE_CHANNEL,
  grant: {
    ownerId: ACTIVE_CHANNEL.ownerId,
    channelId: ACTIVE_CHANNEL.channelId,
    connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
    grantId: ACTIVE_CHANNEL.grantId,
    credentialReferenceId: "credential-reference-1",
    provider: "youtube",
    scopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
    readScopeGranted: true,
    writeScopeGranted: true,
    status: "active",
  },
  publishingAuthorization: {
    grantId: ACTIVE_CHANNEL.grantId,
    granted: true,
    verified: true,
    scopes: ["youtube.force-ssl"],
  },
};

const WORK = {
  ownerId: ACTIVE_CHANNEL.ownerId,
  channelId: ACTIVE_CHANNEL.channelId,
  connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
  grantId: ACTIVE_CHANNEL.grantId,
  commentId: "comment-1",
  commentHash: "hash-current",
} as const;

function preflight(
  overrides: Partial<ChannelPublicationPreflight> = {},
): ChannelPublicationPreflight {
  return {
    access: CONTEXT,
    activeConnectedChannel: ACTIVE_CHANNEL,
    work: WORK,
    currentComment: {
      commentId: WORK.commentId,
      commentHash: WORK.commentHash,
    },
    finalTextValidated: true,
    remainingDailyPublications: 10,
    exclusiveItemClaimed: true,
    ...overrides,
  };
}

describe("authorizeChannelPublication", () => {
  it("allows a write only when active identity and every publication precondition match", () => {
    expect(authorizeChannelPublication(preflight())).toEqual({
      allowed: true,
      action: "publication",
    });
  });

  it("makes work from another Connected Channel non-publishable after a switch", () => {
    expect(
      authorizeChannelPublication(
        preflight({
          activeConnectedChannel: {
            ...ACTIVE_CHANNEL,
            channelId: "channel-2",
            connectedChannelId: "connected-2",
            grantId: "grant-2",
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "active_connected_channel_mismatch",
    });
  });

  it("rejects a work item whose grant does not match the active identity", () => {
    expect(
      authorizeChannelPublication(
        preflight({
          work: { ...WORK, grantId: "grant-other" },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "active_connected_channel_mismatch",
    });
  });

  it("revalidates current comment provenance before the one external write", () => {
    expect(
      authorizeChannelPublication(
        preflight({
          currentComment: {
            commentId: WORK.commentId,
            commentHash: "hash-changed",
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "current_comment_changed",
    });
    expect(
      authorizeChannelPublication(preflight({ currentComment: null })),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "current_comment_unavailable",
    });
  });

  it("fails closed for unvalidated text, exhausted allowance, or an unclaimed item", () => {
    expect(
      authorizeChannelPublication(
        preflight({ finalTextValidated: false }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "final_text_not_validated",
    });
    expect(
      authorizeChannelPublication(
        preflight({ remainingDailyPublications: 0 }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "publication_allowance_unavailable",
    });
    expect(
      authorizeChannelPublication(
        preflight({ exclusiveItemClaimed: false }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "exclusive_item_claim_required",
    });
  });

  it("does not let a Free or stale write grant reach publication", () => {
    expect(
      authorizeChannelPublication(
        preflight({
          access: {
            ...CONTEXT,
            publishingAuthorization: null,
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "publishing_authorization_required",
    });
    expect(
      authorizeChannelPublication(
        preflight({
          access: {
            ...CONTEXT,
            entitlement: { state: "free", verified: true },
          },
        }),
      ),
    ).toMatchObject({
      allowed: false,
      reason: "active_pro_entitlement_required",
    });
    expect(
      authorizeChannelPublication(
        preflight({
          access: {
            ...CONTEXT,
            publishingAuthorization: {
              ...CONTEXT.publishingAuthorization!,
              grantId: "grant-old",
            },
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      action: "publication",
      reason: "publishing_authorization_mismatch",
    });
  });
});
