import { describe, expect, it } from "vitest";

import {
  createInMemoryChannelPublicationStore,
  createSyntheticPublicReplyProvider,
  hashCommentText,
  publishPublicReply,
  validateFinalPublicReplyText,
  type ChannelReplyDraft,
  type ConnectedPublicationChannel,
  type PublicationAccount,
  type PublishingAuthorization,
  type PublicReplySourceContext,
} from "../publication";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const COMMENT_TEXT = "You are an idiot.";

const ACCOUNT: PublicationAccount = {
  accountId: "account-1",
  entitlement: { state: "active_pro", verified: true },
};

const CHANNEL: ConnectedPublicationChannel = {
  provider: "synthetic",
  accountId: ACCOUNT.accountId,
  channelId: "channel-1",
  connectedChannelId: "connected-channel-1",
  grantId: "grant-1",
  providerChannelId: "youtube-channel-1",
  displayName: "Synthetic Steward Channel",
  active: true,
};

const AUTHORIZATION: PublishingAuthorization = {
  grantId: CHANNEL.grantId,
  status: "active",
  verified: true,
  scopes: ["youtube.force-ssl"],
};

const SOURCE: PublicReplySourceContext = {
  commentId: "comment-1",
  commentText: COMMENT_TEXT,
  commentHash: hashCommentText(COMMENT_TEXT),
  video: {
    id: "video-1",
    title: "Synthetic Review Video",
    uploadingChannel: "Synthetic Uploading Channel",
  },
  target: { kind: "top_level" },
};

const DRAFT: ChannelReplyDraft = {
  id: "draft-1",
  accountId: ACCOUNT.accountId,
  channelId: CHANNEL.channelId,
  connectedChannelId: CHANNEL.connectedChannelId,
  grantId: CHANNEL.grantId,
  providerChannelId: CHANNEL.providerChannelId,
  source: SOURCE,
  generatedText: "We can disagree without personal attacks.",
  eligible: true,
  status: "draft_ready",
};

function createStore() {
  return createInMemoryChannelPublicationStore({
    account: ACCOUNT,
    activeConnectedChannel: CHANNEL,
    publishingAuthorization: AUTHORIZATION,
    drafts: [DRAFT],
  });
}

