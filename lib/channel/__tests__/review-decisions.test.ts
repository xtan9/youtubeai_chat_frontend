import { describe, expect, it } from "vitest";

import {
  applyReviewDecision,
  buildReviewItemPresentation,
  createReviewQueueItem,
  projectReviewQueue,
  type ReviewDecisionActor,
  type ReviewQueueItem,
} from "../review-decisions";

const REVIEWED_AT = new Date("2026-08-31T12:00:00.000Z");
const STEWARD: ReviewDecisionActor = {
  role: "channel_steward",
  stewardId: "steward-1",
  channelId: "channel-1",
  connectedChannelId: "connected-channel-1",
};

type ItemOverrides = Partial<Parameters<typeof createReviewQueueItem>[0]>;

function item(overrides: ItemOverrides = {}): ReviewQueueItem {
  return createReviewQueueItem({
    assessmentId: "assessment-1",
    interactionId: "interaction-1",
    commentId: "comment-1",
    commentTextHash: "a".repeat(64),
    channelId: "channel-1",
    connectedChannelId: "connected-channel-1",
    video: {
      id: "video-1",
      title: "A bounded review video",
    },
    boundedContext: {
      candidateText: "You are an idiot.",
      topLevelCommentText: "You are an idiot.",
      neighboringReplies: ["Please keep the discussion focused on the video."],
    },
    assessment: {
      classification: "Reviewable Interaction",
      target: "channel_steward",
      severity: "non_severe",
      language: "english",
      targetEvidence: ["direct_steward_address"],
      assessedAt: "2026-08-31T11:00:00.000Z",
    },
    connectedYouTubeChannel: {
      id: "connected-channel-1",
      displayName: "Synthetic Steward Channel",
    },
    publishingIdentity: {
      id: "connected-channel-1",
      displayName: "Synthetic Steward Channel",
    },
    ...overrides,
  });
}

function actionableItem(overrides: ItemOverrides = {}): ReviewQueueItem {
  return item({
    assessmentId: "actionable-assessment",
    interactionId: "actionable-interaction",
    commentId: "actionable-comment",
    assessment: {
      classification: "Actionable Abuse",
      target: "channel_steward",
      severity: "non_severe",
      language: "english",
      targetEvidence: ["direct_steward_address"],
      assessedAt: "2026-08-31T11:00:00.000Z",
    },
    ...overrides,
  });
}

function safetyItem(overrides: ItemOverrides = {}): ReviewQueueItem {
  return item({
    assessmentId: "safety-assessment",
    interactionId: "safety-interaction",
    commentId: "safety-comment",
    assessment: {
      classification: "Safety Flag",
      target: "channel_steward",
      severity: "severe",
      language: "english",
      targetEvidence: ["direct_steward_address"],
      assessedAt: "2026-08-31T10:00:00.000Z",
    },
    ...overrides,
  });
}

function applied(
  current: ReviewQueueItem,
  command: Parameters<typeof applyReviewDecision>[0]["command"],
  at = REVIEWED_AT,
) {
  const result = applyReviewDecision({
    item: current,
    actor: STEWARD,
    command,
    at,
  });
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error("expected an applied decision");
  return result;
}

