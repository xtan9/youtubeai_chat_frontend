import { z } from "zod";
import {
  validateFinalPublicReplyText,
  type FinalTextValidation,
} from "../channel/publication";
import {
  enforceReplyDraftBoundary,
  type ChannelAssessmentDecision,
} from "../channel/safety";
import { ReviewDecisionProvenanceSchema } from "../channel/review-decisions";
import type { ChannelWorkBinding } from "./records";

const ConfirmationSchema = z
  .object({
    confirmed: z.literal(true),
    confirmedAt: z.string().datetime({ offset: true }),
    actorRole: z.literal("channel_steward"),
  })
  .strict();

/**
 * Server-owned evidence required by the real publication seam. The fields are
 * deliberately opaque at the caller boundary: this module validates the
 * review and safety records instead of trusting a UI-shaped boolean.
 */
export type PublicReplyPublicationGovernance = Readonly<{
  reviewDecision: unknown;
  safetyAssessment: unknown;
  sourceCommentHash: string;
  finalText: string;
  confirmation: unknown;
}>;

export type PublicReplyGovernanceDecision =
  | Readonly<{
      allowed: true;
      validation: Readonly<{
        finalText: FinalTextValidation;
        renderedText: FinalTextValidation;
      }>;
    }>
  | Readonly<{
      allowed: false;
      reason:
        | "review_decision_required"
        | "review_decision_mismatch"
        | "safety_boundary_failed"
        | "explicit_confirmation_required"
        | "final_text_rejected"
        | "invalid_clock";
      validation?: FinalTextValidation;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidSafetyAssessment(
  value: unknown,
): value is ChannelAssessmentDecision {
  if (!isRecord(value)) return false;
  const classification = value.classification;
  const target = value.target;
  const severity = value.severity;
  const safetyReasons = value.safetyReasons;
  return (
    (classification === "Safety Flag" ||
      classification === "Actionable Abuse" ||
      classification === "Reviewable Interaction" ||
      classification === "Allowed Criticism") &&
    (target === "channel_steward" ||
      target === "other" ||
      target === "ambiguous") &&
    (severity === "severe" || severity === "non_severe") &&
    Array.isArray(safetyReasons) &&
    value.replyDraft === null &&
    typeof value.replyDraftAllowed === "boolean"
  );
}

function hasValidConfirmation(value: unknown, now: Date): boolean {
  const parsed = ConfirmationSchema.safeParse(value);
  if (!parsed.success) return false;
  return Date.parse(parsed.data.confirmedAt) <= now.getTime();
}

function hasMatchingReviewDecision(
  value: unknown,
  binding: ChannelWorkBinding,
  now: Date,
): boolean {
  const parsed = ReviewDecisionProvenanceSchema.safeParse(value);
  if (!parsed.success) return false;
  const decision = parsed.data;
  const recordedAt = Date.parse(decision.recordedAt);
  const expiresAt = Date.parse(decision.expiresAt);
  return (
    decision.action === "confirm_actionable_abuse" &&
    decision.stateChanged === true &&
    decision.actorRole === "channel_steward" &&
    (decision.from.classification === "reviewable_interaction" ||
      decision.from.classification === "actionable_abuse") &&
    (decision.from.status === "reviewable" ||
      decision.from.status === "actionable") &&
    decision.from.deferredUntil === null &&
    decision.stewardId === binding.ownerId &&
    decision.channelId === binding.channelId &&
    decision.connectedChannelId === binding.connectedChannelId &&
    decision.commentId === binding.commentId &&
    decision.commentTextHash === binding.commentHash &&
    decision.to.classification === "actionable_abuse" &&
    decision.to.status === "actionable" &&
    decision.to.deferredUntil === null &&
    Number.isFinite(recordedAt) &&
    Number.isFinite(expiresAt) &&
    recordedAt <= now.getTime() &&
    expiresAt > now.getTime()
  );
}

/**
 * Validate the review, safety, consent, and exact final text immediately
 * before a provider claim. The rendered text is checked separately because a
 * nested reply may receive a deterministic display-name prefix after model
 * generation.
 */
export function authorizePublicReplyGovernance(input: Readonly<{
  governance: PublicReplyPublicationGovernance | null | undefined;
  binding: ChannelWorkBinding;
  renderedText: unknown;
  now: Date;
}>): PublicReplyGovernanceDecision {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    return { allowed: false, reason: "invalid_clock" };
  }

  const governance = input.governance;
  if (!governance || !isValidSafetyAssessment(governance.safetyAssessment)) {
    return { allowed: false, reason: "safety_boundary_failed" };
  }

  const safetyBoundary = enforceReplyDraftBoundary({
    assessment: governance.safetyAssessment,
    action: "publish",
    draft: input.renderedText,
  });
  if (safetyBoundary.status !== "allowed") {
    return { allowed: false, reason: "safety_boundary_failed" };
  }

  if (!hasMatchingReviewDecision(governance.reviewDecision, input.binding, input.now)) {
    return {
      allowed: false,
      reason: governance.reviewDecision
        ? "review_decision_mismatch"
        : "review_decision_required",
    };
  }

  if (
    governance.sourceCommentHash !== input.binding.commentHash ||
    !hasValidConfirmation(governance.confirmation, input.now)
  ) {
    return {
      allowed: false,
      reason: hasValidConfirmation(governance.confirmation, input.now)
        ? "review_decision_mismatch"
        : "explicit_confirmation_required",
    };
  }

  const finalTextValidation = validateFinalPublicReplyText(governance.finalText);
  if (!finalTextValidation.valid) {
    return {
      allowed: false,
      reason: "final_text_rejected",
      validation: finalTextValidation,
    };
  }

  const renderedTextValidation = validateFinalPublicReplyText(input.renderedText);
  if (!renderedTextValidation.valid) {
    return {
      allowed: false,
      reason: "final_text_rejected",
      validation: renderedTextValidation,
    };
  }

  return {
    allowed: true,
    validation: {
      finalText: finalTextValidation,
      renderedText: renderedTextValidation,
    },
  };
}
