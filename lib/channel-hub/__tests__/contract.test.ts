import { describe, expect, it } from "vitest";

import {
  CHANNEL_HUB_SCREEN_STATES,
  REVIEW_ITEM_STATUSES,
  getHubCapabilities,
  getReviewActions,
  type ChannelHubChannel,
  type ChannelHubState,
  type HubReviewItem,
} from "../contract";

const CHANNEL: ChannelHubChannel = {
  channelId: "channel-481",
  connectedChannelId: "connected-channel-481",
  providerChannelId: "UC481",
  displayName: "The 481 Channel",
  active: true,
  grantStatus: "active",
  publishingAuthorization: "not_requested",
};

const ITEM: HubReviewItem = {
  id: "assessment-481",
  channelId: CHANNEL.channelId,
  connectedChannelId: CHANNEL.connectedChannelId,
  video: { id: "video-481", title: "A video with useful context" },
  interactionText: "You are not helping anyone.",
  topLevelCommentText: "You are not helping anyone.",
  neighboringReplies: [],
  classification: "Actionable Abuse",
  target: "channel_steward",
  severity: "non_severe",
  targetEvidence: ["direct address"],
  draftEligible: true,
  status: "actionable",
  assessedAt: "2026-08-31T12:00:00.000Z",
  publishingIdentity: CHANNEL,
  youtubeUrl: "https://www.youtube.com/watch?v=video-481&lc=comment-481",
};

function state(kind: ChannelHubState["kind"]): ChannelHubState {
  switch (kind) {
    case "disconnected":
      return {
        kind,
        phase: "first_visit",
        access: "registered",
        entitlement: "active_pro",
        canConnect: true,
      };
    case "free_discovery":
      return {
        kind,
        upgradeHref: "/pricing?source_surface=channel",
      };
    case "pro_onboarding":
      return { kind, step: "attest_age", canContinue: true };
    case "connected":
      return { kind, channel: CHANNEL, scanRun: null, queue: [] };
    case "scanning":
      return {
        kind,
        channel: CHANNEL,
        scanRun: {
          id: "scan-481",
          status: "running",
          progress: { processedThreads: 4, totalThreads: 20, percent: 20 },
          coverage: {
            window: "recent_seven_days",
            windowStart: "2026-08-24T12:00:00.000Z",
            windowEnd: "2026-08-31T12:00:00.000Z",
            pages: 1,
            threadsDiscovered: 4,
            threadsAssessed: 4,
            threadsReused: 0,
            threadsFailed: 0,
            bound: null,
            boundPreventedCompleteCoverage: false,
            completeWithinBounds: false,
          },
        },
        queue: [],
      };
    case "review":
      return {
        kind,
        channel: CHANNEL,
        queue: [ITEM],
        selectedItemId: ITEM.id,
      };
    case "grace_period":
      return {
        kind,
        channel: CHANNEL,
        expiresAt: "2026-09-07T12:00:00.000Z",
        queue: [ITEM],
      };
    case "deletion":
      return { kind, phase: "in_progress", requestedAt: "2026-08-31T12:00:00.000Z" };
    case "deleted":
      return { kind, deletedAt: "2026-08-31T12:01:00.000Z" };
  }
}

describe("Channel Hub contract", () => {
  it("keeps every release-safe experience state explicit", () => {
    expect(CHANNEL_HUB_SCREEN_STATES).toEqual([
      "disconnected",
      "free_discovery",
      "pro_onboarding",
      "connected",
      "scanning",
      "review",
      "grace_period",
      "deletion",
      "deleted",
    ]);
    expect(REVIEW_ITEM_STATUSES).toEqual([
      "reviewable",
      "actionable",
      "safety_flag",
      "dismissed",
      "marked_criticism",
      "draft_requested",
      "draft_ready",
      "stale",
      "publishing",
      "failed",
      "published",
      "publication_uncertain",
      "deleted",
    ]);
  });

  it("gates new work during discovery, onboarding, grace, and deletion", () => {
    expect(
      getHubCapabilities({
        kind: "disconnected",
        phase: "first_visit",
        access: "registered",
        entitlement: "free",
        canConnect: true,
      }).canConnect,
    ).toBe(false);
    expect(getHubCapabilities(state("free_discovery"))).toMatchObject({
      canConnect: false,
      canStartScan: false,
      canReview: false,
      canDraft: false,
      canPublish: false,
    });
    expect(getHubCapabilities(state("pro_onboarding"))).toMatchObject({
      canConnect: true,
      canStartScan: false,
      canReview: false,
    });
    expect(getHubCapabilities(state("grace_period"))).toMatchObject({
      canConnect: false,
      canStartScan: false,
      canReview: true,
      canDraft: false,
      canPublish: false,
      canDelete: true,
      readOnly: true,
    });
    expect(getHubCapabilities(state("deletion"))).toMatchObject({
      canStartScan: false,
      canReview: false,
      canDelete: false,
    });
  });

  it("keeps Safety Flags response-blocking even if a stale item claims draft readiness", () => {
    const safetyFlag = {
      ...ITEM,
      classification: "Safety Flag" as const,
      severity: "severe" as const,
      status: "draft_ready" as const,
      draft: { text: "This must never become an action." },
    };

    const actions = getReviewActions(safetyFlag);

    expect(actions.map((action) => action.action)).not.toEqual(
      expect.arrayContaining(["request_draft", "edit_draft", "publish"]),
    );
    expect(actions.map((action) => action.action)).toEqual([
      "continue_safety_guidance",
      "open_on_youtube",
    ]);
  });

  it("keeps review and publication lifecycle states distinct", () => {
    const statuses = [
      "draft_requested",
      "draft_ready",
      "stale",
      "publishing",
      "failed",
      "published",
      "publication_uncertain",
      "deleted",
    ] as const;

    expect(new Set(statuses).size).toBe(statuses.length);
    expect(getReviewActions({
      ...ITEM,
      status: "draft_ready",
      draft: { text: "A private draft" },
      publishingIdentity: { ...CHANNEL, publishingAuthorization: "active" },
    })).toEqual([
      { action: "edit_draft", label: "Edit draft" },
      { action: "publish", label: "Publish reviewed reply" },
      { action: "open_on_youtube", label: "Open on YouTube", href: ITEM.youtubeUrl },
    ]);
    expect(
      getReviewActions({
        ...ITEM,
        status: "publication_uncertain",
        publication: { replyId: null },
      }).map((action) => action.action),
    ).toEqual(["recheck_publication", "open_on_youtube"]);
  });

  it("does not expose provider write controls after authorization is revoked", () => {
    const revokedItem = {
      ...ITEM,
      status: "draft_ready" as const,
      draft: { text: "A private draft" },
      publishingIdentity: {
        ...CHANNEL,
        publishingAuthorization: "revoked" as const,
      },
    };

    expect(getReviewActions(revokedItem).map((action) => action.action)).toEqual([
      "edit_draft",
      "open_on_youtube",
    ]);
    expect(
      getHubCapabilities({
        kind: "review",
        channel: revokedItem.publishingIdentity,
        queue: [revokedItem],
        selectedItemId: revokedItem.id,
      }).canPublish,
    ).toBe(false);
  });
});
