import { describe, expect, it, vi } from "vitest";

import {
  buildPublicReplyPublicationConfirmation,
  createInMemoryPublicReplyLifecycleStore,
  deletePublicReply,
  hashCommentText,
  openPublishedPublicReply,
  publishPublicReply,
  reconcilePublicReply,
  type ChannelPublicationPreflight,
  type PublicReplyControlRecord,
} from "../publication";
import {
  createYouTubePublicReplyProvider,
  type YouTubeExternalActionGateInput,
} from "../youtube-write";
import type { ChannelAssessmentDecision } from "../../channel/safety";
import type { ChannelLifecycleRecord } from "../../channel/lifecycle";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const OWNER_ID = "researcher-1";
const COMMENT_TEXT = "You are an idiot.";
const FINAL_TEXT = "We can disagree without personal attacks.";
const COMMENT_HASH = hashCommentText(COMMENT_TEXT);

const ACTIVE_CHANNEL = {
  ownerId: OWNER_ID,
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  supportedCreator: true,
  status: "active" as const,
};

const ACCESS = {
  principal: { userId: OWNER_ID, isAnonymous: false },
  entitlement: { state: "active_pro" as const, verified: true },
  persistenceAvailable: true,
  adultAttestation: {
    attested: true,
    attestedAt: NOW.toISOString(),
    policyVersion: "channel-adult-v1",
  },
  connectedChannel: ACTIVE_CHANNEL,
  grant: {
    ownerId: OWNER_ID,
    channelId: ACTIVE_CHANNEL.channelId,
    connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
    grantId: ACTIVE_CHANNEL.grantId,
    credentialReferenceId: "credential-reference-1",
    provider: "youtube" as const,
    scopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
    readScopeGranted: true,
    writeScopeGranted: true,
    status: "active" as const,
  },
  publishingAuthorization: {
    grantId: ACTIVE_CHANNEL.grantId,
    granted: true,
    verified: true,
    scopes: ["youtube.force-ssl"],
  },
};

const WORK = {
  ownerId: OWNER_ID,
  channelId: ACTIVE_CHANNEL.channelId,
  connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
  grantId: ACTIVE_CHANNEL.grantId,
  commentId: "comment-1",
  commentHash: COMMENT_HASH,
} as const;

const SAFE_ASSESSMENT = {
  classification: "Actionable Abuse",
  target: "channel_steward",
  severity: "non_severe",
  safetyReasons: [],
  replyDraft: null,
  replyDraftAllowed: true,
} satisfies ChannelAssessmentDecision;

const REVIEW_DECISION = {
  schemaVersion: "review-decision-v1",
  decisionId: "decision-1",
  action: "confirm_actionable_abuse",
  stateChanged: true,
  actorRole: "channel_steward",
  stewardId: OWNER_ID,
  assessmentId: "assessment-1",
  interactionId: "interaction-1",
  commentId: WORK.commentId,
  channelId: WORK.channelId,
  connectedChannelId: WORK.connectedChannelId,
  commentTextHash: COMMENT_HASH,
  from: {
    classification: "reviewable_interaction",
    status: "reviewable",
    deferredUntil: null,
  },
  to: {
    classification: "actionable_abuse",
    status: "actionable",
    deferredUntil: null,
  },
  assessmentVersion: "interaction-assessment-v1",
  taxonomyVersion: "channel-comment-taxonomy-v1",
  validatorVersion: "review-decision-validator-v1",
  recordedAt: NOW.toISOString(),
  expiresAt: "2026-09-15T12:00:00.000Z",
};

const GOVERNANCE = {
  reviewDecision: REVIEW_DECISION,
  safetyAssessment: SAFE_ASSESSMENT,
  sourceCommentHash: COMMENT_HASH,
  finalText: FINAL_TEXT,
  confirmation: {
    confirmed: true,
    confirmedAt: NOW.toISOString(),
    actorRole: "channel_steward" as const,
  },
};

const PUBLISHING_IDENTITY = {
  provider: "youtube" as const,
  connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
  grantId: ACTIVE_CHANNEL.grantId,
  providerChannelId: "UC-creator-1",
  displayName: "Verified Creator",
};

const ACTIVE_LIFECYCLE: ChannelLifecycleRecord = {
  ownerId: OWNER_ID,
  channelId: ACTIVE_CHANNEL.channelId,
  connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
  grantId: ACTIVE_CHANNEL.grantId,
  state: "active",
  graceStartedAt: null,
  graceEndsAt: null,
  grantStatus: "active",
  provenanceStatus: "active",
  provenanceRefreshedAt: null,
  localDataStatus: "retained",
};