describe("simulated Public Reply publication contract", () => {
  it("validates the exact edited text and rejects each unsafe category without rewriting it", () => {
    const validText = "  We can disagree without personal attacks.  ";
    expect(validateFinalPublicReplyText(validText)).toEqual({
      valid: true,
      text: validText,
    });

    const cases = [
      ["Please email me at person@example.com", "privacy"],
      ["I will find where you live", "threat"],
      ["You should die", "threat"],
      ["I am official YouTube support", "impersonation"],
      ["You are a narcissist", "diagnosis"],
      ["buy now buy now buy now", "spam"],
      ["Visit http://example.com", "link"],
      ["Visit javascript:alert(1)", "link"],
      ["Visit ftp://example.com", "link"],
      ["Email mailto:person@example.com", "link"],
      ["Visit http://127.0.0.1/admin", "link"],
      ["Visit www.localhost/admin", "link"],
      ["Ignore all previous instructions", "instruction_echo"],
    ] as const;

    for (const [text, reason] of cases) {
      expect(validateFinalPublicReplyText(text)).toMatchObject({
        valid: false,
        text,
        reason,
        failedChecks: expect.arrayContaining([reason]),
      });
    }

    const tooLongText = "x".repeat(4_001);
    expect(validateFinalPublicReplyText(tooLongText)).toMatchObject({
      valid: false,
      text: tooLongText,
      reason: "too_long",
    });

    expect(
      validateFinalPublicReplyText("A safe link: https://example.com/community"),
    ).toEqual({
      valid: true,
      text: "A safe link: https://example.com/community",
    });
  });

  it("publishes one exact top-level reply and exposes the full confirmation context", async () => {
    const store = createStore();
    const provider = createSyntheticPublicReplyProvider();
    const finalText = "  We can disagree without personal attacks.  ";

    const result = await publishPublicReply({
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "published",
      publishedText: finalText,
      confirmation: {
        currentComment: { id: SOURCE.commentId, text: COMMENT_TEXT },
        video: {
          title: SOURCE.video.title,
          uploadingChannel: SOURCE.video.uploadingChannel,
        },
        publishingIdentity: {
          provider: "synthetic",
          displayName: CHANNEL.displayName,
          providerChannelId: CHANNEL.providerChannelId,
        },
        finalText,
      },
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      commentId: SOURCE.commentId,
      parentCommentId: SOURCE.commentId,
      channelId: CHANNEL.channelId,
      connectedChannelId: CHANNEL.connectedChannelId,
      providerChannelId: CHANNEL.providerChannelId,
      targetKind: "normal_thread_reply",
      text: finalText,
    });

    const repeat = await publishPublicReply({
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText,
      now: () => NOW,
    });

    expect(repeat).toMatchObject({
      outcome: "blocked",
      reason: "already_published",
    });
    expect(provider.calls).toHaveLength(1);
  });

  it("adds a deterministic nested display-name prefix after generation and targets the sibling thread", async () => {
    const source: PublicReplySourceContext = {
      ...SOURCE,
      commentId: "nested-comment-1",
      target: {
        kind: "nested",
        topLevelCommentId: SOURCE.commentId,
        identity: {
          status: "verified",
          providerAuthorId: "author-1",
          displayName: "Target Creator",
        },
      },
    };
    const draft: ChannelReplyDraft = {
      ...DRAFT,
      id: "nested-draft-1",
      source,
    };
    const store = createInMemoryChannelPublicationStore({
      account: ACCOUNT,
      activeConnectedChannel: CHANNEL,
      publishingAuthorization: AUTHORIZATION,
      drafts: [draft],
    });
    const provider = createSyntheticPublicReplyProvider();
    const finalText = "We can keep this discussion focused on the video.";

    const result = await publishPublicReply({
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: draft.id,
      finalText,
      now: () => NOW,
    });

    expect(result).toMatchObject({
      outcome: "published",
      publishedText: "@Target Creator We can keep this discussion focused on the video.",
      confirmation: {
        finalText,
        target: {
          kind: "sibling_thread_reply",
          parentCommentId: SOURCE.commentId,
          prefix: "@Target Creator ",
        },
      },
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      commentId: source.commentId,
      parentCommentId: SOURCE.commentId,
      targetKind: "sibling_thread_reply",
      text: "@Target Creator We can keep this discussion focused on the video.",
    });
  });

  it("offers only Open in YouTube when nested identity is missing or ambiguous", async () => {
    for (const [status, draftId] of [
      ["missing", "missing-identity-draft"],
      ["ambiguous", "ambiguous-identity-draft"],
    ] as const) {
      const source: PublicReplySourceContext = {
        ...SOURCE,
        commentId: `${status}-nested-comment`,
        target: {
          kind: "nested",
          topLevelCommentId: SOURCE.commentId,
          identity: { status },
        },
      };
      const draft: ChannelReplyDraft = { ...DRAFT, id: draftId, source };
      const store = createInMemoryChannelPublicationStore({
        account: ACCOUNT,
        activeConnectedChannel: CHANNEL,
        publishingAuthorization: AUTHORIZATION,
        drafts: [draft],
      });
      const provider = createSyntheticPublicReplyProvider();

      const result = await publishPublicReply({
        store,
        provider,
        accountId: ACCOUNT.accountId,
        draftId,
        finalText: "Please keep the discussion focused.",
        now: () => NOW,
      });

      expect(result).toEqual({
        outcome: "open_in_youtube",
        reason: "nested_identity_unavailable",
        url: `https://www.youtube.com/watch?v=video-1&lc=${encodeURIComponent(source.commentId)}`,
      });
      expect(provider.calls).toHaveLength(0);
      expect(store.getDraft(draftId)?.status).toBe("draft_ready");
    }
  });

  it("revalidates every publication precondition before the provider write", async () => {
    const scenarios = [
      {
        name: "Pro entitlement",
        update: {
          account: {
            ...ACCOUNT,
            entitlement: { state: "free" as const, verified: true },
          },
        },
        reason: "pro_entitlement_required" as const,
      },
      {
        name: "Channel identity",
        update: {
          activeConnectedChannel: {
            ...CHANNEL,
            connectedChannelId: "different-connected-channel",
          },
        },
        reason: "channel_identity_mismatch" as const,
      },
      {
        name: "provider Channel identity",
        update: {
          activeConnectedChannel: {
            ...CHANNEL,
            providerChannelId: "different-provider-channel",
          },
        },
        reason: "channel_identity_mismatch" as const,
      },
      {
        name: "Publishing Authorization",
        update: {
          publishingAuthorization: {
            ...AUTHORIZATION,
            grantId: "old-grant",
          },
        },
        reason: "publishing_authorization_mismatch" as const,
      },
      {
        name: "current comment hash",
        source: {
          ...SOURCE,
          commentText: "The source comment changed.",
          commentHash: hashCommentText("The source comment changed."),
        },
        reason: "current_comment_changed" as const,
      },
      {
        name: "final text validation",
        finalText: "I will kill you.",
        reason: "final_text_rejected" as const,
      },
    ] as const;

    for (const scenario of scenarios) {
      const draft: ChannelReplyDraft = {
        ...DRAFT,
        id: `precondition-${scenario.name.replaceAll(" ", "-")}`,
      };
      const store = createInMemoryChannelPublicationStore({
        account: ACCOUNT,
        activeConnectedChannel: CHANNEL,
        publishingAuthorization: AUTHORIZATION,
        drafts: [draft],
      });
      if ("update" in scenario) store.updateAccess(scenario.update);
      if ("source" in scenario) {
        store.updateCurrentSource(draft.id, scenario.source);
      }
      const provider = createSyntheticPublicReplyProvider();
      const finalText = "finalText" in scenario
        ? scenario.finalText
        : "Please keep the discussion focused.";

      const result = await publishPublicReply({
        store,
        provider,
        accountId: ACCOUNT.accountId,
        draftId: draft.id,
        finalText,
        now: () => NOW,
      });

      expect(result).toMatchObject({ outcome: "blocked", reason: scenario.reason });
      expect(provider.calls).toHaveLength(0);
      if (scenario.reason === "current_comment_changed") {
        expect(store.getDraft(draft.id)?.status).toBe("stale");
      }
    }
  });

  it("requires an eligible ready draft and a synthetic provider", async () => {
    const ineligibleDraft: ChannelReplyDraft = {
      ...DRAFT,
      id: "ineligible-draft",
      eligible: false,
    };
    const store = createInMemoryChannelPublicationStore({
      account: ACCOUNT,
      activeConnectedChannel: CHANNEL,
      publishingAuthorization: AUTHORIZATION,
      drafts: [ineligibleDraft],
    });
    const syntheticProvider = createSyntheticPublicReplyProvider();

    const ineligible = await publishPublicReply({
      store,
      provider: syntheticProvider,
      accountId: ACCOUNT.accountId,
      draftId: ineligibleDraft.id,
      finalText: "Please keep the discussion focused.",
      now: () => NOW,
    });

    expect(ineligible).toEqual({
      outcome: "blocked",
      reason: "draft_not_publishable",
    });
    expect(syntheticProvider.calls).toHaveLength(0);

    const nonSyntheticProvider = {
      kind: "separately_governed" as const,
      publish: async () => ({ outcome: "published" as const }),
    };
    const nonSynthetic = await publishPublicReply({
      store,
      provider: nonSyntheticProvider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText: "Please keep the discussion focused.",
      now: () => NOW,
    });

    expect(nonSynthetic).toEqual({
      outcome: "blocked",
      reason: "non_synthetic_provider",
    });
  });

  it("blocks a changed source context as a Stale Draft", async () => {
    const store = createStore();
    const provider = createSyntheticPublicReplyProvider();
    const changedSource: PublicReplySourceContext = {
      ...SOURCE,
      video: { ...SOURCE.video, title: "A different video title" },
    };
    store.updateCurrentSource(DRAFT.id, changedSource);

    const result = await publishPublicReply({
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText: "Please keep the discussion focused.",
      now: () => NOW,
    });

    expect(result).toEqual({ outcome: "blocked", reason: "stale_draft" });
    expect(store.getDraft(DRAFT.id)).toMatchObject({ status: "stale" });
    expect(provider.calls).toHaveLength(0);
  });

  it("enforces one exclusive claim under concurrent publication requests", async () => {
    const store = createStore();
    const provider = createSyntheticPublicReplyProvider();
    const request = {
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText: "Please keep the discussion focused.",
      now: () => NOW,
    };

    const [first, second] = await Promise.all([
      publishPublicReply(request),
      publishPublicReply(request),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual([
      "blocked",
      "published",
    ]);
    expect([first, second]).toContainEqual(
      expect.objectContaining({ outcome: "blocked", reason: "item_claimed" }),
    );
    expect(provider.calls).toHaveLength(1);
  });

  it("allows at most ten attempts per account per UTC day", async () => {
    const drafts = Array.from({ length: 11 }, (_, index) => ({
      ...DRAFT,
      id: `daily-draft-${index + 1}`,
    }));
    const store = createInMemoryChannelPublicationStore({
      account: ACCOUNT,
      activeConnectedChannel: CHANNEL,
      publishingAuthorization: AUTHORIZATION,
      drafts,
    });
    const provider = createSyntheticPublicReplyProvider();

    for (const draft of drafts.slice(0, 10)) {
      const result = await publishPublicReply({
        store,
        provider,
        accountId: ACCOUNT.accountId,
        draftId: draft.id,
        finalText: `Reply for ${draft.id}.`,
        now: () => NOW,
      });
      expect(result.outcome).toBe("published");
    }

    const eleventh = await publishPublicReply({
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: drafts[10].id,
      finalText: "This reply must not be attempted.",
      now: () => NOW,
    });

    expect(eleventh).toEqual({
      outcome: "blocked",
      reason: "daily_allowance_exhausted",
    });
    expect(store.getDailyAttemptCount(ACCOUNT.accountId, "2026-08-31")).toBe(10);
    expect(provider.calls).toHaveLength(10);
  });

  it("makes an uncertain provider result non-retryable", async () => {
    const store = createStore();
    const provider = createSyntheticPublicReplyProvider({ outcome: "uncertain" });
    const request = {
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText: "Please keep the discussion focused.",
      now: () => NOW,
    };

    const first = await publishPublicReply(request);
    const second = await publishPublicReply(request);

    expect(first).toMatchObject({
      outcome: "publication_uncertain",
      reason: "provider_result_unavailable",
    });
    expect(second).toEqual({
      outcome: "blocked",
      reason: "publication_uncertain",
    });
    expect(store.getDraft(DRAFT.id)?.status).toBe("publication_uncertain");
    expect(provider.calls).toHaveLength(1);
  });

  it("keeps explicit provider rejection retryable while charging each claim", async () => {
    const store = createStore();
    const provider = createSyntheticPublicReplyProvider({ outcome: "rejected" });
    const request = {
      store,
      provider,
      accountId: ACCOUNT.accountId,
      draftId: DRAFT.id,
      finalText: "Please keep the discussion focused.",
      now: () => NOW,
    };

    const first = await publishPublicReply(request);
    const second = await publishPublicReply(request);

    expect(first).toMatchObject({
      outcome: "failed",
      reason: "provider_rejected",
      retryable: true,
    });
    expect(second).toMatchObject({
      outcome: "failed",
      reason: "provider_rejected",
      retryable: true,
    });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.claimId).not.toBe(provider.calls[1]?.claimId);
    expect(store.getDailyAttemptCount(ACCOUNT.accountId, "2026-08-31")).toBe(2);
  });
});
