import { z } from "zod";

import {
  SAFETY_FLAG_REASONS,
  type SafetyFlagReason,
} from "../channel-safety-contract";
import {
  ChannelAssessmentCategorySchema,
  ChannelAssessmentTargetSchema,
  type ChannelAssessmentCategory,
  type ChannelAssessmentSeverity,
  type ChannelAssessmentTarget,
} from "./domain";

export const SAFETY_FLAG_LABEL = "Safety Flag" as const;

export { SAFETY_FLAG_REASONS } from "../channel-safety-contract";
export type { SafetyFlagReason } from "../channel-safety-contract";

export const SafetyFlagReasonSchema = z.enum(SAFETY_FLAG_REASONS);
export {
  ChannelAssessmentCategorySchema,
  ChannelAssessmentTargetSchema,
} from "./domain";
export type {
  ChannelAssessmentCategory,
  ChannelAssessmentSeverity,
  ChannelAssessmentTarget,
} from "./domain";

/**
 * The normalized fields accepted from an assessment adapter or model.
 * Unknown values are intentionally allowed at this seam so the normalizer
 * can fail safe instead of allowing an unvalidated response to authorize a
 * draft.
 */
export type RawChannelAssessment = Readonly<{
  requestedClassification?: unknown;
  /** `classification` is accepted for adapters that use the domain name. */
  classification?: unknown;
  target?: unknown;
  severity?: unknown;
  safetyReasons?: unknown;
  severeHarmPlausible?: unknown;
  contextSufficient?: unknown;
}>;

export type SafetyFlagAssessment = Readonly<{
  classification: typeof SAFETY_FLAG_LABEL;
  target: ChannelAssessmentTarget;
  severity: "severe";
  safetyReasons: readonly SafetyFlagReason[];
  replyDraft: null;
  replyDraftAllowed: false;
}>;

export type NonSafetyAssessment = Readonly<{
  classification: Exclude<ChannelAssessmentCategory, typeof SAFETY_FLAG_LABEL>;
  target: ChannelAssessmentTarget;
  severity: "non_severe";
  safetyReasons: readonly [];
  replyDraft: null;
  replyDraftAllowed: boolean;
}>;

export type ChannelAssessmentDecision =
  | SafetyFlagAssessment
  | NonSafetyAssessment;

function parseTarget(value: unknown): ChannelAssessmentTarget {
  const parsed = ChannelAssessmentTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : "ambiguous";
}