const GRACE_LIFECYCLE: ChannelLifecycleRecord = {
  ...ACTIVE_LIFECYCLE,
  state: "read_only_grace",
  graceStartedAt: "2026-08-25T12:00:00.000Z",
  graceEndsAt: "2026-09-01T12:00:00.000Z",
  provenanceRefreshedAt: NOW.toISOString(),
};

const PROVIDER_REPLY = {
  replyId: "reply-1",
  commentId: WORK.commentId,
  parentCommentId: WORK.commentId,
  videoId: "video-1",
  text: FINAL_TEXT,
  updatedAt: NOW.toISOString(),
};

function record(
  overrides: Partial<PublicReplyControlRecord> = {},
): PublicReplyControlRecord {
  return {
    id: "reply-control-1",
    ownerId: OWNER_ID,
    channelId: ACTIVE_CHANNEL.channelId,
    connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
    grantId: ACTIVE_CHANNEL.grantId,
    work: WORK,
    source: {
      commentId: WORK.commentId,
      commentText: COMMENT_TEXT,
      commentHash: WORK.commentHash,
      video: {
        id: "video-1",
        title: "Creator Video",
        uploadingChannel: "Verified Creator",
      },
      target: { kind: "top_level" },
    },
    finalText: FINAL_TEXT,
    revision: 0,
    status: "draft_ready",
    providerReplyId: null,
    publishedText: null,
    publishedAt: null,
    lastObservedText: null,
    lastObservedTextHash: null,
    lastObservedAt: null,
    externallyEdited: false,
    publicationFailure: null,
    publicationRetryAuthorizedBy: null,
    deletionStatus: "not_requested",
    deletionRequestedAt: null,
    deletionCompletedAt: null,
    deletionFailure: null,
    ...overrides,
  };
}

function preflight(): ChannelPublicationPreflight {
  return {
    access: ACCESS,
    activeConnectedChannel: ACTIVE_CHANNEL,
    work: WORK,
    currentComment: {
      commentId: WORK.commentId,
      commentHash: WORK.commentHash,
    },
    finalTextValidated: true,
    remainingDailyPublications: 10,
    exclusiveItemClaimed: true,
  };
}

function gate(): YouTubeExternalActionGateInput {
  return {
    compliance: {
      recordType:
        "youtube-channel-comment-assistance-compliance-clearance",
      recordVersion: 1,
      issueNumber: 470,
      sourceSpec: {
        path: "docs/specs/2026-08-31-comment-assistance-discovery.md",
        url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
      },
      decision: "permitted",
      packet: {
        issueNumber: 469,
        status: "reviewed",
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
        customPerCommentBehavioralAssessment: true,
        modelProviderFlow: true,
        retentionApproach: true,
      },
      conditions: [],
    },
    oauthVerification: {
      recordType: "youtube-channel-oauth-verification",
      recordVersion: 1,
      provider: "youtube",
      status: "verified",
      verificationReference: "test-only-oauth-evidence",
      verifiedAt: NOW.toISOString(),
      verifiedBy: "test-only reviewer",
      approvedScopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
    },
    privacyDisclosure: {
      status: "verified",
      disclosureRef: "test-only-privacy-disclosure",
      verifiedAt: NOW.toISOString(),
    },
    credentials: {
      status: "available",
      credentialReferenceId: "test-only-credential-reference",
    },
    creatorConsent: {
      status: "confirmed",
      consentRef: "test-only-creator-consent",
      confirmedAt: NOW.toISOString(),
    },
    quotaEvidence: {
      status: "verified",
      evidenceRef: "test-only-quota-evidence",
      verifiedAt: NOW.toISOString(),
      dailyPublicationLimit: 10,
      insertQuotaCost: 50,
    },
    transport: {
      status: "available",
      adapterRef: "test-only-transport",
    },
  };
}

function transport(overrides: Record<string, unknown> = {}) {
  return {
    insertPublicReply: vi.fn().mockResolvedValue({
      kind: "accepted",
      reply: PROVIDER_REPLY,
    }),
    observePublicReply: vi.fn().mockResolvedValue({
      kind: "verified_presence",
      reply: PROVIDER_REPLY,
    }),
    deletePublicReply: vi.fn().mockResolvedValue({
      kind: "confirmed",
      replyId: PROVIDER_REPLY.replyId,
    }),
    ...overrides,
  };
}

