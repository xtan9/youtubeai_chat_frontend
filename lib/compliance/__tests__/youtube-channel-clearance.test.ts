import { describe, expect, it } from "vitest";

import {
  CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  YouTubeComplianceClearanceSchema,
  evaluateYouTubeChannelAssessmentGate,
} from "@/lib/compliance/youtube-channel-clearance";

const reviewedPacket = {
  issueNumber: 469,
  status: "reviewed" as const,
  artifactPath:
    "docs/compliance/youtube-channel-comment-assistance-audit-packet.md",
  revision: "packet-revision-for-test",
  reviewedAt: "2026-09-01",
  reviewedBy: "Blocking issue reviewer (test fixture)",
};

const determination = {
  responseDate: "2026-09-01",
  reviewerOrAuthority: "YouTube API Compliance Audit authority (test fixture)",
  applicablePolicies: [
    "YouTube API Services Developer Policies (test fixture)",
    "YouTube Derived Metrics Policy (test fixture)",
  ],
  permittedScope:
    "Per-comment behavioral assessment for a Channel Steward (test fixture).",
  prohibitedScope:
    "Author scoring, author profiling, autonomous replies, and private moderation queues (test fixture).",
  sourceReference: "test://youtube-compliance-response",
  verbatimResponse:
    "Test fixture: the exact written determination is preserved here.",
};

function buildBase() {
  return {
    recordType: "youtube-channel-comment-assistance-compliance-clearance",
    recordVersion: 1,
    issueNumber: 470,
    sourceSpec: {
      path: "docs/specs/2026-08-31-comment-assistance-discovery.md",
      url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
    },
    packet: reviewedPacket,
    determination,
  };
}

function buildPermitted(coverage = {
  customPerCommentBehavioralAssessment: true,
  modelProviderFlow: true,
  retentionApproach: true,
}) {
  return {
    ...buildBase(),
    decision: "permitted" as const,
    coverage,
    conditions: [],
  };
}

describe("YouTube Channel compliance clearance", () => {
  it("keeps the checked-in clearance blocked until the external determination exists", () => {
    expect(CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE.decision).toBe(
      "pending_external_determination",
    );
    expect(
      evaluateYouTubeChannelAssessmentGate(
        CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
      ),
    ).toMatchObject({ status: "blocked" });
  });

  it("requires all three permitted-scope coverage statements", () => {
    const incomplete = buildPermitted({
      customPerCommentBehavioralAssessment: true,
      modelProviderFlow: true,
      retentionApproach: false,
    });

    expect(YouTubeComplianceClearanceSchema.safeParse(incomplete).success).toBe(
      false,
    );
    expect(evaluateYouTubeChannelAssessmentGate(incomplete)).toMatchObject({
      status: "blocked",
    });
  });

  it("opens a fully documented permitted determination", () => {
    const clearance = buildPermitted();

    expect(YouTubeComplianceClearanceSchema.safeParse(clearance).success).toBe(
      true,
    );
    expect(evaluateYouTubeChannelAssessmentGate(clearance)).toEqual({
      status: "open",
      decision: "permitted",
      reason: "The written permitted determination covers the approved Channel assessment scope.",
    });
  });

  it("keeps every open conditional prerequisite blocking", () => {
    const clearance = {
      ...buildBase(),
      decision: "conditional" as const,
      coverage: {
        customPerCommentBehavioralAssessment: true,
        modelProviderFlow: true,
        retentionApproach: true,
      },
      conditions: [
        {
          id: "launch-retention-verification",
          prerequisite: "launch" as const,
          description: "Verify the 30-day refresh or deletion workflow.",
          status: "open" as const,
        },
        {
          id: "implementation-provider-contract",
          prerequisite: "implementation" as const,
          description: "Complete the disclosed no-training provider contract.",
          status: "open" as const,
        },
      ],
    };

    expect(YouTubeComplianceClearanceSchema.safeParse(clearance).success).toBe(
      true,
    );
    expect(evaluateYouTubeChannelAssessmentGate(clearance)).toEqual({
      status: "blocked",
      decision: "conditional",
      reason:
        "Conditional clearance prerequisites remain open: launch-retention-verification, implementation-provider-contract.",
    });
  });

  it("opens a conditional determination only after every prerequisite is evidenced", () => {
    const clearance = {
      ...buildBase(),
      decision: "conditional" as const,
      coverage: {
        customPerCommentBehavioralAssessment: true,
        modelProviderFlow: true,
        retentionApproach: true,
      },
      conditions: [
        {
          id: "launch-retention-verification",
          prerequisite: "launch" as const,
          description: "Verify the 30-day refresh or deletion workflow.",
          status: "satisfied" as const,
          evidenceRef: "docs/evidence/retention-verification.md",
        },
      ],
    };

    expect(YouTubeComplianceClearanceSchema.safeParse(clearance).success).toBe(
      true,
    );
    expect(evaluateYouTubeChannelAssessmentGate(clearance)).toEqual({
      status: "open",
      decision: "conditional",
      reason: "All written conditional clearance prerequisites are evidenced.",
    });
  });

  it("preserves rejection as a hard no-go", () => {
    const clearance = {
      ...buildBase(),
      decision: "rejected" as const,
      conditions: [],
      noGo: {
        outcome: "Custom per-comment assessment is not permitted.",
        integrationStatus: "blocked" as const,
      },
    };

    expect(YouTubeComplianceClearanceSchema.safeParse(clearance).success).toBe(
      true,
    );
    expect(evaluateYouTubeChannelAssessmentGate(clearance)).toEqual({
      status: "blocked",
      decision: "rejected",
      reason:
        "The written determination rejects the approved Channel assessment scope; real YouTube API Data assessment remains blocked.",
    });
  });

  it("fails closed for malformed or unreviewed records", () => {
    expect(
      evaluateYouTubeChannelAssessmentGate({ decision: "permitted" }),
    ).toEqual({
      status: "blocked",
      reason: "The YouTube compliance clearance record is invalid or incomplete.",
    });

    const unreviewed = {
      ...buildPermitted(),
      packet: {
        issueNumber: 469,
        status: "not_available" as const,
        reason: "The blocking issue has not produced its reviewed packet.",
      },
    };

    expect(YouTubeComplianceClearanceSchema.safeParse(unreviewed).success).toBe(
      false,
    );
    expect(evaluateYouTubeChannelAssessmentGate(unreviewed)).toMatchObject({
      status: "blocked",
    });
  });
});