function parseRequestedClassification(
  input: RawChannelAssessment,
): ChannelAssessmentCategory | null {
  const value = input.requestedClassification ?? input.classification;
  const parsed = ChannelAssessmentCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseSeverity(value: unknown): ChannelAssessmentSeverity | "unknown" {
  if (value === "severe" || value === "non_severe") return value;
  return "unknown";
}

type ParsedSafetyReasons = Readonly<{
  reasons: SafetyFlagReason[];
  malformed: boolean;
}>;

function parseSafetyReasons(reasons: unknown): ParsedSafetyReasons {
  if (reasons === undefined) return { reasons: [], malformed: false };
  if (!Array.isArray(reasons)) return { reasons: [], malformed: true };

  const normalized: SafetyFlagReason[] = [];
  let malformed = false;
  for (const reason of reasons) {
    const parsed = SafetyFlagReasonSchema.safeParse(reason);
    if (!parsed.success) {
      malformed = true;
    } else if (!normalized.includes(parsed.data)) {
      normalized.push(parsed.data);
    }
  }
  return { reasons: normalized, malformed };
}

/**
 * Applies the severe-risk rule after an adapter/model response has been
 * produced. Safety is deliberately dominant: a Safety Flag is the only
 * classification in the returned object, has no draft, and cannot authorize
 * a response regardless of target or the requested lower-risk class.
 */
export function enforceSafetyFlagDominance(
  input: RawChannelAssessment,
): ChannelAssessmentDecision {
  const requestedClassification = parseRequestedClassification(input);
  const target = parseTarget(input.target);
  const severity = parseSeverity(input.severity);
  const parsedSafetyReasons = parseSafetyReasons(input.safetyReasons);
  const safetyReasons = parsedSafetyReasons.reasons;
  const severeHarmPlausible = input.severeHarmPlausible === true;
  const contextIsUncertain =
    input.contextSufficient !== undefined && input.contextSufficient !== true;

  const safetyFlag =
    requestedClassification === SAFETY_FLAG_LABEL ||
    severity === "severe" ||
    safetyReasons.length > 0 ||
    severeHarmPlausible ||
    parsedSafetyReasons.malformed;

  if (safetyFlag) {
    const fallbackReason: SafetyFlagReason = severeHarmPlausible
      ? "severe_harm_uncertain"
      : "credible_real_world_danger";
    const reasons = safetyReasons.length > 0 ? safetyReasons : [fallbackReason];

    return {
      classification: SAFETY_FLAG_LABEL,
      target,
      severity: "severe",
      safetyReasons: Object.freeze(reasons),
      replyDraft: null,
      replyDraftAllowed: false,
    };
  }

  const requested = requestedClassification ?? "Reviewable Interaction";
  const classification: Exclude<
    ChannelAssessmentCategory,
    typeof SAFETY_FLAG_LABEL
  > =
    requested === "Actionable Abuse" &&
    target === "channel_steward" &&
    severity === "non_severe" &&
    !contextIsUncertain
      ? "Actionable Abuse"
      : requested === "Allowed Criticism"
        ? "Allowed Criticism"
        : "Reviewable Interaction";
  const replyDraftAllowed = classification === "Actionable Abuse";

  return {
    classification,
    target,
    severity: "non_severe",
    safetyReasons: [],
    replyDraft: null,
    replyDraftAllowed,
  };
}

export type ReplyDraftAction = "request" | "receive" | "publish";

export type ReplyDraftBoundaryResult =
  | Readonly<{
      status: "blocked";
      reason: "safety_flag" | "assessment_not_draft_eligible" | "missing_draft";
      draft: null;
    }>
  | Readonly<{
      status: "allowed";
      draft: string | null;
    }>;

function isDraftEligibleAssessment(
  assessment: ChannelAssessmentDecision,
): boolean {
  const safetyReasons: unknown = assessment.safetyReasons;
  return (
    assessment.classification === "Actionable Abuse" &&
    assessment.replyDraftAllowed === true &&
    assessment.target === "channel_steward" &&
    assessment.severity === "non_severe" &&
    assessment.replyDraft === null &&
    Array.isArray(safetyReasons) &&
    safetyReasons.length === 0
  );
}

/**
 * One guard for every draft lifecycle seam. Callers must use it before
 * requesting a draft, accepting a model response, or publishing final text.
 * A Safety Flag is checked first so a forged or stale `replyDraftAllowed`
 * value cannot reopen the response path.
 */
export function enforceReplyDraftBoundary(input: {
  assessment: ChannelAssessmentDecision;
  action: ReplyDraftAction;
  draft?: unknown;
}): ReplyDraftBoundaryResult {
  const classification: unknown = input.assessment.classification;
  const severity: unknown = input.assessment.severity;
  const safetyReasons: unknown = input.assessment.safetyReasons;
  const hasMalformedSafetyReasons = !Array.isArray(safetyReasons);
  const hasSafetySignal =
    classification === SAFETY_FLAG_LABEL ||
    severity === "severe" ||
    hasMalformedSafetyReasons ||
    (Array.isArray(safetyReasons) && safetyReasons.length > 0);

  if (hasSafetySignal) {
    return { status: "blocked", reason: "safety_flag", draft: null };
  }

  if (!isDraftEligibleAssessment(input.assessment)) {
    return {
      status: "blocked",
      reason: "assessment_not_draft_eligible",
      draft: null,
    };
  }

  if (input.action === "request") {
    return { status: "allowed", draft: null };
  }

  if (typeof input.draft !== "string" || input.draft.trim().length === 0) {
    return { status: "blocked", reason: "missing_draft", draft: null };
  }

  return { status: "allowed", draft: input.draft.trim() };
}

export function isReplyDraftAllowed(
  assessment: ChannelAssessmentDecision,
): boolean {
  return isDraftEligibleAssessment(assessment);
}
