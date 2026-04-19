// youtubeai_chat_frontend/lib/services/model-routing.ts

// Two-tier routing for YouTube summarization: token count gates the obvious
// cases (very short → Haiku, very long → Sonnet), classifier handles the
// middle zone, dimensions map to a model via rules. See
// docs/superpowers/specs/2026-04-19-model-routing-design.md for rationale.

import type { PromptLocale } from "./summarize-cache";

export const HAIKU = "claude-haiku-4-5";
export const SONNET = "claude-sonnet-4-6";

// Rough estimator: one English word ≈ 1.3 Claude tokens. Good enough for
// routing thresholds; the actual tokenizer would add a gateway round trip we
// don't need.
export const TOKENS_PER_WORD = 1.3;

// Below this we don't bother classifying — short content never shows a
// noticeable Haiku vs Sonnet quality gap.
export const SHORT_TOKENS = 5_000;

// Above this we force Sonnet. Haiku's context ceiling is 200K, so 150K
// leaves prompt-overhead headroom AND matches the research finding that
// Haiku drifts on long content.
export const LONG_TOKENS = 150_000;

// Threshold used only when the classifier failed — we still want token
// count to pick something reasonable.
export const FALLBACK_HAIKU_TOKENS = 25_000;

// Character budgets for prompt truncation (replaces the old 15_000 cap).
// Roughly chars = tokens × 4 for English.
export const HAIKU_CHAR_BUDGET = 720_000; // ≈ 180K tokens
export const SONNET_CHAR_BUDGET = 2_000_000; // ≈ 500K tokens — cost guardrail, not context

export interface TranscriptMetadata {
  readonly wordCount: number;
  readonly tokens: number;
  readonly language: PromptLocale;
}

export interface ClassifierResult {
  readonly density: "low" | "medium" | "high";
  readonly type:
    | "tutorial"
    | "lecture"
    | "news"
    | "casual"
    | "interview"
    | "other";
  readonly structure: "structured" | "rambling";
}

export type RoutingReason =
  | "long_content"
  | "very_short"
  | "classifier_failed_short"
  | "classifier_failed_long"
  | "high_density"
  | "structured_fidelity"
  | "low_density_casual"
  | "default_haiku";

export interface RoutingDecision {
  readonly model: typeof HAIKU | typeof SONNET;
  readonly reason: RoutingReason;
  readonly dimensions: ClassifierResult | null;
}

/**
 * Count words and estimate tokens from a transcript. Pure; no I/O. The
 * estimator is intentionally a simple wordCount * TOKENS_PER_WORD — good
 * enough for routing thresholds, and exact tokenization would cost a
 * gateway round trip.
 */
export function getTranscriptMetadata(
  transcript: string,
  language: PromptLocale
): TranscriptMetadata {
  // `split(/\s+/)` on an empty string yields [""] — filter it out so empty
  // transcripts correctly count as zero words.
  const wordCount = transcript.trim() === ""
    ? 0
    : transcript.trim().split(/\s+/).length;
  const tokens = Math.round(wordCount * TOKENS_PER_WORD);
  return { wordCount, tokens, language };
}

/**
 * Pure routing decision from metadata + (optional) classifier output.
 * Rule order matters — first match wins. See the design doc for the
 * rationale on each branch.
 */
export function chooseModel(
  metadata: TranscriptMetadata,
  classifier: ClassifierResult | null
): RoutingDecision {
  if (metadata.tokens > LONG_TOKENS) {
    return { model: SONNET, reason: "long_content", dimensions: classifier };
  }
  if (metadata.tokens < SHORT_TOKENS) {
    return { model: HAIKU, reason: "very_short", dimensions: classifier };
  }
  if (classifier === null) {
    if (metadata.tokens < FALLBACK_HAIKU_TOKENS) {
      return { model: HAIKU, reason: "classifier_failed_short", dimensions: null };
    }
    return { model: SONNET, reason: "classifier_failed_long", dimensions: null };
  }
  if (classifier.density === "high") {
    return { model: SONNET, reason: "high_density", dimensions: classifier };
  }
  if (classifier.type === "lecture" || classifier.type === "news") {
    return { model: SONNET, reason: "structured_fidelity", dimensions: classifier };
  }
  if (classifier.structure === "rambling" && classifier.density === "low") {
    return { model: HAIKU, reason: "low_density_casual", dimensions: classifier };
  }
  return { model: HAIKU, reason: "default_haiku", dimensions: classifier };
}
