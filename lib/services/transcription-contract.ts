import { z } from "zod";
import { TranscriptSegmentSchema } from "@/lib/types";
import {
  canonicalYouTubeUrl,
  extractVideoId,
  normalizeYouTubeVideoId,
} from "./youtube-url";

const LANGUAGE_SENTINELS: ReadonlySet<string> = new Set([
  "und",
  "zxx",
  "mul",
  "mis",
]);

export const YouTubeUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const normalizedId = normalizeYouTubeVideoId(value);
      if (!normalizedId) return false;
      if (/^[A-Za-z0-9_-]{11}$/.test(value)) return true;
      const parsed = new URL(value);
      return parsed.protocol === "https:" && extractVideoId(value) !== null;
    } catch {
      return false;
    }
  }, "youtube_url must be an https YouTube video URL")
  .transform((value) =>
    /^[A-Za-z0-9_-]{11}$/.test(value)
      ? canonicalYouTubeUrl(value)
      : value,
  );

// BCP-47 primary subtag plus optional region/script. The service forwards
// this value to caption selection and Whisper, so sentinels and CLI-shaped
// values must be rejected before they reach either provider.
export const LanguageHintSchema = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/)
  .refine(
    (value) => !LANGUAGE_SENTINELS.has(value.toLowerCase().split("-")[0])
  );

export const TranscriptionRequestSchema = z.object({
  youtube_url: YouTubeUrlSchema,
  lang: LanguageHintSchema.optional(),
});

export const EffectiveLanguageSchema = z.union([
  z.literal("auto"),
  LanguageHintSchema,
]);

export const NonEmptyTranscriptSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "transcript must not be empty");

export const NonEmptyTranscriptSegmentSchema = TranscriptSegmentSchema.refine(
  (segment) => segment.text.trim().length > 0,
  "transcript segment text must not be empty"
);

/**
 * Keep operator-provided timeout values positive and bounded. A malformed,
 * negative, or zero value falls back to the known-safe default; an excessive
 * value is clamped so an env mistake cannot turn a request into an unbounded
 * provider hold.
 */
export function resolveBoundedTimeoutMs(
  rawValue: string | undefined,
  fallbackMs: number,
  maxMs: number
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.min(parsed, maxMs);
}

export function isTimeoutError(
  error: unknown,
  timeoutSignal: AbortSignal
): boolean {
  return (
    timeoutSignal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

export function throwCallerAbort(
  signal: AbortSignal,
  fallback?: unknown
): never {
  throw (
    signal.reason ??
    fallback ??
    new DOMException("The operation was aborted", "AbortError")
  );
}
