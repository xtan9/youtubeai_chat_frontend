import { z } from "zod";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import type { SubscriptionPresentation } from "@/lib/services/subscription-presentation";

export const SELECTION_LIMIT = 500;
export const CONTEXT_LIMIT = 4000;
export const HEADING_LIMIT = 200;

export function hasTranslationAccess(presentation: SubscriptionPresentation): boolean {
  if (presentation.state === "active_pro") return true;
  if (presentation.state !== "pro_pending_cancellation") return false;
  return presentation.accessEndsAt === null || Date.parse(presentation.accessEndsAt) > Date.now();
}

export function normalizePassage(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

// Sentence segmentation is locale-aware; join common abbreviated titles which
// ICU may split before a proper name (for example, "Dr. Smith").
export function isSingleSentence(text: string): boolean {
  if (!text.trim() || Array.from(text).length > SELECTION_LIMIT) return false;
  const input = text.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\./giu, match => match.slice(0, -1));
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(input))
    .filter(part => /[\p{L}\p{N}]/u.test(part.segment));
  return parts.length === 1;
}

export function boundContext(paragraph: string, selectionStart: number): string {
  const points = Array.from(paragraph);
  const start = Array.from(paragraph.slice(0, selectionStart)).length;
  const from = Math.max(0, Math.min(start - 1500, points.length - CONTEXT_LIMIT));
  return points.slice(from, from + CONTEXT_LIMIT).join("");
}

const boundedText = (max: number) => z.string().max(max * 2)
  .refine(text => Array.from(text).length <= max);
export const TranslationRequestSchema = z.object({
  youtubeUrl: z.string().max(300),
  outputLanguage: z.enum(SUPPORTED_LANGUAGE_CODES).nullable(),
  targetLanguage: z.enum(SUPPORTED_LANGUAGE_CODES),
  blockStart: z.number().int().nonnegative(),
  selectionStart: z.number().int().nonnegative(),
  text: boundedText(SELECTION_LIMIT).refine(isSingleSentence),
  context: boundedText(CONTEXT_LIMIT),
  heading: boundedText(HEADING_LIMIT),
}).strict();
export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;

export const TranslationResultSchema = z.object({
  translation: z.string().trim().min(1).max(1500),
  explanation: z.string().trim().min(1).max(2000),
  partOfSpeech: z.string().trim().max(60).optional(),
  sameLanguage: z.boolean(),
}).strict();
export type TranslationResult = z.infer<typeof TranslationResultSchema>;
