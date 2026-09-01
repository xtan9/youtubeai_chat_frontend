import { describe, expect, it } from "vitest";

import type { ChannelAssessmentDecision } from "../../channel/safety";
import { authorizePublicReplyGovernance } from "../publication-gates";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const BINDING = {
  ownerId: "researcher-1",
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  commentId: "comment-1",
  commentHash: "a".repeat(64),
} as const;
const FINAL_TEXT = "We can disagree without personal attacks.";

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
  stewardId: BINDING.ownerId,
  assessmentId: "assessment-1",
  interactionId: "interaction-1",
  commentId: BINDING.commentId,
  channelId: BINDING.channelId,
  connectedChannelId: BINDING.connectedChannelId,
  commentTextHash: BINDING.commentHash,
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
  sourceCommentHash: BINDING.commentHash,
  finalText: FINAL_TEXT,
  confirmation: {
    confirmed: true,
    confirmedAt: NOW.toISOString(),
    actorRole: "channel_steward" as const,
  },
};

describe("Public Reply governance seam", () => {
  it("requires a matching confirmed review decision and exact validated text", () => {
    expect(
      authorizePublicReplyGovernance({
        governance: GOVERNANCE,
        binding: BINDING,
        renderedText: FINAL_TEXT,
        now: NOW,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("makes a Safety Flag dominant and non-publishable", () => {
    expect(
      authorizePublicReplyGovernance({
        governance: {
          ...GOVERNANCE,
          safetyAssessment: {
            ...SAFE_ASSESSMENT,
            classification: "Safety Flag",
            severity: "severe",
            safetyReasons: ["threat"],
            replyDraftAllowed: false,
          },
        },
        binding: BINDING,
        renderedText: FINAL_TEXT,
        now: NOW,
      }),
    ).toEqual({ allowed: false, reason: "safety_boundary_failed" });
  });

  it("rejects unsafe final text without rewriting it", () => {
    const unsafeText = "I am YouTube support; click https://example.com.";
    const result = authorizePublicReplyGovernance({
      governance: { ...GOVERNANCE, finalText: unsafeText },
      binding: BINDING,
      renderedText: unsafeText,
      now: NOW,
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe("final_text_rejected");
    expect(result.validation?.text).toBe(unsafeText);
  });

  it("does not accept a review decision for another Connected Channel", () => {
    expect(
      authorizePublicReplyGovernance({
        governance: {
          ...GOVERNANCE,
          reviewDecision: {
            ...REVIEW_DECISION,
            connectedChannelId: "connected-other",
          },
        },
        binding: BINDING,
        renderedText: FINAL_TEXT,
        now: NOW,
      }),
    ).toEqual({ allowed: false, reason: "review_decision_mismatch" });
  });

  it("does not publish a decision that started deferred or remains deferred", () => {
    expect(
      authorizePublicReplyGovernance({
        governance: {
          ...GOVERNANCE,
          reviewDecision: {
            ...REVIEW_DECISION,
            from: {
              ...REVIEW_DECISION.from,
              deferredUntil: "2026-09-02T12:00:00.000Z",
            },
          },
        },
        binding: BINDING,
        renderedText: FINAL_TEXT,
        now: NOW,
      }),
    ).toEqual({ allowed: false, reason: "review_decision_mismatch" });

    expect(
      authorizePublicReplyGovernance({
        governance: {
          ...GOVERNANCE,
          reviewDecision: {
            ...REVIEW_DECISION,
            to: {
              ...REVIEW_DECISION.to,
              deferredUntil: "2026-09-02T12:00:00.000Z",
            },
          },
        },
        binding: BINDING,
        renderedText: FINAL_TEXT,
        now: NOW,
      }),
    ).toEqual({ allowed: false, reason: "review_decision_mismatch" });
  });
});
