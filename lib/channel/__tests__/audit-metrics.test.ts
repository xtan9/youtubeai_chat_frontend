import { describe, expect, it } from "vitest";

import {
  CHANNEL_AUDIT_RETENTION_DAYS,
  CHANNEL_METRIC_MIN_ELIGIBLE_PUBLIC_REPLIES,
  CHANNEL_METRIC_MIN_REVIEWED_ASSESSMENTS,
  ChannelAuditProvenanceSchema,
  ChannelObservationSchema,
  buildChannelObservationReport,
  createChannelAuditProvenance,
  createChannelComplaintObservation,
  createChannelEscalationObservation,
  createChannelPublishedReplyObservation,
  createChannelReplyControlProvenance,
  createChannelReplyDeletionObservation,
  createChannelReviewObservation,
  evaluateChannelAuditRetention,
  evaluateChannelReplyControlRetention,
  hashChannelCommentText,
  refreshChannelReplyControlProvenance,
  type ChannelObservation,
} from "../audit-metrics";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const COMMENT_HASH = "a".repeat(64);

function instant(date: Date): string {
  return date.toISOString();
}

function daysBefore(days: number): string {
  return instant(new Date(NOW.getTime() - days * 24 * 60 * 60 * 1_000));
}

function auditInput() {
  return {
    eventId: "channel-audit:event-1",
    eventType: "deletion" as const,
    channelId: "channel:1",
    connectedChannelId: "connected:1",
    commentId: "comment:1",
    commentTextHash: COMMENT_HASH,
    model: "model-v1",
    promptVersion: "prompt-v1",
    taxonomyVersion: "taxonomy-v1",
    validatorVersion: "validator-v1",
    reviewDecision: {
      decisionId: "review-decision:1",
      action: "mark_allowed_criticism" as const,
      status: "marked_criticism" as const,
    },
    publicationIdentity: {
      channelId: "channel:1",
      connectedChannelId: "connected:1",
      grantId: "grant:1",
      providerChannelId: "youtube-channel:1",
    },
    providerReplyId: "youtube-reply:1",
    publishedAt: "2026-08-25T12:00:00.000Z",
    deletionOutcome: "completed" as const,
    reconciliationOutcome: "verified_presence" as const,
    recordedAt: NOW,
  };
}

