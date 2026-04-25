import { createHash } from "crypto";
import { z } from "zod";
import { extractVideoId } from "./youtube-url";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import {
  TranscriptSegmentSchema,
  type TranscriptSegment,
} from "@/lib/types";

export type { TranscriptSegment };
export { TranscriptSegmentSchema };

// PromptLocale = the VIDEO's detected language (binary — drives the classifier
// + cache's videos.language column + legacy code paths). Distinct from
// SupportedLanguageCode which names the summary's OUTPUT language. Don't
// unify: they have different life cycles and one is constrained to what the
// cache schema accepts, the other to what the picker ships.
export type PromptLocale = "en" | "zh";
export type TranscriptSource = "manual_captions" | "auto_captions" | "whisper";

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
 * Normalized cache key. Prefer the 11-char YouTube video ID so different URL
 * shapes (`youtu.be/X`, `youtube.com/watch?v=X`, `&t=10`, `music.*`) collapse
 * to one cache row. Falls back to MD5 of the raw URL when the ID can't be
 * extracted.
 */
export function computeVideoKey(url: string): string {
  return extractVideoId(url) ?? createHash("md5").update(url).digest("hex");
}

// Parse Supabase responses through these so a stale enum value or dropped
// column is a loud cache miss, not a silently corrupted typed object.
const LocaleSchema = z.enum(["en", "zh"]);
const TranscriptSourceSchema = z.enum([
  "manual_captions",
  "auto_captions",
  "whisper",
]);

const VideoRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  channel_name: z.string().nullable(),
  language: LocaleSchema.nullable(),
});

// output_language is a closed set — matching the LocaleSchema / TranscriptSource
// pattern lets a corrupt row (e.g. a rogue "klingon") surface as a loud,
// fail-open cache miss rather than silently typing as a SupportedLanguageCode.
const OutputLanguageSchema = z.enum(SUPPORTED_LANGUAGE_CODES);

