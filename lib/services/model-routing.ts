// youtubeai_chat_frontend/lib/services/model-routing.ts

// Two-tier routing for YouTube summarization: token count gates the obvious
// cases, the classifier handles the middle zone, and dimensions remain
// available for observability. Every branch resolves to Codex Spark. See
// docs/superpowers/specs/2026-04-19-model-routing-design.md for rationale.

import type { PromptLocale } from "./summarize-cache";
import { z } from "zod";
import { callLlmJson } from "./llm-client";
import { buildClassifierPrompt } from "@/lib/prompts/routing-classifier";
import { HAIKU, SONNET, SPARK, type KnownModel } from "./models";
import { logAppEvent } from "@/lib/observability";

// Re-export so existing consumers (route.ts, tests) keep their import path.
export { HAIKU, SONNET, SPARK };
export type { KnownModel };

// Rough estimator: one English word ≈ 1.3 tokens. Good enough for
// routing thresholds; the actual tokenizer would add a gateway round trip we
// don't need.
export const TOKENS_PER_WORD = 1.3;

// Chinese has no whitespace word boundaries — count CJK characters directly.
// The gateway tokenizer averages ~1.5 tokens per CJK char in practice. Without
// this, `split(/\s+/)` on a ZH transcript yields wordCount=1 for any length,
// routing every Chinese video to `very_short` and (since the 15K char cap was
// lifted) potentially exceeding the model's context on long videos.
export const TOKENS_PER_ZH_CHAR = 1.5;

// Below this we don't bother classifying — short content does not need the
// additional classifier round trip.
export const SHORT_TOKENS = 5_000;

// Above this we skip classification for long content. The threshold leaves
// prompt-overhead headroom while preserving the existing telemetry fence.
export const LONG_TOKENS = 150_000;

// Threshold used only when the classifier failed — we still want token
// count to pick something reasonable.
export const FALLBACK_HAIKU_TOKENS = 25_000;

// Spark has a 128K context window. Keep the transcript prompt below 100K
// estimated English tokens so the system prompt, title, and generated answer
// have headroom.
export const SPARK_CHAR_BUDGET = 400_000;
export const SPARK_CJK_CHAR_BUDGET = 64_000;

/** @deprecated Use SPARK_CHAR_BUDGET. */
export const HAIKU_CHAR_BUDGET = SPARK_CHAR_BUDGET;
/** @deprecated Use SPARK_CHAR_BUDGET. */
export const SONNET_CHAR_BUDGET = SPARK_CHAR_BUDGET;

/**
 * Choose a transcript character budget that stays under Spark's context
 * window for both English and the denser CJK tokenization path.
 */
export function getSparkCharBudget(language: "en" | "zh"): number {
  return language === "zh" ? SPARK_CJK_CHAR_BUDGET : SPARK_CHAR_BUDGET;
}

// How much of the transcript to feed the classifier. 4K chars covers ~1K
// tokens of English (≈650 words) or ~6K tokens of CJK/kana at our 1.5
// tokens-per-char estimate (conservative for kana-heavy Japanese, which
// tokenizes closer to 1:1) — enough signal for Spark to classify style
// without materially inflating classifier cost or latency.
export const CLASSIFIER_EXCERPT_CHARS = 4_000;