describe("per-interaction Review Decisions", () => {
  it("presents bounded context, identities, assessment, and only item-scoped actions", () => {
    const presentation = buildReviewItemPresentation(item());

    expect(presentation).toMatchObject({
      boundedContext: {
        candidateText: "You are an idiot.",
        topLevelCommentText: "You are an idiot.",
        neighboringReplies: [
          "Please keep the discussion focused on the video.",
        ],
      },
      video: { id: "video-1", title: "A bounded review video" },
      connectedYouTubeChannel: {
        id: "connected-channel-1",
        displayName: "Synthetic Steward Channel",
      },
      currentAssessment: {
        label: "Interaction Assessment",
        classification: "Reviewable Interaction",
        status: "reviewable",
      },
      intendedPublishingIdentity: {
        id: "connected-channel-1",
        displayName: "Synthetic Steward Channel",
      },
      openOnYouTube: {
        href:
          "https://www.youtube.com/watch?v=video-1&lc=comment-1",
      },
    });

    expect(presentation.actions.map((action) => action.action)).toEqual([
      "dismiss",
      "defer",
      "mark_allowed_criticism",
      "confirm_actionable_abuse",
      "open_on_youtube",
    ]);
    expect(JSON.stringify(presentation)).not.toMatch(/risk|confidence/i);
  });

  it("dismisses one interaction and records bounded provenance", () => {
    const result = applied(item(), {
      action: "dismiss",
      confirmed: true,
    });

    expect(result.item.status).toBe("dismissed");
    expect(result.item.deferredUntil).toBeNull();
    expect(result.decision).toMatchObject({
      schemaVersion: "review-decision-v1",
      action: "dismiss",
      stateChanged: true,
      assessmentId: "assessment-1",
      interactionId: "interaction-1",
      commentId: "comment-1",
      channelId: "channel-1",
      connectedChannelId: "connected-channel-1",
      stewardId: "steward-1",
      commentTextHash: "a".repeat(64),
      from: {
        classification: "reviewable_interaction",
        status: "reviewable",
        deferredUntil: null,
      },
      to: {
        classification: "reviewable_interaction",
        status: "dismissed",
        deferredUntil: null,
      },
      assessmentVersion: "interaction-assessment-v1",
      taxonomyVersion: "channel-comment-taxonomy-v1",
      validatorVersion: "review-decision-validator-v1",
      recordedAt: "2026-08-31T12:00:00.000Z",
      expiresAt: "2026-09-30T12:00:00.000Z",
    });
    expect(result.decision).not.toHaveProperty("commentText");
    expect(result.decision).not.toHaveProperty("draftText");
    expect(result.item.decisionHistory).toHaveLength(1);
  });

  it("defers one interaction until an explicit bounded time", () => {
    const result = applied(item(), {
      action: "defer",
      confirmed: true,
      deferUntil: "2026-09-02T12:00:00.000Z",
    });

    expect(result.item).toMatchObject({
      status: "reviewable",
      deferredUntil: "2026-09-02T12:00:00.000Z",
    });
    expect(result.decision).toMatchObject({
      action: "defer",
      stateChanged: true,
      to: {
        classification: "reviewable_interaction",
        status: "reviewable",
        deferredUntil: "2026-09-02T12:00:00.000Z",
      },
    });
  });

  it("marks an interaction as Allowed Criticism and removes retained context", () => {
    const result = applied(item(), {
      action: "mark_allowed_criticism",
      confirmed: true,
    });

    expect(result.item).toMatchObject({
      status: "marked_criticism",
      assessment: { classification: "Allowed Criticism" },
      boundedContext: {
        candidateText: null,
        topLevelCommentText: null,
        neighboringReplies: [],
      },
    });
    expect(result.decision.to).toMatchObject({
      classification: "allowed_criticism",
      status: "marked_criticism",
    });
    expect(JSON.stringify(result.item)).not.toContain("You are an idiot.");
  });

  it("requires explicit confirmation of non-severe Actionable Abuse before requesting a draft", () => {
    const reviewable = item();

    const blocked = applyReviewDecision({
      item: reviewable,
      actor: STEWARD,
      command: { action: "request_draft", confirmed: true },
      at: REVIEWED_AT,
    });
    expect(blocked).toEqual({
      status: "blocked",
      reason: "draft_requires_confirmed_actionable_abuse",
    });

    const confirmed = applied(reviewable, {
      action: "confirm_actionable_abuse",
      confirmed: true,
    });
    expect(confirmed.item).toMatchObject({
      status: "actionable",
      assessment: {
        classification: "Actionable Abuse",
        severity: "non_severe",
      },
    });

    const requested = applied(confirmed.item, {
      action: "request_draft",
      confirmed: true,
    });
    expect(requested.item.status).toBe("draft_requested");
    expect(requested.decision.action).toBe("request_draft");
    expect(JSON.stringify(requested.item)).not.toMatch(/risk|confidence/i);
  });

  it("does not make a deferred interaction draft-eligible before its due time", () => {
    const confirmed = applied(actionableItem(), {
      action: "confirm_actionable_abuse",
      confirmed: true,
    }).item;
    const deferred = applied(confirmed, {
      action: "defer",
      confirmed: true,
      deferUntil: "2026-09-02T12:00:00.000Z",
    }).item;

    expect(
      buildReviewItemPresentation(deferred, REVIEWED_AT).actions.map(
        (action) => action.action,
      ),
    ).not.toContain("request_draft");
    expect(
      applyReviewDecision({
        item: deferred,
        actor: STEWARD,
        command: { action: "request_draft", confirmed: true },
        at: REVIEWED_AT,
      }),
    ).toEqual({
      status: "blocked",
      reason: "draft_requires_confirmed_actionable_abuse",
    });
  });

  it("keeps Safety Flags reply-blocked and returns guidance without enforcement", () => {
    const safety = safetyItem();

    const draft = applyReviewDecision({
      item: safety,
      actor: STEWARD,
      command: { action: "request_draft", confirmed: true },
      at: REVIEWED_AT,
    });
    expect(draft).toEqual({
      status: "blocked",
      reason: "safety_flag_blocks_reply",
    });

    const confirm = applyReviewDecision({
      item: safety,
      actor: STEWARD,
      command: { action: "confirm_actionable_abuse", confirmed: true },
      at: REVIEWED_AT,
    });
    expect(confirm).toEqual({
      status: "blocked",
      reason: "safety_flag_blocks_reply",
    });

    const guidance = applied(safety, {
      action: "continue_safety_enforcement",
      confirmed: true,
    });
    expect(guidance.item.status).toBe("safety_flag");
    expect(guidance.guidance).toBeDefined();
    if (!guidance.guidance) throw new Error("expected safety guidance");
    expect(guidance.guidance).toMatchObject({
      replyDraftAvailable: false,
      automaticEnforcementAvailable: false,
    });
    expect(guidance.guidance.actions.map((action) => action.id)).toEqual([
      "report-on-youtube",
      "open-youtube-studio",
      "local-emergency-services",
      "trusted-crisis-service",
    ]);
    expect(guidance.decision).toMatchObject({
      action: "continue_safety_enforcement",
      stateChanged: false,
    });
  });

  it("shows Safety Flag guidance and never exposes a draft or criticism action", () => {
    const presentation = buildReviewItemPresentation(safetyItem(), REVIEWED_AT);

    expect(presentation.currentAssessment).toMatchObject({
      classification: "Safety Flag",
      status: "safety_flag",
    });
    expect(presentation.actions.map((action) => action.action)).toEqual([
      "dismiss",
      "defer",
      "continue_safety_enforcement",
      "open_on_youtube",
    ]);
    expect(JSON.stringify(presentation)).not.toMatch(/draft|risk|confidence/i);
  });

  it("opens exactly one interaction on YouTube without recording a decision", () => {
    const result = applyReviewDecision({
      item: item({
        video: { id: "video with spaces", title: "Video" },
        commentId: "comment/one",
      }),
      actor: STEWARD,
      command: { action: "open_on_youtube", confirmed: false },
      at: REVIEWED_AT,
    });

    expect(result).toMatchObject({
      status: "opened_on_youtube",
      href:
        "https://www.youtube.com/watch?v=video%20with%20spaces&lc=comment%2Fone",
    });
    if (result.status !== "opened_on_youtube") {
      throw new Error("expected YouTube navigation");
    }
    expect(result.item.decisionHistory).toHaveLength(0);
  });

  it("fails closed for unbounded deferrals, unsupported-language confirmations, and identity drift", () => {
    expect(
      applyReviewDecision({
        item: item(),
        actor: STEWARD,
        command: { action: "defer", confirmed: true },
        at: REVIEWED_AT,
      }),
    ).toEqual({ status: "blocked", reason: "defer_until_required" });

    expect(
      applyReviewDecision({
        item: item(),
        actor: STEWARD,
        command: {
          action: "defer",
          confirmed: true,
          deferUntil: "2026-10-01T12:00:00.000Z",
        },
        at: REVIEWED_AT,
      }),
    ).toEqual({ status: "blocked", reason: "defer_until_out_of_bounds" });

    expect(
      applyReviewDecision({
        item: item({
          assessment: {
            classification: "Reviewable Interaction",
            target: "channel_steward",
            severity: "non_severe",
            language: "other",
            targetEvidence: ["direct_steward_address"],
            assessedAt: "2026-08-31T11:00:00.000Z",
          },
        }),
        actor: STEWARD,
        command: { action: "confirm_actionable_abuse", confirmed: true },
        at: REVIEWED_AT,
      }),
    ).toEqual({
      status: "blocked",
      reason: "non_severe_actionable_abuse_required",
    });

    expect(
      applyReviewDecision({
        item: item(),
        actor: { ...STEWARD, connectedChannelId: "another-channel" },
        command: { action: "dismiss", confirmed: true },
        at: REVIEWED_AT,
      }),
    ).toEqual({ status: "blocked", reason: "channel_identity_mismatch" });
  });

  it("does not accept provenance copied from a different interaction", () => {
    const decision = applied(item(), {
      action: "dismiss",
      confirmed: true,
    }).decision;

    expect(() =>
      item({
        assessmentId: "different-assessment",
        interactionId: "different-interaction",
        commentId: "different-comment",
        decisionHistory: [decision],
      }),
    ).toThrow(/does not belong to the item/i);
  });

  it("orders active classes before handled work and applies Video, assessment, and status filters", () => {
    const safety = safetyItem();
    const actionable = actionableItem({
      video: { id: "video-2", title: "Another video" },
      assessment: {
        classification: "Actionable Abuse",
        target: "channel_steward",
        severity: "non_severe",
        language: "english",
        targetEvidence: ["direct_steward_address"],
        assessedAt: "2026-08-31T16:00:00.000Z",
      },
    });
    const reviewable = item({
      assessmentId: "reviewable-assessment",
      interactionId: "reviewable-interaction",
      commentId: "reviewable-comment",
      assessment: {
        classification: "Reviewable Interaction",
        target: "channel_steward",
        severity: "non_severe",
        language: "english",
        targetEvidence: ["direct_steward_address"],
        assessedAt: "2026-08-31T17:00:00.000Z",
      },
    });
    const handledOlder = applied(
      item({
        assessmentId: "handled-older",
        interactionId: "handled-older-interaction",
        commentId: "handled-older-comment",
      }),
      { action: "dismiss", confirmed: true },
      new Date("2026-08-31T11:00:00.000Z"),
    ).item;
    const handledNewer = applied(
      item({
        assessmentId: "handled-newer",
        interactionId: "handled-newer-interaction",
        commentId: "handled-newer-comment",
      }),
      { action: "dismiss", confirmed: true },
      new Date("2026-08-31T14:00:00.000Z"),
    ).item;
    const deferred = applied(
      item({
        assessmentId: "deferred",
        interactionId: "deferred-interaction",
        commentId: "deferred-comment",
      }),
      {
        action: "defer",
        confirmed: true,
        deferUntil: "2026-09-02T12:00:00.000Z",
      },
    ).item;

    const queue = projectReviewQueue(
      [handledOlder, reviewable, actionable, safety, handledNewer, deferred],
      { now: REVIEWED_AT },
    );

    expect(queue.map((entry) => entry.assessmentId)).toEqual([
      "safety-assessment",
      "actionable-assessment",
      "reviewable-assessment",
      "handled-newer",
      "deferred",
      "handled-older",
    ]);
    expect(projectReviewQueue(queue, { videoId: "video-2" }).map((entry) => entry.assessmentId)).toEqual([
      "actionable-assessment",
    ]);
    expect(
      projectReviewQueue(queue, { assessment: "safety_flag" }).map(
        (entry) => entry.assessmentId,
      ),
    ).toEqual(["safety-assessment"]);
    expect(
      projectReviewQueue(queue, { status: "handled", now: REVIEWED_AT }).map(
        (entry) => entry.assessmentId,
      ),
    ).toEqual(["handled-newer", "deferred", "handled-older"]);
    expect(
      projectReviewQueue(queue, { status: "deferred", now: REVIEWED_AT }).map(
        (entry) => entry.assessmentId,
      ),
    ).toEqual(["deferred"]);
    expect(JSON.stringify(queue)).not.toMatch(/risk|confidence/i);
  });

  it("fails closed without a Channel Steward, explicit confirmation, or a batch item", () => {
    const current = item();

    expect(
      applyReviewDecision({
        item: current,
        actor: { ...STEWARD, role: "model" as never },
        command: { action: "dismiss", confirmed: true },
        at: REVIEWED_AT,
      }),
    ).toEqual({ status: "blocked", reason: "channel_steward_required" });
    expect(
      applyReviewDecision({
        item: current,
        actor: STEWARD,
        command: { action: "dismiss", confirmed: false },
        at: REVIEWED_AT,
      }),
    ).toEqual({
      status: "blocked",
      reason: "explicit_confirmation_required",
    });
    expect(
      applyReviewDecision({
        item: [current] as unknown as ReviewQueueItem,
        actor: STEWARD,
        command: { action: "dismiss", confirmed: true },
        at: REVIEWED_AT,
      }),
    ).toEqual({ status: "blocked", reason: "invalid_item" });
  });

  it("keeps generated provenance IDs bounded for maximum-length item IDs", () => {
    const result = applied(
      item({ assessmentId: "a".repeat(240) }),
      { action: "dismiss", confirmed: true },
    );

    expect(result.decision.decisionId.length).toBeLessThanOrEqual(240);
  });
});