const SummaryRowSchema = z.object({
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
const SummaryWriteSchema = z.object({
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

const TranscriptRowSchema = z.object({
  segments: z.array(TranscriptSegmentSchema).min(1),
  transcript_source: TranscriptSourceSchema,
  language: LocaleSchema,
});

// Caching an empty transcript would cement the "we tried, got nothing"
// state forever. Better to fail-open and re-attempt on the next request.
const TranscriptWriteSchema = z.object({
  video_id: z.string(),
  segments: z.array(TranscriptSegmentSchema).min(1),
  transcript_source: TranscriptSourceSchema,
  language: LocaleSchema,
});

/**
 * Fails open (null) on any error with a log so a broken cache surfaces as
 * "every request re-billed through the LLM gateway" rather than silent
 * degradation.
 *
 * `outputLanguage` selects which row to read for this video. `null` (or
 * undefined) targets the video-native summary (output_language IS NULL).
 * A language code targets that specific translation row. The two share a
 * video_id but are independent rows — a hit on one doesn't imply the other
 * exists.
 */
export async function getCachedSummary(
  youtubeUrl: string,
  outputLanguage: CachedOutputLanguage = null
): Promise<CachedSummary | null> {
  const supabase = getServiceRoleClient();
  if (!supabase) return null;

  try {
    const videoKey = computeVideoKey(youtubeUrl);
    const { data: videoRaw, error: videoError } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("url_hash", videoKey)
      .maybeSingle();

    if (videoError) {
      console.error("[summarize-cache] video lookup failed (fail-open)", {
        videoKey,
        error: videoError,
      });
      return null;
    }
    if (!videoRaw) return null;

    const videoParsed = VideoRowSchema.safeParse(videoRaw);
    if (!videoParsed.success) {
      console.error("[summarize-cache] video row schema mismatch (fail-open)", {
        videoKey,
        issues: videoParsed.error.issues,
      });
      return null;
    }
    const video = videoParsed.data;

    // maybeSingle() trusts the DB UNIQUE(video_id, output_language) with
    // NULLS NOT DISTINCT installed by
    // migration 20260424000000_add_output_language.sql. If two rows ever
    // slipped through (constraint dropped, bad data load) PostgREST returns
    // PGRST116 and the branch below treats it as a fail-open cache miss —
    // the request re-bills through the LLM instead of silently picking a row.
    //
    // PostgREST filter semantics: .is(col, null) produces `col IS NULL`;
    // .eq(col, value) produces `col = value`. We need both paths explicitly
    // because `.eq(col, null)` would emit `col = NULL` which SQL evaluates
    // as UNKNOWN and would match nothing.
    let summaryQuery = supabase
      .from("summaries")
      .select(
        "transcript, summary, transcript_source, model, processing_time_seconds, transcribe_time_seconds, summarize_time_seconds, output_language"
      )
      .eq("video_id", video.id);
    summaryQuery =
      outputLanguage === null
        ? summaryQuery.is("output_language", null)
        : summaryQuery.eq("output_language", outputLanguage);
    const { data: summaryRaw, error: summaryError } =
      await summaryQuery.maybeSingle();

    if (summaryError) {
      console.error(
        "[summarize-cache] summary lookup failed (fail-open)",
        { videoId: video.id, error: summaryError }
      );
      return null;
    }
    if (!summaryRaw) return null;

    const summaryParsed = SummaryRowSchema.safeParse(summaryRaw);
    if (!summaryParsed.success) {
      console.error(
        "[summarize-cache] summary row schema mismatch (fail-open)",
        { videoId: video.id, issues: summaryParsed.error.issues }
      );
      return null;
    }
    const s = summaryParsed.data;

    const processingTime = s.processing_time_seconds ?? 0;
    const transcribeTime = s.transcribe_time_seconds ?? 0;
    // Legacy rows pre-date the split columns — fall back so cache hits still
    // render sensible timings instead of 0s.
    const summarizeTime =
      s.summarize_time_seconds ??
      (transcribeTime ? Math.max(0, processingTime - transcribeTime) : processingTime);

    return {
      videoId: video.id,
      title: video.title ?? "",
      channelName: video.channel_name ?? "",
      language: video.language ?? "en",
      transcript: s.transcript ?? "",
      summary: s.summary,
      transcriptSource: s.transcript_source,
      model: s.model ?? "",
      processingTimeSeconds: processingTime,
      transcribeTimeSeconds: transcribeTime,
      summarizeTimeSeconds: summarizeTime,
      outputLanguage: s.output_language,
    };
  } catch (err) {
    console.error("[summarize-cache] read failed (fail-open)", {
      youtubeUrl,
      err,
    });
    return null;
  }
}

// Runs after the user already has their summary. Throws on any partial-write
// failure so the route's `.catch` can log with full context — a silent skip
// here leaves orphan `videos` rows without a matching `summaries` row, which
// breaks cache reads for that URL permanently.
export async function writeCachedSummary(
  params: CacheWriteParams
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    // Missing creds = cache disabled = every request re-bills through the
    // LLM gateway. Same incident class as rate-limit fail-open — alertable
    // in production, tolerable noise in dev.
    const payload = {
      errorId: "CACHE_WRITE_SKIP_NO_CREDS",
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[summarize-cache] write skipped: service-role key not configured (cache disabled in production)",
        payload
      );
    } else {
      console.warn(
        "[summarize-cache] write skipped: service-role key not configured",
        payload
      );
    }
    return;
  }

  const videoKey = computeVideoKey(params.youtubeUrl);

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .upsert(
      {
        youtube_url: params.youtubeUrl,
        url_hash: videoKey,
        title: params.title || null,
        channel_name: params.channelName || null,
        language: params.language,
      },
      { onConflict: "url_hash" }
    )
    .select("id")
    .single();

  if (videoError || !video) {
    throw new Error(
      `video upsert failed: ${videoError?.message ?? "no row returned"}`,
      { cause: videoError ?? undefined }
    );
  }

  const summaryRow = {
    video_id: video.id,
    transcript: params.transcript,
    summary: params.summary,
    transcript_source: params.transcriptSource,
    model: params.model,
    processing_time_seconds: params.processingTimeSeconds,
    transcribe_time_seconds: params.transcribeTimeSeconds,
    summarize_time_seconds: params.summarizeTimeSeconds,
    output_language: params.outputLanguage ?? null,
  };

  const writeCheck = SummaryWriteSchema.safeParse(summaryRow);
  if (!writeCheck.success) {
    throw new Error(
      `summary write failed schema validation: ${writeCheck.error.message}`,
      { cause: writeCheck.error }
    );
  }

  const { error: summaryError } = await supabase
    .from("summaries")
    .upsert(writeCheck.data, { onConflict: "video_id,output_language" });

  if (summaryError) {
    throw new Error(`summary upsert failed: ${summaryError.message}`, {
      cause: summaryError,
    });
  }

  if (params.userId) {
    const { error: historyError } = await supabase
      .from("user_video_history")
      .upsert(
        { user_id: params.userId, video_id: video.id },
        { onConflict: "user_id,video_id" }
      );
    if (historyError) {
      throw new Error(`history upsert failed: ${historyError.message}`, {
        cause: historyError,
      });
    }
  }
}

/**
 * Read a previously-cached transcript by video URL — independent of any
 * summary cache row. Used at the top of the summarize-stream pipeline to
 * skip transcription whenever this video has been transcribed before, no
 * matter which output language the current request targets.
 *
 * Fail-open semantics match getCachedSummary: any error/schema mismatch
 * returns null + logs, so a broken cache means "re-transcribe this once,"
 * not "stall forever."
 */
export async function getCachedTranscript(
  youtubeUrl: string
): Promise<CachedTranscript | null> {
  const supabase = getServiceRoleClient();
  if (!supabase) return null;

  try {
    const videoKey = computeVideoKey(youtubeUrl);
    const { data: videoRaw, error: videoError } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("url_hash", videoKey)
      .maybeSingle();

    if (videoError) {
      console.error(
        "[summarize-cache] transcript: video lookup failed (fail-open)",
        { errorId: "TRANSCRIPT_VIDEO_LOOKUP_ERROR", videoKey, error: videoError }
      );
      return null;
    }
    if (!videoRaw) return null;

    const videoParsed = VideoRowSchema.safeParse(videoRaw);
    if (!videoParsed.success) {
      console.error(
        "[summarize-cache] transcript: video row schema mismatch (fail-open)",
        {
          errorId: "TRANSCRIPT_VIDEO_SCHEMA_MISMATCH",
          videoKey,
          issues: videoParsed.error.issues,
        }
      );
      return null;
    }
    const video = videoParsed.data;

    const { data: transcriptRaw, error: transcriptError } = await supabase
      .from("video_transcripts")
      .select("segments, transcript_source, language")
      .eq("video_id", video.id)
      .maybeSingle();

    if (transcriptError) {
      console.error(
        "[summarize-cache] transcript: lookup failed (fail-open)",
        {
          errorId: "TRANSCRIPT_LOOKUP_ERROR",
          videoId: video.id,
          error: transcriptError,
        }
      );
      return null;
    }
    if (!transcriptRaw) return null;

    const parsed = TranscriptRowSchema.safeParse(transcriptRaw);
    if (!parsed.success) {
      console.error(
        "[summarize-cache] transcript: row schema mismatch (fail-open)",
        {
          errorId: "TRANSCRIPT_SCHEMA_MISMATCH",
          videoId: video.id,
          issues: parsed.error.issues,
        }
      );
      return null;
    }

    return {
      videoId: video.id,
      title: video.title ?? "",
      channelName: video.channel_name ?? "",
      segments: parsed.data.segments,
      transcriptSource: parsed.data.transcript_source,
      language: parsed.data.language,
    };
  } catch (err) {
    console.error("[summarize-cache] transcript read failed (fail-open)", {
      errorId: "TRANSCRIPT_READ_THREW",
      youtubeUrl,
      err,
    });
    return null;
  }
}

/**
 * Persist the transcript right after transcription succeeds — independent
 * of LLM completion. Subsequent requests for this video skip the entire
 * transcription pipeline (VPS metadata + captions + Whisper) regardless
 * of the requested output language.
 *
 * Throws on any partial-write failure so the caller's `.catch` can log
 * with full context. The route fires this without awaiting its result
 * (writeCachedTranscript(...).catch(logStageError)) so the user-visible
 * stream never waits on the transcript-cache write.
 */
export async function writeCachedTranscript(
  params: TranscriptWriteParams
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    const payload = {
      errorId: "TRANSCRIPT_WRITE_SKIP_NO_CREDS",
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[summarize-cache] transcript write skipped: service-role key not configured (cache disabled in production)",
        payload
      );
    } else {
      console.warn(
        "[summarize-cache] transcript write skipped: service-role key not configured",
        payload
      );
    }
    return;
  }

  const videoKey = computeVideoKey(params.youtubeUrl);

  // Sparse upsert: only include title/channel in the payload when the
  // caller actually has values. Supabase's upsert generates
  // `INSERT ... ON CONFLICT DO UPDATE SET col = EXCLUDED.col` only for
  // columns present in the payload, so omitting `title` here means an
  // existing populated row is NOT clobbered with NULL. This matters
  // because the route writes the transcript cache fire-and-forget; a
  // late-resolving transcript write must not overwrite metadata that
  // writeCachedSummary already persisted.
  const videoRow: Record<string, string | null> = {
    youtube_url: params.youtubeUrl,
    url_hash: videoKey,
    language: params.language,
  };
  if (params.title) videoRow.title = params.title;
  if (params.channelName) videoRow.channel_name = params.channelName;

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .upsert(videoRow, { onConflict: "url_hash" })
    .select("id")
    .single();

  if (videoError || !video) {
    throw new Error(
      `video upsert failed: ${videoError?.message ?? "no row returned"}`,
      { cause: videoError ?? undefined }
    );
  }

  const transcriptRow = {
    video_id: video.id,
    // Spread the segments through the writer rather than storing a
    // JSON.stringify result — Supabase's PostgREST encodes the value into
    // the jsonb column itself, and pre-stringifying would land it as a
    // quoted JSON string instead of a real array.
    segments: params.segments.map((s) => ({
      text: s.text,
      start: s.start,
      duration: s.duration,
    })),
    transcript_source: params.transcriptSource,
    language: params.language,
  };

  const writeCheck = TranscriptWriteSchema.safeParse(transcriptRow);
  if (!writeCheck.success) {
    throw new Error(
      `transcript write failed schema validation: ${writeCheck.error.message}`,
      { cause: writeCheck.error }
    );
  }

  const { error: transcriptError } = await supabase
    .from("video_transcripts")
    .upsert(writeCheck.data, { onConflict: "video_id" });

  if (transcriptError) {
    throw new Error(
      `transcript upsert failed: ${transcriptError.message}`,
      { cause: transcriptError }
    );
  }
}
