import { describe, expect, it, vi } from "vitest";

import type { ChannelAccessContext } from "../../channel-onboarding/access";
import {
  applyChannelCleanupResultToLifecycle,
  authorizeChannelLifecycleAction,
  buildYouTubeDeletionGuidance,
  evaluateChannelRetention,
  evaluateChannelReplyControlRetention,
  planChannelCleanup,
  refreshChannelData,
  refreshChannelReplyControl,
  resubscribeChannel,
  runChannelCleanupAttempt,
  startChannelReadOnlyGracePeriod,
  chooseCleanupReplyDeletion,
  expireChannelReadOnlyGracePeriod,
  type ChannelReplyControl,
  type ChannelCleanupPersistence,
  type ChannelCleanupProvider,
  type ChannelRetentionRecord,
  type ChannelLifecycleRecord,
} from "../lifecycle";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const OWNER_ID = "researcher-1";

const LIFECYCLE: ChannelLifecycleRecord = {
  ownerId: OWNER_ID,
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  state: "active",
  graceStartedAt: null,
  graceEndsAt: null,
  grantStatus: "active",
  provenanceStatus: "active",
  provenanceRefreshedAt: NOW.toISOString(),
  localDataStatus: "retained",
};

const ACCESS: ChannelAccessContext = {
  principal: { userId: OWNER_ID, isAnonymous: false },
  entitlement: { state: "active_pro", verified: true },
  persistenceAvailable: true,
  adultAttestation: {
    attested: true,
    attestedAt: NOW.toISOString(),
    policyVersion: "channel-adult-v1",
  },
  connectedChannel: {
    ownerId: OWNER_ID,
    channelId: LIFECYCLE.channelId,
    connectedChannelId: LIFECYCLE.connectedChannelId,
    grantId: LIFECYCLE.grantId,
    supportedCreator: true,
    status: "active",
  },
  publishingAuthorization: {
    grantId: LIFECYCLE.grantId,
    granted: true,
    verified: true,
    scopes: ["youtube.force-ssl"],
  },
};

const REPLY_CONTROL: ChannelReplyControl = {
  id: "reply-control-1",
  ownerId: OWNER_ID,
  channelId: LIFECYCLE.channelId,
  connectedChannelId: LIFECYCLE.connectedChannelId,
  grantId: LIFECYCLE.grantId,
  providerReplyId: "youtube-reply-1",
  commentId: "youtube-comment-1",
  commentHash: "comment-hash-1",
  publishedAt: NOW.toISOString(),
  lastRefreshedAt: NOW.toISOString(),
  status: "active",
};

