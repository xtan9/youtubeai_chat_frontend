import { describe, expect, it, vi } from "vitest";

import {
  createYouTubePublicReplyProvider,
  evaluateYouTubeExternalActionGate,
  planYouTubeAuthorization,
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../youtube-write";

const TEST_ONLY_GATE = {
  compliance: {
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
      revision: "test-only-reviewed-packet",
      reviewedAt: "2026-08-31",
      reviewedBy: "test-only reviewer",
    },
    determination: {
      responseDate: "2026-08-31",
      reviewerOrAuthority: "test-only authority",
      applicablePolicies: ["test-only policy"],
      permittedScope: "test-only scope",
      prohibitedScope: "test-only prohibited scope",
      sourceReference: "test-only-evidence",
      verbatimResponse: "test-only response",
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
    verificationReference: "test-only-oauth-evidence",
    verifiedAt: "2026-08-31T12:00:00.000Z",
    verifiedBy: "test-only reviewer",
    approvedScopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
  },
  privacyDisclosure: {
    status: "verified" as const,
    disclosureRef: "test-only-privacy-disclosure",
    verifiedAt: "2026-08-31T12:00:00.000Z",
  },
  credentials: {
    status: "available" as const,
    credentialReferenceId: "test-only-credential-reference",
  },
  creatorConsent: {
    status: "confirmed" as const,
    consentRef: "test-only-creator-consent",
    confirmedAt: "2026-08-31T12:00:00.000Z",
  },
  quotaEvidence: {
    status: "verified" as const,
    evidenceRef: "test-only-quota-evidence",
    verifiedAt: "2026-08-31T12:00:00.000Z",
    dailyPublicationLimit: 10 as const,
    insertQuotaCost: 50 as const,
  },
  transport: {
    status: "available" as const,
    adapterRef: "test-only-transport",
  },
};

describe("YouTube write boundary", () => {
  it("requests only read identity scope during onboarding", () => {
    expect(
      planYouTubeAuthorization({
        action: "connect",
        userInitiated: true,
      }),
    ).toEqual({
      kind: "authorization_required",
      action: "connect",
      scopes: [YOUTUBE_READONLY_SCOPE],
    });
    const plan = planYouTubeAuthorization({
      action: "connect",
      userInitiated: true,
    });
    if (plan.kind === "authorization_required") {
      expect(plan.scopes).not.toContain(YOUTUBE_FORCE_SSL_SCOPE);
    }
  });

  it("requests write scope only for the first explicit write action", () => {
    expect(
      planYouTubeAuthorization({
        action: "first_publication",
        userInitiated: true,
        existingScopes: [YOUTUBE_READONLY_SCOPE],
      }),
    ).toEqual({
      kind: "authorization_required",
      action: "first_publication",
      scopes: [YOUTUBE_FORCE_SSL_SCOPE],
    });

    expect(
      planYouTubeAuthorization({
        action: "first_publication",
        userInitiated: false,
        existingScopes: [YOUTUBE_READONLY_SCOPE],
      }),
    ).toEqual({
      kind: "blocked",
      reason: "explicit_user_action_required",
    });

    expect(
      planYouTubeAuthorization({
        action: "first_publication",
        userInitiated: true,
        existingScopes: [YOUTUBE_FORCE_SSL_SCOPE],
      }),
    ).toEqual({
      kind: "authorization_required",
      action: "first_publication",
      scopes: [YOUTUBE_FORCE_SSL_SCOPE],
    });
  });

  it("does not treat missing launch evidence as a usable external gate", () => {
    const gate = evaluateYouTubeExternalActionGate(null);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.reasons).toEqual([
      "written_compliance_clearance_required",
      "oauth_verification_required",
      "live_privacy_disclosure_required",
      "credentials_unavailable",
      "creator_consent_required",
      "quota_evidence_required",
      "transport_unavailable",
    ]);
  });

  it("keeps a blocked provider from calling its injected transport", async () => {
    const transport = {
      insertPublicReply: vi.fn(),
      observePublicReply: vi.fn(),
      deletePublicReply: vi.fn(),
    };
    const provider = createYouTubePublicReplyProvider({
      transport,
      resolveGate: () => null,
    });

    expect(provider.isAvailable("publish")).toBe(false);
    expect(provider.isAvailable("reconcile")).toBe(false);
    expect(provider.isAvailable("open")).toBe(false);
    expect(provider.isAvailable("delete")).toBe(false);
    expect(transport.insertPublicReply).not.toHaveBeenCalled();
  });

  it("fails closed when launch evidence resolution itself throws", async () => {
    const transport = {
      insertPublicReply: vi.fn(),
      observePublicReply: vi.fn(),
      deletePublicReply: vi.fn(),
    };
    const provider = createYouTubePublicReplyProvider({
      transport,
      resolveGate: () => {
        throw new Error("evidence unavailable");
      },
    });

    expect(provider.isAvailable("publish")).toBe(false);
    await expect(
      provider.insert?.({
        controlId: "control-1",
        ownerId: "researcher-1",
        channelId: "channel-1",
        connectedChannelId: "connected-1",
        grantId: "grant-1",
        providerReplyId: null,
        commentId: "comment-1",
        parentCommentId: "comment-1",
        videoId: "video-1",
        text: "reply",
      }),
    ).resolves.toMatchObject({ kind: "ambiguous" });
    expect(transport.insertPublicReply).not.toHaveBeenCalled();
  });

  it("passes only the canonical provider request to a test transport after an explicit gate", async () => {
    const transport = {
      insertPublicReply: vi.fn().mockResolvedValue({
        kind: "accepted",
        reply: {
          replyId: "reply-1",
          commentId: "comment-1",
          parentCommentId: "comment-1",
          videoId: "video-1",
          text: "We can disagree without personal attacks.",
          updatedAt: "2026-08-31T12:00:00.000Z",
        },
      }),
      observePublicReply: vi.fn(),
      deletePublicReply: vi.fn(),
    };
    const provider = createYouTubePublicReplyProvider({
      transport,
      resolveGate: () => TEST_ONLY_GATE,
    });

    expect(provider.isAvailable("publish")).toBe(true);
    if (!provider.insert) throw new Error("provider insert is unavailable");
    const result = await provider.insert({
      controlId: "control-1",
      ownerId: "researcher-1",
      channelId: "channel-1",
      connectedChannelId: "connected-1",
      grantId: "grant-1",
      providerReplyId: null,
      commentId: "comment-1",
      parentCommentId: "comment-1",
      videoId: "video-1",
      text: "We can disagree without personal attacks.",
    });

    expect(result).toMatchObject({ kind: "accepted" });
    expect(transport.insertPublicReply).toHaveBeenCalledTimes(1);
    expect(transport.insertPublicReply).toHaveBeenCalledWith(
      expect.objectContaining({
        controlId: "control-1",
        grantId: "grant-1",
        text: "We can disagree without personal attacks.",
      }),
    );
  });
});