export interface TranscriptMetadata {
  readonly wordCount: number;
  readonly tokens: number;
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

// Reasons where the classifier did NOT run successfully — either the token
// gate skipped it, or it ran and failed. Dimensions are null in both cases.
export type NoClassifierReason =
  | "long_content"
  | "very_short"
  | "classifier_failed_short"
  | "classifier_failed_long";

// Reasons where the classifier produced a validated result — dimensions is
// always present.
export type ClassifierReason =
  | "high_density"
  | "structured_fidelity"
  | "low_density_casual"
  | "default_haiku";

// Union of every routing reason — exported so dashboards and log consumers
// outside this module can type-narrow on the full space without manually
// re-concatenating the two subtypes.
export type RoutingReason = NoClassifierReason | ClassifierReason;

// Discriminated on the reason subtype so `dimensions` is non-null iff the
// classifier's output informed the decision. Enforces at compile-time that
// the two cannot drift — e.g. a `very_short` decision cannot carry leftover
// dimensions from an earlier classifier call.
export type RoutingDecision =
  | { readonly model: KnownModel; readonly reason: NoClassifierReason; readonly dimensions: null }
  | { readonly model: KnownModel; readonly reason: ClassifierReason; readonly dimensions: ClassifierResult };

// Covers the three character sets reachable on the `zh` path:
//   Basic CJK Unified Ideographs  U+4E00–9FFF (Chinese + kanji)
//   Hiragana                       U+3040–309F (Japanese)
//   Katakana                       U+30A0–30FF (Japanese)
// Japanese transcripts occasionally fall into the `zh` branch when
// detectLocale sees kanji — without kana coverage they'd under-count by
// ~50%. Rare CJK Extension blocks (A: U+3400–4DBF, B+: U+20000+) and
// Compatibility Ideographs (U+F900–FAFF) remain unmatched; under-count
// stays within routing tolerance at the SHORT_TOKENS/LONG_TOKENS fences.
const CJK_CHAR_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g;

/**
 * Count words and estimate tokens from a transcript. Pure; no I/O. For
 * English, one word ≈ 1.3 tokens; for Chinese, one CJK char ≈ 1.5 tokens.
 * Exact tokenization would cost a gateway round trip, which these heuristics
 * avoid.
 *
 * `wordCount` is a misnomer on the Chinese path (it's CJK-char count) but
 * stays named that way so the shape is consistent across languages in logs.
 */
export function getTranscriptMetadata(
  transcript: string,
  language: PromptLocale
): TranscriptMetadata {
  const trimmed = transcript.trim();
  if (trimmed === "") {
    return { wordCount: 0, tokens: 0 };
  }
  if (language === "zh") {
    const cjkCount = (trimmed.match(CJK_CHAR_REGEX) ?? []).length;
    const tokens = Math.round(cjkCount * TOKENS_PER_ZH_CHAR);
    return { wordCount: cjkCount, tokens };
  }
  // `split(/\s+/)` on a whitespace-only string yields [""] — the trim above
  // plus the empty-check guards the empty case; anything that reaches here
  // has at least one non-whitespace run.
  const wordCount = trimmed.split(/\s+/).length;
  const tokens = Math.round(wordCount * TOKENS_PER_WORD);
  return { wordCount, tokens };
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
  // Non-classifier branches always produce `dimensions: null` — enforced by
  // the discriminated union so a future refactor can't silently leak a
  // leftover classifier result into a token-gate reason.
  if (metadata.tokens > LONG_TOKENS) {
    return { model: SPARK, reason: "long_content", dimensions: null };
  }
  if (metadata.tokens < SHORT_TOKENS) {
    return { model: SPARK, reason: "very_short", dimensions: null };
  }
  if (classifier === null) {
    if (metadata.tokens < FALLBACK_HAIKU_TOKENS) {
      return { model: SPARK, reason: "classifier_failed_short", dimensions: null };
    }
    return { model: SPARK, reason: "classifier_failed_long", dimensions: null };
  }
  if (classifier.density === "high") {
    return { model: SPARK, reason: "high_density", dimensions: classifier };
  }
  if (classifier.type === "lecture" || classifier.type === "news") {
    return { model: SPARK, reason: "structured_fidelity", dimensions: classifier };
  }
  if (classifier.structure === "rambling" && classifier.density === "low") {
    return { model: SPARK, reason: "low_density_casual", dimensions: classifier };
  }
  return { model: SPARK, reason: "default_haiku", dimensions: classifier };
}

// 5s is the hard cap on classifier latency. Spark classification of a ~1K
// token prompt returns in <2s under normal load, so 5s leaves headroom for
// gateway cold-start without letting a stuck classifier dominate end-to-end
// summarization latency (classifier runs BEFORE the main LLM call).
const CLASSIFIER_TIMEOUT_MS = 5_000;

const ClassifierSchema = z.object({
  density: z.enum(["low", "medium", "high"]),
  type: z.enum(["tutorial", "lecture", "news", "casual", "interview", "other"]),
  structure: z.enum(["structured", "rambling"]),
});

export interface ClassifyContentOptions {
  readonly transcriptExcerpt: string;
  readonly title: string;
  readonly language: PromptLocale;
  // Required — the silent-abort semantic below depends on this being the
  // caller's own signal. If a future caller forgets to pass it, every
  // browser disconnect would surface as a CLASSIFIER_FAILED error log.
  // Note: callLlmJson composes this with its own CLASSIFIER_TIMEOUT_MS
  // internal timeout, so cancellation is both caller-driven AND bounded.
  readonly signal: AbortSignal;
}

/**
 * Single Spark call that classifies a transcript excerpt along three
 * dimensions. Returns `null` on any failure so routing degrades to the
 * token-count fallback — never throws.
 *
 * Failure logging: genuine failures (network, 5s timeout, non-JSON,
 * schema-invalid) emit `CLASSIFIER_FAILED` at error level. Caller-abort
 * (browser disconnect) is an exception and exits silently to avoid
 * polluting that alert signal.
 */
export async function classifyContent(
  options: ClassifyContentOptions
): Promise<ClassifierResult | null> {
  const prompt = buildClassifierPrompt({
    transcriptExcerpt: options.transcriptExcerpt,
    title: options.title,
    language: options.language,
  });

  let raw: string;
  try {
    raw = await callLlmJson({
      model: SPARK,
      prompt,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
      signal: options.signal,
    });
  } catch (err) {
    // Caller-abort (browser disconnect) should exit silently — logging it
    // as CLASSIFIER_FAILED would pollute the alert signal with per-disconnect
    // noise and mask real classifier failures. The 5s timeout fires via a
    // different AbortSignal, so timeouts continue to log as CLASSIFIER_FAILED.
    if (options.signal.aborted) return null;
    logAppEvent("error", "[routing] classifier call failed", {
      errorId: "CLASSIFIER_FAILED",
      stage: "classify",
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (err) {
    logAppEvent("error", "[routing] classifier response not valid JSON", {
      errorId: "CLASSIFIER_FAILED",
      stage: "classify",
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return null;
  }

  const validated = ClassifierSchema.safeParse(parsed);
  if (!validated.success) {
    logAppEvent("error", "[routing] classifier response failed schema", {
      errorId: "CLASSIFIER_FAILED",
      stage: "classify",
      errorClass: "SchemaMismatch",
    });
    return null;
  }
  return validated.data;
}