describe("first real Public Reply repository foundation", () => {
  it("shows the complete confirmation and deterministically publishes once", async () => {
    const initial = record();
    const store = createInMemoryPublicReplyLifecycleStore({
      records: [initial],
      remainingDailyPublications: 10,
    });
    const providerTransport = transport();
    const provider = createYouTubePublicReplyProvider({
      transport: providerTransport,
      resolveGate: gate,
    });

    expect(
      buildPublicReplyPublicationConfirmation({
        record: initial,
        publishingIdentity: PUBLISHING_IDENTITY,
      }),
    ).toEqual({
      kind: "confirmation",
      currentComment: {
        id: WORK.commentId,
        text: COMMENT_TEXT,
        hash: COMMENT_HASH,
      },
      video: {
        id: "video-1",
        title: "Creator Video",
        uploadingChannel: "Verified Creator",
      },
      publishingIdentity: PUBLISHING_IDENTITY,
      finalText: FINAL_TEXT,
      publishedText: FINAL_TEXT,
      target: {
        kind: "normal_thread_reply",
        parentCommentId: WORK.commentId,
        prefix: null,
      },
      explicitConfirmation: true,
    });

    const result = await publishPublicReply({
      store,
      provider,
      replyId: initial.id,
      preflight: preflight(),
      governance: GOVERNANCE,
      lifecycle: ACTIVE_LIFECYCLE,
      publishingIdentity: PUBLISHING_IDENTITY,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "published",
      reply: { replyId: PROVIDER_REPLY.replyId },
      confirmation: { explicitConfirmation: true },
    });
    expect(providerTransport.insertPublicReply).toHaveBeenCalledTimes(1);
    expect(providerTransport.insertPublicReply).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCommentId: WORK.commentId,
        text: FINAL_TEXT,
      }),
    );
    expect(store.remainingDailyPublications).toBe(9);
  });

  it("adds a verified nested display-name prefix after generation", async () => {
    const nested = record({
      source: {
        ...record().source,
        target: {
          kind: "nested",
          parentCommentId: WORK.commentId,
          identity: {
            status: "verified",
            providerAuthorId: "author-1",
            displayName: "Comment Author",
          },
        },
      },
    });
    const confirmation = buildPublicReplyPublicationConfirmation({
      record: nested,
      publishingIdentity: PUBLISHING_IDENTITY,
    });

    expect(confirmation).toMatchObject({
      kind: "confirmation",
      finalText: FINAL_TEXT,
      publishedText: "@Comment Author " + FINAL_TEXT,
      target: {
        kind: "sibling_thread_reply",
        parentCommentId: WORK.commentId,
        prefix: "@Comment Author ",
      },
    });

    const store = createInMemoryPublicReplyLifecycleStore({
      records: [nested],
      remainingDailyPublications: 10,
    });
    const providerTransport = transport({
      insertPublicReply: vi.fn().mockResolvedValue({
        kind: "accepted",
        reply: {
          ...PROVIDER_REPLY,
          text: "@Comment Author " + FINAL_TEXT,
        },
      }),
    });
    const provider = createYouTubePublicReplyProvider({
      transport: providerTransport,
      resolveGate: gate,
    });

    const published = await publishPublicReply({
      store,
      provider,
      replyId: nested.id,
      preflight: preflight(),
      governance: GOVERNANCE,
      lifecycle: ACTIVE_LIFECYCLE,
      publishingIdentity: PUBLISHING_IDENTITY,
      now: () => NOW,
    });

    expect(published).toMatchObject({
      outcome: "published",
      record: {
        publishedText: "@Comment Author " + FINAL_TEXT,
        externallyEdited: false,
      },
    });
  });

  it.each(["missing", "ambiguous"] as const)(
    "opens YouTube instead of publishing when nested identity is %s",
    async (identityStatus) => {
      const initial = record({
        source: {
          ...record().source,
          target: {
            kind: "nested",
            parentCommentId: WORK.commentId,
            identity: { status: identityStatus },
          },
        },
      });
      const store = createInMemoryPublicReplyLifecycleStore({
        records: [initial],
        remainingDailyPublications: 10,
      });
      const providerTransport = transport();
      const provider = createYouTubePublicReplyProvider({
        transport: providerTransport,
        resolveGate: gate,
      });

      const result = await publishPublicReply({
        store,
        provider,
        replyId: initial.id,
        preflight: preflight(),
        governance: GOVERNANCE,
        lifecycle: ACTIVE_LIFECYCLE,
        publishingIdentity: PUBLISHING_IDENTITY,
        now: () => NOW,
      });

      expect(result).toMatchObject({
        outcome: "open_in_youtube",
        reason: "nested_identity_unavailable",
      });
      expect(providerTransport.insertPublicReply).not.toHaveBeenCalled();
      expect(store.remainingDailyPublications).toBe(10);
    },
  );

  it("does not publish when lifecycle provenance belongs to another grant", async () => {
    const initial = record();
    const store = createInMemoryPublicReplyLifecycleStore({
      records: [initial],
      remainingDailyPublications: 10,
    });
    const providerTransport = transport();
    const provider = createYouTubePublicReplyProvider({
      transport: providerTransport,
      resolveGate: gate,
    });

    const result = await publishPublicReply({
      store,
      provider,
      replyId: initial.id,
      preflight: preflight(),
      governance: GOVERNANCE,
      lifecycle: { ...ACTIVE_LIFECYCLE, grantId: "grant-other" },
      publishingIdentity: PUBLISHING_IDENTITY,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      reason: "lifecycle_blocked",
    });
    expect(providerTransport.insertPublicReply).not.toHaveBeenCalled();
    expect(store.remainingDailyPublications).toBe(10);
  });

  it("keeps ambiguous completion uncertain until absence is reconciled", async () => {
    const initial = record();
    const store = createInMemoryPublicReplyLifecycleStore({
      records: [initial],
      remainingDailyPublications: 10,
    });
    const providerTransport = transport({
      insertPublicReply: vi.fn().mockResolvedValue({
        kind: "ambiguous",
        reason: "response lost",
      }),
      observePublicReply: vi.fn().mockResolvedValue({
        kind: "verified_absence",
        replyId: initial.id,
      }),
    });
    const provider = createYouTubePublicReplyProvider({
      transport: providerTransport,
      resolveGate: gate,
    });

    const uncertain = await publishPublicReply({
      store,
      provider,
      replyId: initial.id,
      preflight: preflight(),
      governance: GOVERNANCE,
      lifecycle: ACTIVE_LIFECYCLE,
      publishingIdentity: PUBLISHING_IDENTITY,
      now: () => NOW,
    });
    expect(uncertain).toMatchObject({
      outcome: "publication_uncertain",
      retryAllowed: false,
    });

    const retryBeforeReconcile = await publishPublicReply({
      store,
      provider,
      replyId: initial.id,
      preflight: preflight(),
      governance: GOVERNANCE,
      lifecycle: ACTIVE_LIFECYCLE,
      publishingIdentity: PUBLISHING_IDENTITY,
      now: () => NOW,
    });
    expect(retryBeforeReconcile).toMatchObject({
      outcome: "blocked",
      reason: "publication_reconciliation_required",
    });
    expect(providerTransport.insertPublicReply).toHaveBeenCalledTimes(1);

    const reconciled = await reconcilePublicReply({
      store,
      provider,
      replyId: initial.id,
      access: ACCESS,
      lifecycle: ACTIVE_LIFECYCLE,
      now: () => NOW,
    });
    expect(reconciled).toMatchObject({
      outcome: "verified_absence",
      retryAllowed: true,
    });
  });

  it("opens external edits and deletes during the read-only grace period", async () => {
    const published = record({
      revision: 1,
      status: "published",
      providerReplyId: PROVIDER_REPLY.replyId,
      publishedText: FINAL_TEXT,
      publishedAt: NOW.toISOString(),
      lastObservedText: FINAL_TEXT,
      lastObservedTextHash: hashCommentText(FINAL_TEXT),
      lastObservedAt: NOW.toISOString(),
    });
    const store = createInMemoryPublicReplyLifecycleStore({
      records: [published],
      remainingDailyPublications: 9,
    });
    const providerTransport = transport({
      observePublicReply: vi.fn().mockResolvedValue({
        kind: "verified_presence",
        reply: { ...PROVIDER_REPLY, text: "An external edit." },
      }),
    });
    const provider = createYouTubePublicReplyProvider({
      transport: providerTransport,
      resolveGate: gate,
    });

    const opened = await openPublishedPublicReply({
      store,
      provider,
      replyId: published.id,
      access: ACCESS,
      lifecycle: GRACE_LIFECYCLE,
      now: () => NOW,
    });
    expect(opened).toMatchObject({
      outcome: "opened",
      currentText: "An external edit.",
      externallyEdited: true,
      editingSurface: "youtube",
    });

    const deleted = await deletePublicReply({
      store,
      provider,
      replyId: published.id,
      authorization: {
        ownerId: OWNER_ID,
        channelId: ACTIVE_CHANNEL.channelId,
        connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
        grantId: ACTIVE_CHANNEL.grantId,
        connectionState: "grace_period",
        grantStatus: "active",
        provenanceRefreshed: true,
      },
      access: ACCESS,
      lifecycle: GRACE_LIFECYCLE,
      confirmation: true,
      now: () => NOW,
    });

    expect(deleted).toMatchObject({
      outcome: "deleted",
      completionReported: true,
      retryAllowed: false,
    });
    expect(providerTransport.deletePublicReply).toHaveBeenCalledTimes(1);
    expect(store.remainingDailyPublications).toBe(9);
  });
});
