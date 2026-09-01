import { describe, expect, it, vi } from "vitest";

import {
  beginPublicReplyPublication,
  buildYouTubeReplyUrl,
  completePublicReplyPublication,
  createInMemoryPublicReplyLifecycleStore,
  createSyntheticPublicReplyProvider,
  deletePublicReply,
  hashCommentText,
  isPublicReplyPublicationRetryable,
  openPublishedPublicReply,
  PublicReplyControlRecordSchema,
  reconcilePublicReply,
  type ChannelPublicationPreflight,
  type PublicReplyControlRecord,
  type PublicReplyDeletionAuthorization,
  type PublicReplyLifecycleProvider,
} from "../publication";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../scopes";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const OWNER_ID = "researcher-1";
const COMMENT_TEXT = "You are an idiot.";
const FINAL_TEXT = "We can disagree without personal attacks.";

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
    ownerId: ACTIVE_CHANNEL.ownerId,
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
  commentHash: hashCommentText(COMMENT_TEXT),
} as const;

const PREFLIGHT: ChannelPublicationPreflight = {
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

const DELETE_AUTHORIZATION: PublicReplyDeletionAuthorization = {
  ownerId: OWNER_ID,
  channelId: ACTIVE_CHANNEL.channelId,
  connectedChannelId: ACTIVE_CHANNEL.connectedChannelId,
  grantId: ACTIVE_CHANNEL.grantId,
  connectionState: "grace_period",
  grantStatus: "active",
  provenanceRefreshed: true,
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
        title: "Synthetic Review Video",
        uploadingChannel: "Synthetic Uploading Channel",
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

function store(initial: PublicReplyControlRecord = record()) {
  return createInMemoryPublicReplyLifecycleStore({
    records: [initial],
    remainingDailyPublications: 10,
  });
}

describe("simulated Public Reply lifecycle", () => {
  it("preserves exact approved and observed text while rejecting blank values", () => {
    const exactText = "  We can disagree without personal attacks.  ";
    const parsed = PublicReplyControlRecordSchema.parse(
      record({ finalText: exactText }),
    );

    expect(parsed.finalText).toBe(exactText);
    expect(() =>
      PublicReplyControlRecordSchema.parse(record({ finalText: "   " })),
    ).toThrow();
  });

  it("turns ambiguous provider completion into Publication Uncertain and blocks retry", async () => {
    const lifecycleStore = store();
    const started = await beginPublicReplyPublication({
      store: lifecycleStore,
      replyId: "reply-control-1",
      preflight: PREFLIGHT,
    });

    expect(started.outcome).toBe("attempt_started");

    const result = await completePublicReplyPublication({
      store: lifecycleStore,
      replyId: "reply-control-1",
      providerResult: { kind: "ambiguous", reason: "provider timed out" },
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "publication_uncertain",
      retryAllowed: false,
    });
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject(
      {
        status: "publication_uncertain",
        providerReplyId: null,
      },
    );
    expect(
      isPublicReplyPublicationRetryable(
        await lifecycleStore.get("reply-control-1"),
      ),
    ).toBe(false);

    const retry = await beginPublicReplyPublication({
      store: lifecycleStore,
      replyId: "reply-control-1",
      preflight: PREFLIGHT,
    });
    expect(retry).toMatchObject({
      outcome: "blocked",
      reason: "publication_reconciliation_required",
    });
  });

  it("allows only one concurrent publication claim", async () => {
    const lifecycleStore = store();

    const results = await Promise.all([
      beginPublicReplyPublication({
        store: lifecycleStore,
        replyId: "reply-control-1",
        preflight: PREFLIGHT,
      }),
      beginPublicReplyPublication({
        store: lifecycleStore,
        replyId: "reply-control-1",
        preflight: PREFLIGHT,
      }),
    ]);

    expect(results.filter((result) => result.outcome === "attempt_started"))
      .toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.outcome === "blocked" &&
          ["publication_in_flight", "publication_claim_lost"].includes(
            result.reason,
          ),
      ),
    ).toHaveLength(1);
  });

  it("consumes publication allowance at the claim and leaves it unchanged on deletion", async () => {
    const lifecycleStore = createInMemoryPublicReplyLifecycleStore({
      records: [record()],
      remainingDailyPublications: 1,
    });
    const started = await beginPublicReplyPublication({
      store: lifecycleStore,
      replyId: "reply-control-1",
      preflight: { ...PREFLIGHT, remainingDailyPublications: 1 },
    });

    expect(started.outcome).toBe("attempt_started");
    expect(lifecycleStore.remainingDailyPublications).toBe(0);

    await completePublicReplyPublication({
      store: lifecycleStore,
      replyId: "reply-control-1",
      providerResult: { kind: "accepted", reply: PROVIDER_REPLY },
      now: () => NOW,
    });
    const deleted = await deletePublicReply({
      store: lifecycleStore,
      provider: createSyntheticPublicReplyProvider({
        deleteResults: [{ kind: "confirmed", replyId: PROVIDER_REPLY.replyId }],
      }),
      replyId: "reply-control-1",
      authorization: DELETE_AUTHORIZATION,
      confirmation: true,
      now: () => NOW,
    });

    expect(deleted.outcome).toBe("deleted");
    expect(lifecycleStore.remainingDailyPublications).toBe(0);
  });

  it("distinguishes verified presence, verified absence, and continued uncertainty", async () => {
    const presenceStore = store(
      record({ status: "publication_uncertain" }),
    );
    const presence = await reconcilePublicReply({
      store: presenceStore,
      provider: createSyntheticPublicReplyProvider({
        recheckResults: [{ kind: "verified_presence", reply: PROVIDER_REPLY }],
      }),
      replyId: "reply-control-1",
      now: () => NOW,
    });
    expect(presence).toMatchObject({
      outcome: "verified_presence",
      retryAllowed: false,
      providerReplyId: PROVIDER_REPLY.replyId,
    });
    await expect(presenceStore.get("reply-control-1")).resolves.toMatchObject({
      status: "published",
      providerReplyId: PROVIDER_REPLY.replyId,
      externallyEdited: false,
    });

    const absenceStore = store(
      record({ status: "publication_uncertain" }),
    );
    const absence = await reconcilePublicReply({
      store: absenceStore,
      provider: createSyntheticPublicReplyProvider({
        recheckResults: [{ kind: "verified_absence", replyId: "reply-unknown" }],
      }),
      replyId: "reply-control-1",
      now: () => NOW,
    });
    expect(absence).toMatchObject({
      outcome: "verified_absence",
      retryAllowed: true,
    });
    const afterAbsence = await absenceStore.get("reply-control-1");
    expect(afterAbsence).toMatchObject({ status: "draft_ready" });
    expect(isPublicReplyPublicationRetryable(afterAbsence)).toBe(true);
    expect(
      (
        await beginPublicReplyPublication({
          store: absenceStore,
          replyId: "reply-control-1",
          preflight: PREFLIGHT,
        })
      ).outcome,
    ).toBe("attempt_started");

    const uncertainStore = store(
      record({ status: "publication_uncertain" }),
    );
    const uncertain = await reconcilePublicReply({
      store: uncertainStore,
      provider: createSyntheticPublicReplyProvider({
        recheckResults: [
          { kind: "continued_uncertainty", reason: "provider unavailable" },
        ],
      }),
      replyId: "reply-control-1",
      now: () => NOW,
    });
    expect(uncertain).toMatchObject({
      outcome: "continued_uncertainty",
      retryAllowed: false,
    });
    await expect(uncertainStore.get("reply-control-1")).resolves.toMatchObject(
      { status: "publication_uncertain" },
    );
  });

  it("re-reads a published reply when opening it and identifies external edits", async () => {
    const lifecycleStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    const changedText = "We can disagree without personal attacks. Please.";
    const provider = createSyntheticPublicReplyProvider({
      readResults: [
        {
          kind: "verified_presence",
          reply: { ...PROVIDER_REPLY, text: changedText },
        },
      ],
    });

    const result = await openPublishedPublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "opened",
      url: buildYouTubeReplyUrl("video-1", "reply-1"),
      currentText: changedText,
      externallyEdited: true,
      editingSurface: "youtube",
    });
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject(
      {
        status: "published",
        lastObservedText: changedText,
        externallyEdited: true,
      },
    );
    expect(provider.calls.read).toHaveLength(1);
  });

  it("does not turn a provider-verified absence into a silent local deletion", async () => {
    const lifecycleStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    const provider = createSyntheticPublicReplyProvider({
      readResults: [{ kind: "verified_absence", replyId: PROVIDER_REPLY.replyId }],
    });

    const result = await openPublishedPublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "provider_absent",
      externallyEdited: false,
    });
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject(
      {
        status: "published",
        deletionStatus: "not_requested",
      },
    );
    expect(provider.calls.delete).toHaveLength(0);
  });

  it("requires explicit confirmation before deletion", async () => {
    const lifecycleStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    const provider = createSyntheticPublicReplyProvider({
      deleteResults: [{ kind: "confirmed", replyId: PROVIDER_REPLY.replyId }],
    });

    const result = await deletePublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      authorization: DELETE_AUTHORIZATION,
      confirmation: false,
      now: () => NOW,
    });

    expect(result).toEqual({
      outcome: "confirmation_required",
      completionReported: false,
    });
    expect(provider.calls.delete).toHaveLength(0);
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject(
      { status: "published", deletionStatus: "not_requested" },
    );
  });

  it("keeps deletion uncertain until both provider and local outcomes are known without consuming allowance", async () => {
    const lifecycleStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    const provider = createSyntheticPublicReplyProvider({
      deleteResults: [{ kind: "ambiguous", reason: "provider timed out" }],
    });
    const beforeAllowance = lifecycleStore.remainingDailyPublications;

    const result = await deletePublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      authorization: DELETE_AUTHORIZATION,
      confirmation: true,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "deletion_uncertain",
      completionReported: false,
      retryAllowed: true,
    });
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject(
      {
        status: "published",
        deletionStatus: "uncertain",
      },
    );
    expect(lifecycleStore.remainingDailyPublications).toBe(beforeAllowance);
  });

  it("reports deletion only after confirmed provider deletion and local persistence", async () => {
    const lifecycleStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    const provider = createSyntheticPublicReplyProvider({
      deleteResults: [{ kind: "confirmed", replyId: PROVIDER_REPLY.replyId }],
    });

    const result = await deletePublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      authorization: DELETE_AUTHORIZATION,
      confirmation: true,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "deleted",
      completionReported: true,
      retryAllowed: false,
    });
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject(
      {
        status: "deleted",
        deletionStatus: "completed",
        deletionCompletedAt: NOW.toISOString(),
      },
    );
    expect(lifecycleStore.remainingDailyPublications).toBe(10);
  });

  it("does not let a stale provider read resurrect a concurrently deleted reply", async () => {
    const lifecycleStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    let resolveRead: ((value: unknown) => void) | undefined;
    const provider: PublicReplyLifecycleProvider = {
      kind: "synthetic",
      recheck: vi.fn(),
      read: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      ),
      delete: vi
        .fn()
        .mockResolvedValue({ kind: "confirmed", replyId: PROVIDER_REPLY.replyId }),
    };

    const openingPromise = openPublishedPublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      now: () => NOW,
    });
    await vi.waitFor(() => expect(provider.read).toHaveBeenCalledTimes(1));

    const deletion = await deletePublicReply({
      store: lifecycleStore,
      provider,
      replyId: "reply-control-1",
      authorization: DELETE_AUTHORIZATION,
      confirmation: true,
      now: () => NOW,
    });
    expect(deletion.outcome).toBe("deleted");

    resolveRead?.({ kind: "verified_presence", reply: PROVIDER_REPLY });
    const opening = await openingPromise;
    expect(opening).toMatchObject({
      outcome: "continued_uncertainty",
      externallyEdited: false,
    });
    await expect(lifecycleStore.get("reply-control-1")).resolves.toMatchObject({
      status: "deleted",
      deletionStatus: "completed",
    });
  });

  it("fails closed when local deletion persistence fails after provider confirmation", async () => {
    const baseStore = store(
      record({
        status: "published",
        providerReplyId: PROVIDER_REPLY.replyId,
        publishedText: FINAL_TEXT,
        publishedAt: NOW.toISOString(),
      }),
    );
    const save = vi
      .spyOn(baseStore, "save")
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("local write unavailable"));
    const provider = createSyntheticPublicReplyProvider({
      deleteResults: [{ kind: "confirmed", replyId: PROVIDER_REPLY.replyId }],
    });

    const result = await deletePublicReply({
      store: baseStore,
      provider,
      replyId: "reply-control-1",
      authorization: DELETE_AUTHORIZATION,
      confirmation: true,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "deletion_uncertain",
      completionReported: false,
    });
    expect(save).toHaveBeenCalledTimes(3);
    await expect(baseStore.get("reply-control-1")).resolves.toMatchObject({
      status: "published",
      deletionStatus: "uncertain",
    });
  });
});