describe("Channel lifecycle policy", () => {
  it("starts an exact seven-day read-only grace period and blocks new work immediately", () => {
    const transition = startChannelReadOnlyGracePeriod({
      lifecycle: LIFECYCLE,
      now: NOW,
    });

    expect(transition).toEqual({
      kind: "started",
      lifecycle: {
        ...LIFECYCLE,
        state: "read_only_grace",
        graceStartedAt: NOW.toISOString(),
        graceEndsAt: "2026-09-07T12:00:00.000Z",
      },
    });
    if (transition.kind !== "started") throw new Error("expected transition");

    const graceAccess: ChannelAccessContext = {
      ...ACCESS,
      entitlement: { state: "free", verified: true },
    };

    for (const action of ["scan", "draft", "publication"] as const) {
      expect(
        authorizeChannelLifecycleAction({
          action,
          access: graceAccess,
          lifecycle: transition.lifecycle,
          now: NOW,
        }),
      ).toEqual({
        allowed: false,
        action,
        reason: "read_only_grace",
      });
    }

    for (const action of [
      "inspect",
      "export",
      "delete",
      "disconnect",
      "resubscribe",
    ] as const) {
      expect(
        authorizeChannelLifecycleAction({
          action,
          access: graceAccess,
          lifecycle: transition.lifecycle,
          now: NOW,
        }),
      ).toEqual({ allowed: true, action });
    }
  });

  it("resubscribes before grace expiry and turns expiry into cleanup state", () => {
    const transition = startChannelReadOnlyGracePeriod({
      lifecycle: LIFECYCLE,
      now: NOW,
    });
    if (transition.kind !== "started") throw new Error("expected transition");

    expect(
      resubscribeChannel({
        lifecycle: transition.lifecycle,
        entitlement: { state: "active_pro", verified: true },
        now: new Date("2026-09-01T12:00:00.000Z"),
      }),
    ).toMatchObject({
      kind: "resubscribed",
      lifecycle: {
        state: "active",
        graceStartedAt: null,
        graceEndsAt: null,
      },
    });

    expect(
      expireChannelReadOnlyGracePeriod({
        lifecycle: transition.lifecycle,
        now: new Date("2026-09-07T12:00:00.000Z"),
      }),
    ).toMatchObject({
      kind: "cleanup_required",
      lifecycle: {
        state: "cleanup_pending",
        graceStartedAt: NOW.toISOString(),
        graceEndsAt: "2026-09-07T12:00:00.000Z",
      },
    });

    const expired = expireChannelReadOnlyGracePeriod({
      lifecycle: transition.lifecycle,
      now: new Date("2026-09-07T12:00:00.000Z"),
    });
    if (expired.kind !== "cleanup_required") {
      throw new Error("expected grace expiry");
    }
    expect(
      planChannelCleanup({
        lifecycle: expired.lifecycle,
        reason: "grace_expiry",
        replyControls: [],
        now: new Date("2026-09-07T12:00:00.000Z"),
      }),
    ).toMatchObject({
      kind: "planned",
      job: { reason: "grace_expiry", nextAttemptAt: "2026-09-07T12:00:00.000Z" },
    });
  });

  it("keeps identifying review data inside a 30-day refresh window while aggregates survive", () => {
    const retained: ChannelRetentionRecord = {
      id: "retained-1",
      ownerId: OWNER_ID,
      channelId: LIFECYCLE.channelId,
      kind: "review_text",
      retainedAt: NOW.toISOString(),
      refreshedAt: null,
      deletedAt: null,
    };

    expect(
      evaluateChannelRetention({
        record: retained,
        now: new Date("2026-09-30T11:59:59.999Z"),
        canRefresh: true,
      }),
    ).toMatchObject({ action: "retain" });
    expect(
      evaluateChannelRetention({
        record: retained,
        now: new Date("2026-09-30T12:00:00.000Z"),
        canRefresh: true,
      }),
    ).toMatchObject({ action: "refresh_or_delete" });
    expect(
      evaluateChannelRetention({
        record: retained,
        now: new Date("2026-09-30T12:00:00.000Z"),
        canRefresh: false,
      }),
    ).toMatchObject({ action: "delete" });

    const refreshed = refreshChannelData({
      record: retained,
      now: new Date("2026-09-30T12:00:00.000Z"),
    });
    expect(refreshed).toMatchObject({
      kind: "refreshed",
      record: {
        refreshedAt: "2026-09-30T12:00:00.000Z",
        deletedAt: null,
      },
    });

    expect(
      evaluateChannelRetention({
        record: {
          ...retained,
          kind: "aggregate",
        },
        now: new Date("2027-08-31T12:00:00.000Z"),
        canRefresh: false,
      }),
    ).toMatchObject({ action: "retain_aggregate" });

    expect(
      refreshChannelData({
        record: {
          ...retained,
          refreshedAt: "2026-09-30T12:00:00.000Z",
        },
        now: new Date("2026-10-30T12:00:00.000Z"),
      }),
    ).toMatchObject({ kind: "refreshed" });
  });

  it("expires reply-control provenance unless a provider-backed refresh occurs", () => {
    expect(
      evaluateChannelReplyControlRetention({
        replyControl: REPLY_CONTROL,
        now: new Date("2026-09-30T11:59:59.999Z"),
      }),
    ).toMatchObject({ action: "retain" });
    expect(
      evaluateChannelReplyControlRetention({
        replyControl: REPLY_CONTROL,
        now: new Date("2026-09-30T12:00:00.000Z"),
      }),
    ).toMatchObject({ action: "refresh_or_delete" });
    expect(
      refreshChannelReplyControl({
        replyControl: REPLY_CONTROL,
        now: new Date("2026-09-30T12:00:00.000Z"),
      }),
    ).toMatchObject({
      kind: "refreshed",
      replyControl: { lastRefreshedAt: "2026-09-30T12:00:00.000Z" },
    });
  });

  it("allows product-reply deletion during grace only while matching provenance is refreshed", () => {
    const transition = startChannelReadOnlyGracePeriod({
      lifecycle: LIFECYCLE,
      now: NOW,
    });
    if (transition.kind !== "started") throw new Error("expected transition");

    const result = authorizeChannelLifecycleAction({
      action: "delete_published_reply",
      access: {
        ...ACCESS,
        entitlement: { state: "free", verified: true },
      },
      lifecycle: transition.lifecycle,
      replyControl: REPLY_CONTROL,
      now: NOW,
    });
    expect(result).toEqual({ allowed: true, action: "delete_published_reply" });

    const unavailable = authorizeChannelLifecycleAction({
      action: "delete_published_reply",
      access: {
        ...ACCESS,
        entitlement: { state: "free", verified: true },
      },
      lifecycle: {
        ...LIFECYCLE,
        state: "cleanup_pending",
        grantStatus: "revoked",
        provenanceStatus: "removed",
        localDataStatus: "deleted",
      },
      replyControl: REPLY_CONTROL,
      now: NOW,
    });
    expect(unavailable).toEqual({
      allowed: false,
      action: "delete_published_reply",
      reason: "provider_authorization_removed",
      guidance: buildYouTubeDeletionGuidance(),
    });

    expect(
      authorizeChannelLifecycleAction({
        action: "scan",
        access: ACCESS,
        lifecycle: {
          ...LIFECYCLE,
          state: "cleanup_pending",
          grantStatus: "revoked",
          provenanceStatus: "removed",
        },
        now: NOW,
      }),
    ).toEqual({
      allowed: false,
      action: "scan",
      reason: "provider_authorization_removed",
      guidance: buildYouTubeDeletionGuidance(),
    });

    const stalePlan = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [
        {
          ...REPLY_CONTROL,
          publishedAt: "2026-07-01T11:59:59.999Z",
          lastRefreshedAt: "2026-07-31T11:59:59.999Z",
        },
      ],
      now: NOW,
    });
    expect(stalePlan).toMatchObject({
      kind: "planned",
      replyDeletionOffer: {
        kind: "instructions_only",
        guidance: buildYouTubeDeletionGuidance(),
      },
      job: {
        replyDeletionDecision: "not_required",
        replyDeletionStatus: "instructions_required",
      },
    });

    if (stalePlan.kind !== "planned") throw new Error("expected stale plan");
    const pendingDisconnect = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [REPLY_CONTROL],
      now: NOW,
    });
    if (pendingDisconnect.kind !== "planned") {
      throw new Error("expected pending disconnect");
    }
    expect(
      authorizeChannelLifecycleAction({
        action: "delete_published_reply",
        access: {
          ...ACCESS,
          entitlement: { state: "free", verified: true },
        },
        lifecycle: pendingDisconnect.lifecycle,
        replyControl: REPLY_CONTROL,
        now: NOW,
      }),
    ).toEqual({ allowed: true, action: "delete_published_reply" });
  });

  it("offers reply deletion before disconnect and schedules grace expiry as durable work", () => {
    const planned = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [REPLY_CONTROL],
      now: NOW,
    });

    expect(planned).toMatchObject({
      kind: "planned",
      replyDeletionOffer: {
        kind: "offered",
        controlCount: 1,
      },
      job: {
        reason: "disconnect",
        status: "pending",
        nextAttemptAt: NOW.toISOString(),
        deadlineAt: "2026-09-07T12:00:00.000Z",
        attemptCount: 0,
        replyDeletionDecision: "pending",
      },
      lifecycle: { state: "cleanup_pending" },
    });
    if (planned.kind !== "planned") throw new Error("expected cleanup plan");

    const chosen = chooseCleanupReplyDeletion({
      job: planned.job,
      choice: "delete",
    });
    expect(chosen).toMatchObject({
      kind: "updated",
      job: { replyDeletionDecision: "delete_requested" },
    });

    const grace = startChannelReadOnlyGracePeriod({
      lifecycle: LIFECYCLE,
      now: NOW,
    });
    if (grace.kind !== "started") throw new Error("expected grace transition");
    const expiryPlan = planChannelCleanup({
      lifecycle: grace.lifecycle,
      reason: "grace_expiry",
      replyControls: [REPLY_CONTROL],
      now: NOW,
    });
    expect(expiryPlan).toMatchObject({
      kind: "planned",
      job: {
        reason: "grace_expiry",
        nextAttemptAt: "2026-09-07T12:00:00.000Z",
        deadlineAt: "2026-09-07T12:00:00.000Z",
        replyDeletionDecision: "not_required",
      },
    });
  });

  it("deletes local data even when provider revocation fails and keeps cleanup retryable", async () => {
    const planned = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [REPLY_CONTROL],
      now: NOW,
    });
    if (planned.kind !== "planned") throw new Error("expected cleanup plan");
    const chosen = chooseCleanupReplyDeletion({
      job: planned.job,
      choice: "delete",
    });
    if (chosen.kind !== "updated") throw new Error("expected reply choice");

    const order: string[] = [];
    const provider: ChannelCleanupProvider = {
      deletePublishedReply: vi.fn(async () => {
        order.push("reply");
        return "succeeded" as const;
      }),
      revokeGrant: vi.fn(async () => {
        order.push("revoke");
        throw new Error("provider unavailable");
      }),
    };
    const deleteLocalChannelData = vi.fn(async () => {
      order.push("local");
      return "deleted" as const;
    });
    const persistence: ChannelCleanupPersistence = {
      recordCleanupAttempt: vi.fn().mockResolvedValue(undefined),
      saveCleanupJob: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runChannelCleanupAttempt({
      job: chosen.job,
      replyControls: [REPLY_CONTROL],
      provider,
      deleteLocalChannelData,
      persistence,
      now: NOW,
    });

    expect(order).toEqual(["reply", "revoke", "local"]);
    expect(result).toMatchObject({
      kind: "retryable",
      job: {
        status: "retryable",
        localDeletionStatus: "succeeded",
        grantRevocationStatus: "failed",
        replyDeletionStatus: "completed",
      },
      guidance: buildYouTubeDeletionGuidance(),
    });
    expect(result).not.toMatchObject({ kind: "completed" });
    expect(persistence.recordCleanupAttempt).toHaveBeenCalledTimes(1);
    expect(persistence.saveCleanupJob).toHaveBeenCalledTimes(1);

    const applied = applyChannelCleanupResultToLifecycle({
      lifecycle: LIFECYCLE,
      job: result.job,
      now: NOW,
    });
    expect(applied).toMatchObject({
      kind: "applied",
      lifecycle: {
        state: "cleanup_pending",
        grantStatus: "active",
        provenanceStatus: "removed",
        provenanceRefreshedAt: null,
        localDataStatus: "deleted",
      },
    });
  });

  it("reaches deleted only after both grant revocation and local deletion succeed", async () => {
    const planned = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "account_deletion",
      replyControls: [],
      now: NOW,
    });
    if (planned.kind !== "planned") throw new Error("expected cleanup plan");

    const result = await runChannelCleanupAttempt({
      job: planned.job,
      replyControls: [],
      provider: {
        deletePublishedReply: vi.fn(),
        revokeGrant: vi.fn().mockResolvedValue("succeeded" as const),
      },
      deleteLocalChannelData: vi.fn().mockResolvedValue("deleted" as const),
      persistence: {
        recordCleanupAttempt: vi.fn().mockResolvedValue(undefined),
        saveCleanupJob: vi.fn().mockResolvedValue(undefined),
      },
      now: NOW,
    });
    expect(result.kind).toBe("completed");

    const applied = applyChannelCleanupResultToLifecycle({
      lifecycle: LIFECYCLE,
      job: result.job,
      now: NOW,
    });
    expect(applied).toEqual({
      kind: "applied",
      lifecycle: {
        ...LIFECYCLE,
        state: "deleted",
        grantStatus: "revoked",
        provenanceStatus: "removed",
        provenanceRefreshedAt: null,
        localDataStatus: "deleted",
      },
    });
  });

  it("does not report completion when durable cleanup persistence fails", async () => {
    const planned = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [],
      now: NOW,
    });
    if (planned.kind !== "planned") throw new Error("expected cleanup plan");

    const result = await runChannelCleanupAttempt({
      job: planned.job,
      replyControls: [],
      provider: {
        deletePublishedReply: vi.fn(),
        revokeGrant: vi.fn().mockResolvedValue("succeeded" as const),
      },
      deleteLocalChannelData: vi.fn().mockResolvedValue("deleted" as const),
      persistence: {
        recordCleanupAttempt: vi.fn().mockResolvedValue(undefined),
        saveCleanupJob: vi.fn().mockRejectedValue(new Error("database unavailable")),
      },
      now: NOW,
    });

    expect(result).toEqual({
      kind: "persistence_failed",
      job: expect.objectContaining({ status: "completed" }),
      errorCode: "cleanup_persistence_failed",
    });
  });

  it("escalates an unresolved cleanup before the seven-day deadline", async () => {
    const planned = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [],
      now: NOW,
    });
    if (planned.kind !== "planned") throw new Error("expected cleanup plan");

    const result = await runChannelCleanupAttempt({
      job: planned.job,
      replyControls: [],
      provider: {
        deletePublishedReply: vi.fn(),
        revokeGrant: vi.fn().mockRejectedValue(new Error("still unavailable")),
      },
      deleteLocalChannelData: vi.fn().mockResolvedValue("deleted" as const),
      persistence: {
        recordCleanupAttempt: vi.fn().mockResolvedValue(undefined),
        saveCleanupJob: vi.fn().mockResolvedValue(undefined),
      },
      now: new Date("2026-09-06T13:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "escalated",
      job: {
        status: "escalated",
        escalatedAt: "2026-09-06T13:00:00.000Z",
      },
      guidance: buildYouTubeDeletionGuidance(),
    });
  });

  it("lets cleanup continue safely when the reply-deletion choice reaches its deadline", async () => {
    const planned = planChannelCleanup({
      lifecycle: LIFECYCLE,
      reason: "disconnect",
      replyControls: [REPLY_CONTROL],
      now: NOW,
    });
    if (planned.kind !== "planned") throw new Error("expected cleanup plan");

    const result = await runChannelCleanupAttempt({
      job: {
        ...planned.job,
        nextAttemptAt: "2026-09-06T12:00:00.000Z",
      },
      replyControls: [REPLY_CONTROL],
      provider: {
        deletePublishedReply: vi.fn(),
        revokeGrant: vi.fn().mockResolvedValue("succeeded" as const),
      },
      deleteLocalChannelData: vi.fn().mockResolvedValue("deleted" as const),
      persistence: {
        recordCleanupAttempt: vi.fn().mockResolvedValue(undefined),
        saveCleanupJob: vi.fn().mockResolvedValue(undefined),
      },
      now: new Date("2026-09-06T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "completed",
      job: {
        replyDeletionDecision: "timed_out",
        replyDeletionStatus: "skipped",
      },
      guidance: buildYouTubeDeletionGuidance(),
    });
    if (result.kind !== "completed") throw new Error("expected completed cleanup");
    expect(result.job.lastErrorCode).toBe("reply_deletion_choice_expired");
  });
});