describe("Channel audit provenance", () => {
  it("hashes comment text without retaining the text", () => {
    expect(hashChannelCommentText("comment")).toBe(
      "c44bb2fd516909dab78ae0bfedcd5672b131b996c4b7a4328ee55fba170da776",
    );
    expect(
      ChannelAuditProvenanceSchema.safeParse({
        ...createChannelAuditProvenance({
          ...auditInput(),
          commentTextHash: "fnv1a32:deadbeef",
        }),
      }).success,
    ).toBe(true);
  });

  it("binds the bounded provenance needed to explain one reply lifecycle", () => {
    const audit = createChannelAuditProvenance(auditInput());

    expect(audit).toMatchObject({
      channelId: "channel:1",
      connectedChannelId: "connected:1",
      commentId: "comment:1",
      commentTextHash: COMMENT_HASH,
      model: "model-v1",
      promptVersion: "prompt-v1",
      taxonomyVersion: "taxonomy-v1",
      validatorVersion: "validator-v1",
      reviewDecision: {
        decisionId: "review-decision:1",
        action: "mark_allowed_criticism",
        status: "marked_criticism",
      },
      publicationIdentity: {
        channelId: "channel:1",
        connectedChannelId: "connected:1",
        grantId: "grant:1",
        providerChannelId: "youtube-channel:1",
      },
      providerReplyId: "youtube-reply:1",
      publishedAt: "2026-08-25T12:00:00.000Z",
      deletionOutcome: "completed",
      reconciliationOutcome: "verified_presence",
      expiresAt: "2026-09-30T12:00:00.000Z",
    });
    expect(audit).not.toHaveProperty("commentText");
    expect(audit).not.toHaveProperty("draftText");
    expect(audit).not.toHaveProperty("authorId");
    expect(audit).not.toHaveProperty("safetyEvidence");
    expect(ChannelAuditProvenanceSchema.safeParse(audit).success).toBe(true);
  });

  it("rejects an audit record whose expiry exceeds the 30-day contract", () => {
    const parsed = ChannelAuditProvenanceSchema.safeParse({
      ...createChannelAuditProvenance(auditInput()),
      expiresAt: "2026-10-01T12:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects partial publication provenance and sensitive log fields", () => {
    const audit = createChannelAuditProvenance(auditInput());

    expect(
      ChannelAuditProvenanceSchema.safeParse({
        ...audit,
        providerReplyId: null,
      }).success,
    ).toBe(false);
    expect(
      ChannelAuditProvenanceSchema.safeParse({
        ...audit,
        commentText: "private comment text",
      }).success,
    ).toBe(false);
  });

  it("expires audit provenance without affecting durable aggregates", () => {
    const audit = createChannelAuditProvenance(auditInput());

    expect(
      evaluateChannelAuditRetention({
        record: audit,
        now: new Date("2026-09-30T12:00:00.000Z"),
      }),
    ).toEqual({
      action: "delete",
      reason: "retention_expired",
    });
    expect(CHANNEL_AUDIT_RETENTION_DAYS).toBe(30);
  });
});

describe("active reply-control provenance", () => {
  function control() {
    return createChannelReplyControlProvenance({
      controlId: "reply-control:1",
      channelId: "channel:1",
      connectedChannelId: "connected:1",
      commentId: "comment:1",
      commentTextHash: COMMENT_HASH,
      providerReplyId: "youtube-reply:1",
      publicationIdentity: {
        channelId: "channel:1",
        connectedChannelId: "connected:1",
        grantId: "grant:1",
        providerChannelId: "youtube-channel:1",
      },
      publishedAt: "2026-08-25T12:00:00.000Z",
      lastRefreshedAt: NOW,
    });
  }

  it("retains a live control record only until its refresh deadline", () => {
    const record = control();

    expect(
      evaluateChannelReplyControlRetention({
        record,
        now: new Date("2026-09-29T12:00:00.000Z"),
      }),
    ).toEqual({
      action: "retain",
      expiresAt: "2026-09-30T12:00:00.000Z",
    });
    expect(
      evaluateChannelReplyControlRetention({
        record,
        now: new Date("2026-09-30T12:00:00.000Z"),
      }),
    ).toEqual({ action: "delete", reason: "refresh_expired" });
  });

  it("allows a verified policy refresh before expiry and then advances the bound", () => {
    const refreshed = refreshChannelReplyControlProvenance({
      record: control(),
      now: new Date("2026-09-01T12:00:00.000Z"),
      providerRefreshConfirmed: true,
    });

    expect(refreshed).toMatchObject({
      outcome: "refreshed",
      record: {
        lastRefreshedAt: "2026-09-01T12:00:00.000Z",
        expiresAt: "2026-10-01T12:00:00.000Z",
      },
    });
  });

  it("deletes revoked provenance and refuses an unverified refresh", () => {
    const record = control();
    const revoked = { ...record, grantStatus: "revoked" as const };

    expect(
      evaluateChannelReplyControlRetention({ record: revoked, now: NOW }),
    ).toEqual({ action: "delete", reason: "revoked" });
    expect(
      refreshChannelReplyControlProvenance({
        record,
        now: new Date("2026-09-01T12:00:00.000Z"),
        providerRefreshConfirmed: false,
      }),
    ).toEqual({
      outcome: "blocked",
      reason: "provider_refresh_not_confirmed",
    });
  });
});

describe("Channel observation metrics", () => {
  it("stores only a material-rewrite fact, never the draft or final text", () => {
    const observation = createChannelPublishedReplyObservation({
      observedAt: NOW,
      publishedAt: NOW,
      eligible: true,
      wasDraft: true,
      generatedText: "Please keep the discussion civil.",
      finalText: "I will not engage with personal attacks; please keep the discussion focused.",
    });

    expect(observation).toMatchObject({
      kind: "published_reply",
      eligible: true,
      wasDraft: true,
      materiallyRewritten: true,
    });
    expect(observation).not.toHaveProperty("generatedText");
    expect(observation).not.toHaveProperty("finalText");
    expect(ChannelObservationSchema.safeParse(observation).success).toBe(true);
  });

  it("reports both rolling windows with observation-only rates", () => {
    const reviews: ChannelObservation[] = Array.from({ length: 50 }, (_, index) =>
      createChannelReviewObservation({
        observedAt: NOW,
        from: "Actionable Abuse",
        to: index === 0 ? "Allowed Criticism" : "Actionable Abuse",
        action: index === 0 ? "mark_allowed_criticism" : "confirm_actionable_abuse",
        activeInterfaceSeconds: 10,
      }),
    );
    const replies: ChannelObservation[] = Array.from({ length: 20 }, (_, index) =>
      createChannelPublishedReplyObservation({
        observedAt: NOW,
        publishedAt: daysBefore(1),
        eligible: true,
        wasDraft: true,
        materiallyRewritten: index === 0,
      }),
    );
    const deletions: ChannelObservation[] = Array.from({ length: 20 }, (_, index) =>
      createChannelReplyDeletionObservation({
        observedAt: NOW,
        publishedAt: daysBefore(8),
        deletedAt: index === 0 ? daysBefore(4) : index === 1 ? NOW : null,
      }),
    );
    const complaints: ChannelObservation[] = [
      createChannelComplaintObservation({ observedAt: NOW, confirmed: true }),
      createChannelComplaintObservation({ observedAt: NOW, confirmed: true }),
      createChannelComplaintObservation({ observedAt: NOW, confirmed: false }),
    ];
    const escalations: ChannelObservation[] = [
      createChannelEscalationObservation({
        observedAt: NOW,
        coverageStartedAt: "2026-08-31T10:00:00.000Z",
        coverageEndedAt: "2026-08-31T11:00:00.000Z",
        threadsObserved: 12,
      }),
    ];

    const report = buildChannelObservationReport({
      observations: [...reviews, ...replies, ...deletions, ...complaints, ...escalations],
      now: NOW,
    });

    expect(report.reportingMode).toBe("observational_only");
    expect(report.windows.sevenDay).toMatchObject({
      reviewedAssessments: 50,
      correctionRate: {
        numerator: 1,
        denominator: 50,
        rate: 0.02,
        suppressed: false,
      },
      reviewTime: {
        observations: 50,
        totalActiveInterfaceSeconds: 500,
        averageActiveInterfaceSeconds: 10,
      },
      eligiblePublicReplies: 20,
      publishedDrafts: 20,
      materialRewriteRate: {
        numerator: 1,
        denominator: 20,
        rate: 0.05,
        suppressed: false,
      },
      sevenDayDeletionRate: {
        numerator: 1,
        denominator: 20,
        rate: 0.05,
        suppressed: false,
      },
      complaintRate: {
        numerator: 2,
        denominator: 20,
        rate: 0.1,
        suppressed: false,
      },
      observedEscalation: {
        count: 1,
        threadsObserved: 12,
        coverageStartedAt: "2026-08-31T10:00:00.000Z",
        coverageEndedAt: "2026-08-31T11:00:00.000Z",
      },
    });
    expect(report.windows.thirtyDay).toMatchObject({
      windowDays: 30,
      reviewedAssessments: 50,
      eligiblePublicReplies: 20,
      correctionRate: { rate: 0.02 },
      complaintRate: { rate: 0.1 },
    });
    expect(report.windows.thirtyDay.windowStartedAt).toBe(
      "2026-08-01T12:00:00.000Z",
    );
    expect(report).not.toHaveProperty("channelId");
    expect(report).not.toHaveProperty("commentId");
    expect(report).not.toHaveProperty("providerReplyId");
  });

  it("suppresses assessment and reply rates below their governed sample floors", () => {
    const report = buildChannelObservationReport({
      observations: [
        ...Array.from({ length: CHANNEL_METRIC_MIN_REVIEWED_ASSESSMENTS - 1 }, () =>
          createChannelReviewObservation({
            observedAt: NOW,
            from: "Actionable Abuse",
            to: "Actionable Abuse",
            action: "confirm_actionable_abuse",
            activeInterfaceSeconds: 5,
          }),
        ),
        ...Array.from({ length: CHANNEL_METRIC_MIN_ELIGIBLE_PUBLIC_REPLIES - 1 }, () =>
          createChannelPublishedReplyObservation({
            observedAt: NOW,
            publishedAt: NOW,
            eligible: true,
            wasDraft: true,
            materiallyRewritten: false,
          }),
        ),
      ],
      now: NOW,
    });

    expect(report.windows.sevenDay.correctionRate).toMatchObject({
      rate: null,
      suppressed: true,
      suppressionReason: "minimum_reviewed_assessments",
    });
    expect(report.windows.sevenDay.materialRewriteRate).toMatchObject({
      rate: null,
      suppressed: true,
      suppressionReason: "minimum_eligible_public_replies",
    });
    expect(report.windows.sevenDay.complaintRate).toMatchObject({
      rate: null,
      suppressed: true,
      suppressionReason: "minimum_eligible_public_replies",
    });
    expect(report.windows.sevenDay.reviewTime.averageActiveInterfaceSeconds).toBe(5);
    expect(report.windows.sevenDay.observedEscalation.count).toBe(0);
  });

  it("keeps an observation in the 30-day window while excluding it from the 7-day window", () => {
    const report = buildChannelObservationReport({
      observations: [
        createChannelReviewObservation({
          observedAt: daysBefore(8),
          from: "Actionable Abuse",
          to: "Actionable Abuse",
          action: "confirm_actionable_abuse",
          activeInterfaceSeconds: 12,
        }),
      ],
      now: NOW,
    });

    expect(report.windows.sevenDay.reviewedAssessments).toBe(0);
    expect(report.windows.thirtyDay.reviewedAssessments).toBe(1);
  });
});
