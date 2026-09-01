import { describe, expect, it } from "vitest";

import {
  enforceReplyDraftBoundary,
  enforceSafetyFlagDominance,
  isReplyDraftAllowed,
  type SafetyFlagReason,
} from "../safety";

const SAFETY_REASONS: readonly SafetyFlagReason[] = [
  "threat",
  "self_harm_encouragement",
  "doxxing",
  "stalking",
  "extortion",
  "sexual_harassment",
  "protected_class_hate",
  "minor_risk",
  "credible_real_world_danger",
];

describe("Channel Safety Flag policy", () => {
  it.each(SAFETY_REASONS)(
    "makes %s dominant and response-blocking",
    (reason) => {
      const assessment = enforceSafetyFlagDominance({
        requestedClassification: "Actionable Abuse",
        target: "channel_steward",
        severity: "non_severe",
        safetyReasons: [reason],
        contextSufficient: true,
      });

      expect(assessment).toMatchObject({
        classification: "Safety Flag",
        severity: "severe",
        safetyReasons: [reason],
        replyDraft: null,
        replyDraftAllowed: false,
      });
      expect(assessment.classification).not.toBe("Actionable Abuse");
      expect(assessment.classification).not.toBe("Reviewable Interaction");
      expect(assessment.classification).not.toBe("Allowed Criticism");
    },
  );

  it("fails safe when severe harm is plausible but context is insufficient", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Reviewable Interaction",
      target: "ambiguous",
      severity: "unknown",
      severeHarmPlausible: true,
      contextSufficient: false,
    });

    expect(assessment).toMatchObject({
      classification: "Safety Flag",
      severity: "severe",
      safetyReasons: ["severe_harm_uncertain"],
      replyDraft: null,
      replyDraftAllowed: false,
    });
  });

  it("turns severe harm into a Safety Flag even when the model requests another class", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Allowed Criticism",
      target: "other",
      severity: "severe",
      contextSufficient: true,
    });

    expect(assessment.classification).toBe("Safety Flag");
    expect(assessment.safetyReasons).toEqual([
      "credible_real_world_danger",
    ]);
  });

  it("keeps a confirmed non-severe Steward-targeted abuse assessment draft-eligible", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Actionable Abuse",
      target: "channel_steward",
      severity: "non_severe",
      contextSufficient: true,
    });

    expect(assessment).toMatchObject({
      classification: "Actionable Abuse",
      target: "channel_steward",
      severity: "non_severe",
      replyDraft: null,
      replyDraftAllowed: true,
    });
  });

  it("does not allow a non-Steward target to become Actionable Abuse", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Actionable Abuse",
      target: "other",
      severity: "non_severe",
      contextSufficient: true,
    });

    expect(assessment).toMatchObject({
      classification: "Reviewable Interaction",
      replyDraft: null,
      replyDraftAllowed: false,
    });
  });

  it("fails closed when context is explicitly insufficient", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Actionable Abuse",
      target: "channel_steward",
      severity: "non_severe",
      contextSufficient: false,
    });

    expect(assessment).toMatchObject({
      classification: "Reviewable Interaction",
      replyDraft: null,
      replyDraftAllowed: false,
    });
  });

  it("does not grant a draft when severity metadata is unknown", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Actionable Abuse",
      target: "channel_steward",
      severity: "not-a-severity",
      contextSufficient: true,
    });

    expect(assessment).toMatchObject({
      classification: "Reviewable Interaction",
      replyDraft: null,
      replyDraftAllowed: false,
    });
  });

  it("fails safe when safety metadata is malformed", () => {
    const assessment = enforceSafetyFlagDominance({
      requestedClassification: "Allowed Criticism",
      target: "other",
      severity: "non_severe",
      safetyReasons: "threat",
      contextSufficient: true,
    });

    expect(assessment).toMatchObject({
      classification: "Safety Flag",
      severity: "severe",
      safetyReasons: ["credible_real_world_danger"],
      replyDraft: null,
      replyDraftAllowed: false,
    });
  });
});

describe("Safety Flag Reply Draft boundary", () => {
  const safetyFlag = enforceSafetyFlagDominance({
    requestedClassification: "Safety Flag",
    target: "channel_steward",
    severity: "severe",
    safetyReasons: ["threat"],
    contextSufficient: true,
  });

  it.each(["request", "receive", "publish"] as const)(
    "blocks a Safety Flag at the %s boundary and returns no draft",
    (action) => {
      const result = enforceReplyDraftBoundary({
        assessment: safetyFlag,
        action,
        draft: "A draft that must never escape.",
      });

      expect(result).toEqual({
        status: "blocked",
        reason: "safety_flag",
        draft: null,
      });
    },
  );

  it("still blocks a forged severe assessment before any draft lifecycle action", () => {
    const forgedAssessment = {
      classification: "Actionable Abuse",
      target: "channel_steward",
      severity: "severe",
      safetyReasons: ["threat"],
      replyDraft: null,
      replyDraftAllowed: true,
    } as unknown as Parameters<
      typeof enforceReplyDraftBoundary
    >[0]["assessment"];

    expect(isReplyDraftAllowed(forgedAssessment)).toBe(false);
    expect(
      enforceReplyDraftBoundary({
        assessment: forgedAssessment,
        action: "publish",
        draft: "Never publish this.",
      }),
    ).toEqual({
      status: "blocked",
      reason: "safety_flag",
      draft: null,
    });
  });
});
