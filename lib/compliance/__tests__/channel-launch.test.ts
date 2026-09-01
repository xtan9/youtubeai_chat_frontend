import { describe, expect, it } from "vitest";

import {
  ChannelLaunchPacketSchema,
  CURRENT_CHANNEL_LAUNCH_PACKET,
  evaluateChannelLaunchGate,
} from "../channel-launch";
import {
  CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
  evaluateYouTubeChannelOAuthVerificationGate,
} from "../youtube-channel-oauth-verification";

const EVIDENCE = "https://evidence.example/channel-launch";

function evidenceGate() {
  return { status: "verified" as const, evidenceRef: EVIDENCE };
}

function verifiedPacket() {
  return {
    ...CURRENT_CHANNEL_LAUNCH_PACKET,
    gates: {
      youtubeCompliance: evidenceGate(),
      oauthVerification: evidenceGate(),
      liveDisclosures: {
        status: "live_verified" as const,
        repositoryPath: "app/privacy/page.tsx",
        canonicalPath: "/privacy",
        expectedCanonicalUrl: "https://youtubeai.chat/privacy",
        liveUrls: ["https://youtubeai.chat/privacy"],
        evidenceRef: EVIDENCE,
      },
      offlineQuality: evidenceGate(),
      lifecycleEvidence: evidenceGate(),
      retentionEvidence: evidenceGate(),
      accessibilityEvidence: evidenceGate(),
      quotaLoadEvidence: evidenceGate(),
      productionReadinessEvidence: evidenceGate(),
    },
  };
}

function verifiedOAuthRecord() {
  return {
    ...CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
    status: "verified" as const,
    verificationEvidence: {
      sourceReference: EVIDENCE,
      verifiedAt: "2026-09-01",
      verifiedBy: "Google verification authority (test fixture)",
    },
  };
}

const VERIFIED_COMPLIANCE = {
  decision: "permitted" as const,
  recordType:
    "youtube-channel-comment-assistance-compliance-clearance" as const,
  recordVersion: 1 as const,
  issueNumber: 470 as const,
  sourceSpec: {
    path: "docs/specs/2026-08-31-comment-assistance-discovery.md" as const,
    url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
  },
  packet: {
    issueNumber: 469 as const,
    status: "reviewed" as const,
    artifactPath:
      "docs/compliance/youtube-channel-comment-assistance-audit-packet.md",
    revision: "reviewed-packet-revision",
    reviewedAt: "2026-09-01",
    reviewedBy: "YouTube authority (test fixture)",
  },
  determination: {
    responseDate: "2026-09-01",
    reviewerOrAuthority: "YouTube authority (test fixture)",
    applicablePolicies: ["YouTube policy (test fixture)"],
    permittedScope: "The approved Channel scope (test fixture).",
    prohibitedScope: "Out-of-scope actions (test fixture).",
    sourceReference: EVIDENCE,
    verbatimResponse: "Written response (test fixture).",
  },
  coverage: {
    customPerCommentBehavioralAssessment: true as const,
    modelProviderFlow: true as const,
    retentionApproach: true as const,
  },
  conditions: [] as const,
};

describe("Channel comment-assistance launch packet", () => {
  it("keeps the checked-in packet blocked on external verification, live disclosure, and release evidence", () => {
    expect(ChannelLaunchPacketSchema.safeParse(CURRENT_CHANNEL_LAUNCH_PACKET).success).toBe(
      true,
    );

    const gate = evaluateChannelLaunchGate(CURRENT_CHANNEL_LAUNCH_PACKET);
    expect(gate.status).toBe("blocked");
    if (gate.status === "open") throw new Error("expected a blocked packet");
    expect(gate.blockedGates).toEqual(
      expect.arrayContaining([
        "youtube_compliance",
        "oauth_verification",
        "live_disclosures",
        "offline_quality",
        "retention",
        "production_readiness",
      ]),
    );
  });

  it("requires live URLs and evidence rather than treating repository copy as live publication", () => {
    const packet = verifiedPacket();
    expect(
      ChannelLaunchPacketSchema.safeParse({
        ...packet,
        gates: {
          ...packet.gates,
          liveDisclosures: {
            ...packet.gates.liveDisclosures,
            liveUrls: [],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("pins the launch packet to the approved discovery specification URL", () => {
    expect(
      ChannelLaunchPacketSchema.safeParse({
        ...CURRENT_CHANNEL_LAUNCH_PACKET,
        sourceSpec: {
          ...CURRENT_CHANNEL_LAUNCH_PACKET.sourceSpec,
          url: "https://attacker.example/specification",
        },
      }).success,
    ).toBe(false);
  });

  it("opens only when packet evidence and both current external gates are explicitly verified", () => {
    const packet = verifiedPacket();
    const gate = evaluateChannelLaunchGate(packet, {
      oauthVerification: verifiedOAuthRecord(),
      youtubeCompliance: VERIFIED_COMPLIANCE,
    });

    expect(gate).toEqual({
      status: "open",
      reason: "Every Channel release gate has explicit evidence.",
    });
  });

  it("keeps a syntactically verified packet blocked when OAuth evidence does not match the implemented contract", () => {
    const packet = verifiedPacket();
    const mismatchedOAuth = {
      ...verifiedOAuthRecord(),
      contract: {
        ...verifiedOAuthRecord().contract,
        authorizedDomains: ["attacker.example"],
      },
    };

    expect(evaluateYouTubeChannelOAuthVerificationGate(mismatchedOAuth)).toMatchObject({
      status: "blocked",
    });
    expect(
      evaluateChannelLaunchGate(packet, {
        oauthVerification: mismatchedOAuth,
        youtubeCompliance: {},
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("does not open when packet evidence points at a different OAuth record", () => {
    const packet = verifiedPacket();
    const mismatchedEvidencePacket = {
      ...packet,
      gates: {
        ...packet.gates,
        oauthVerification: {
          ...packet.gates.oauthVerification,
          evidenceRef: "https://evidence.example/another-verification",
        },
      },
    };

    expect(
      evaluateChannelLaunchGate(mismatchedEvidencePacket, {
        oauthVerification: verifiedOAuthRecord(),
        youtubeCompliance: VERIFIED_COMPLIANCE,
      }),
    ).toMatchObject({ status: "blocked" });
  });
});
