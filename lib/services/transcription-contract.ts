import { z } from "zod";
import { TranscriptSegmentSchema } from "@/lib/types";
import { extractVideoId } from "./youtube-url";

const LANGUAGE_SENTINELS: ReadonlySet<string> = new Set([
  "und",
  "zxx",
  "mul",
  "mis",
]);

export const YouTubeUrlSchema = z
  .string()
  .trim()
  .url("youtube_url must be a valid URL")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && extractVideoId(value) !== null;
    } catch {
      return false;
    }
  }, "youtube_url must be an https YouTube video URL");

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
