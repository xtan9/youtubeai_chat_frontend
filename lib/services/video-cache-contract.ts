import { z } from "zod";
import { normalizeYouTubeVideoId } from "./youtube-url";
import { SUPPORTED_LANGUAGE_CODES, type SupportedLanguageCode } from "@/lib/constants/languages";
import {
  TranscriptSegmentSchema,
  type TranscriptSegment,
  type TranscriptSource,
} from "@/lib/types";
import { TRANSCRIPT_SOURCES } from "@/lib/domain/transcript-source";

// PromptLocale = the VIDEO's detected language (binary — drives the classifier
// + cache's videos.language column + legacy code paths). Distinct from
// SupportedLanguageCode which names the summary's OUTPUT language. Don't
// unify: they have different life cycles and one is constrained to what the
// cache schema accepts, the other to what the picker ships.
export type PromptLocale = "en" | "zh";

// Output language value that gets written to summaries.output_language.
// `null` means "this is the video's native-language summary" — the default
// path that existed before the language-picker feature.
export type CachedOutputLanguage = SupportedLanguageCode | null;

export interface VideoMetadata {
  readonly title: string;
  readonly channelName: string;
  readonly language: PromptLocale;
}

export type SummaryBody = {
  readonly transcript: string;
  readonly summary: string;
  readonly transcriptSource: TranscriptSource;
  readonly model: string;
  readonly processingTimeSeconds: number;
  readonly transcribeTimeSeconds: number;
  readonly summarizeTimeSeconds: number;
};

export type CachedSummary = VideoMetadata &
  SummaryBody & {
    readonly videoId: string;
    readonly outputLanguage: CachedOutputLanguage;
  };

export type CacheWriteParams = VideoMetadata &
  SummaryBody & {
    readonly youtubeUrl: string;
    readonly userId?: string;
    readonly smokeProEntitled?: boolean;
    readonly outputLanguage?: CachedOutputLanguage;
  };

// Transcript-only cache shape — the per-video, per-anything-else artifact
// that survives independently of the summary cache. Carries enough state
// to skip the entire transcription pipeline on cache hit, but no summary
// fields (those live on `summaries`, keyed by output_language).
//
// `segments` carry per-line timing the frontend uses to render clickable
// timestamps that seek the embedded YouTube player. The flat string the
// LLM consumes is derived at the call site
// (`segments.map(s => s.text).join(" ")`), never persisted, so the cache
// can't drift between "what the LLM saw" and "what the user sees."
export interface CachedTranscript {
  readonly videoId: string;
  readonly title: string;
  readonly channelName: string;
  readonly segments: readonly TranscriptSegment[];
  readonly transcriptSource: TranscriptSource;
  readonly language: PromptLocale;
}

export type TranscriptWriteParams = {
  readonly youtubeUrl: string;
  readonly segments: readonly TranscriptSegment[];
  readonly transcriptSource: TranscriptSource;
  readonly language: PromptLocale;
  // Captions path has these by the time it writes; Whisper path may not
  // have resolved oembed yet — pass undefined and writeCachedSummary will
  // overwrite the videos row with the real values when the pipeline ends.
  readonly title?: string;
  readonly channelName?: string;
};

/**
 * Normalized cache key. Every supported URL shape and raw ID resolves to the
 * same canonical YouTube identity. Invalid input is rejected rather than
 * creating an unreachable legacy hash row.
 */
export function computeVideoKey(url: string): string | null {
  return normalizeYouTubeVideoId(url);
}

// Parse Supabase responses through these so a stale enum value or dropped
// column is a loud cache miss, not a silently corrupted typed object.
const LocaleSchema = z.enum(["en", "zh"]);

const TranscriptSourceSchema = z.enum(TRANSCRIPT_SOURCES);

export const VideoRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  channel_name: z.string().nullable(),
  language: LocaleSchema.nullable(),
});

// output_language is a closed set — matching the LocaleSchema / TranscriptSource
// pattern lets a corrupt row (e.g. a rogue "klingon") surface as a loud,
// fail-open cache miss rather than silently typing as a SupportedLanguageCode.
const OutputLanguageSchema = z.enum(SUPPORTED_LANGUAGE_CODES);

export const SummaryRowSchema = z.object({
  transcript: z.string().nullable(),
  summary: z.string(),
  transcript_source: TranscriptSourceSchema,
  model: z.string().nullable(),
  processing_time_seconds: z.number().nullable(),
  transcribe_time_seconds: z.number().nullable(),
  summarize_time_seconds: z.number().nullable(),
  output_language: OutputLanguageSchema.nullable(),
});

// Writes are stricter than reads (which allow nulls for historical rows).
// Don't unify without a backfill. output_language is nullable because the
// video-native row uses NULL as its "no explicit override" marker (composite
// UNIQUE (video_id, output_language) NULLS NOT DISTINCT enforces one native
// row per video).
export const SummaryWriteSchema = z.object({
  video_id: z.string(),
  transcript: z.string(),
  summary: z.string().min(1),
  transcript_source: TranscriptSourceSchema,
  model: z.string(),
  processing_time_seconds: z.number().min(0),
  transcribe_time_seconds: z.number().min(0),
  summarize_time_seconds: z.number().min(0),
  output_language: OutputLanguageSchema.nullable(),
});

// jsonb column. Stored as a JSON array, returned by PostgREST as a JS
// array — we still pass it through the canonical TranscriptSegmentSchema
// (imported above from lib/types) so a corrupt row (or a YouTube/Whisper
// schema drift that slipped through writes) is a loud cache miss rather
// than a silently typed `unknown[]`. Centralized so the four trust
// boundaries (VPS captions, VPS transcribe, DB read, DB write) share
// one contract — drift between them used to be invisible.

export const TranscriptRowSchema = z.object({
  segments: z.array(TranscriptSegmentSchema).min(1),
  transcript_source: TranscriptSourceSchema,
  language: LocaleSchema,
});

// Caching an empty transcript would cement the "we tried, got nothing"
// state forever. Better to fail-open and re-attempt on the next request.
export const TranscriptWriteSchema = z.object({
  video_id: z.string(),
  segments: z.array(TranscriptSegmentSchema).min(1),
  transcript_source: TranscriptSourceSchema,
  language: LocaleSchema,
});
