// youtubeai_chat_frontend/lib/services/model-routing.ts

// Two-tier routing for YouTube summarization: token count gates the obvious
// cases (very short → Haiku, very long → Sonnet), classifier handles the
// middle zone, dimensions map to a model via rules. See
// docs/superpowers/specs/2026-04-19-model-routing-design.md for rationale.

import type { PromptLocale } from "./summarize-cache";
import { z } from "zod";
import { callLlmJson } from "./llm-client";
import { buildClassifierPrompt } from "@/lib/prompts/routing-classifier";

export const HAIKU = "claude-haiku-4-5";
export const SONNET = "claude-sonnet-4-6";

// Rough estimator: one English word ≈ 1.3 Claude tokens. Good enough for
// routing thresholds; the actual tokenizer would add a gateway round trip we
// don't need.
export const TOKENS_PER_WORD = 1.3;

// Chinese has no whitespace word boundaries — count CJK characters directly.
// Claude's tokenizer averages ~1.5 tokens per CJK char in practice. Without
// this, `split(/\s+/)` on a ZH transcript yields wordCount=1 for any length,
// routing every Chinese video to `very_short` and (since the 15K char cap was
// lifted) potentially blowing past Haiku's 200K context on long videos.
export const TOKENS_PER_ZH_CHAR = 1.5;

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

// CJK Unified Ideographs block. Enough coverage for routine Chinese content;
// exotic compatibility blocks (extensions A/B/…) are rare in YouTube transcripts
// and their absence here only slightly under-counts — which stays safe since
// routing already prefers Haiku on the token-count fence.
const CJK_CHAR_REGEX = /[\u4e00-\u9fff]/g;

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
    return { wordCount: 0, tokens: 0, language };
  }
  if (language === "zh") {
    const cjkCount = (trimmed.match(CJK_CHAR_REGEX) ?? []).length;
    const tokens = Math.round(cjkCount * TOKENS_PER_ZH_CHAR);
    return { wordCount: cjkCount, tokens, language };
  }
  // `split(/\s+/)` on a whitespace-only string yields [""] — the trim above
  // plus the empty-check guards the empty case; anything that reaches here
  // has at least one non-whitespace run.
  const wordCount = trimmed.split(/\s+/).length;
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
  readonly signal?: AbortSignal;
}

/**
 * Single Haiku call that classifies a transcript excerpt along three
 * dimensions. Internally catches every failure mode (network, timeout,
 * non-JSON, schema) and returns null so routing degrades to token-count
 * fallback. Never throws.
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
      model: HAIKU,
      prompt,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
      signal: options.signal,
    });
  } catch (err) {
    // Caller-abort (browser disconnect) should exit silently — logging it
    // as CLASSIFIER_FAILED would pollute the alert signal with per-disconnect
    // noise and mask real classifier failures. The 5s timeout fires via a
    // different AbortSignal, so timeouts continue to log as CLASSIFIER_FAILED.
    if (options.signal?.aborted) return null;
    console.error("[routing] classifier call failed", {
      errorId: "CLASSIFIER_FAILED",
      stage: "classify",
      err,
    });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (err) {
    console.error("[routing] classifier response not valid JSON", {
      errorId: "CLASSIFIER_FAILED",
      stage: "classify",
      preview: raw.slice(0, 200),
      err,
    });
    return null;
  }

  const validated = ClassifierSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[routing] classifier response failed schema", {
      errorId: "CLASSIFIER_FAILED",
      stage: "classify",
      issues: validated.error.issues,
    });
    return null;
  }
  return validated.data;
}
