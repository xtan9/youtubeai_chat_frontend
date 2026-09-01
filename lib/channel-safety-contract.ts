export const SAFETY_FLAG_REASONS = [
  "threat",
  "self_harm_encouragement",
  "doxxing",
  "stalking",
  "extortion",
  "sexual_harassment",
  "protected_class_hate",
  "minor_risk",
  "credible_real_world_danger",
  "severe_harm_uncertain",
] as const;

export type SafetyFlagReason = (typeof SAFETY_FLAG_REASONS)[number];

export const SAFETY_EVIDENCE_REVEAL_WARNING =
  "This may reveal personal information. Reveal it only when necessary for a safety action.";

export const SAFETY_EVIDENCE_REVEAL_PURPOSES = [
  "youtube_enforcement",
  "real_world_safety",
] as const;

export type SafetyEvidenceRevealPurpose =
  (typeof SAFETY_EVIDENCE_REVEAL_PURPOSES)[number];

export type SafetyEvidenceRevealConfirmation = Readonly<{
  warningAcknowledged: boolean;
  purpose: SafetyEvidenceRevealPurpose;
}>;
