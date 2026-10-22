import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalYouTubeUrl } from "./youtube-url";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getUserTier, FREE_LIMITS } from "./entitlements";
import {
  TranscriptSegmentSchema,
  type TranscriptSegment,
  type TranscriptSource,
} from "@/lib/types";
import { logAppEvent, videoIdForLog } from "@/lib/observability";
import {
  type CachedOutputLanguage,
  type CachedSummary,
  type CacheWriteParams,
  computeVideoKey,
  VideoRowSchema,
  SummaryRowSchema,
  SummaryWriteSchema,
} from "./video-cache-contract";

export type { TranscriptSegment, TranscriptSource };

export { TranscriptSegmentSchema };

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
    if (!videoKey) return null;
    const { data: videoRaw, error: videoError } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("youtube_video_id", videoKey)
      .maybeSingle();

    if (videoError) {
      logAppEvent("error", "[summarize-cache] video lookup failed (fail-open)", {
        errorId: "CACHE_VIDEO_LOOKUP_FAILED",
        videoId: videoIdForLog(youtubeUrl),
        errorName: videoError.message ? "SupabaseError" : "UnknownError",
      });
      return null;
    }
    if (!videoRaw) return null;

    const videoParsed = VideoRowSchema.safeParse(videoRaw);
    if (!videoParsed.success) {
      logAppEvent("error", "[summarize-cache] video row schema mismatch (fail-open)", {
        errorId: "CACHE_VIDEO_SCHEMA_MISMATCH",
        videoId: videoIdForLog(youtubeUrl),
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
      logAppEvent(
        "error",
        "[summarize-cache] summary lookup failed (fail-open)",
        {
          errorId: "CACHE_SUMMARY_LOOKUP_FAILED",
          videoId: video.id,
          errorName: summaryError.message ? "SupabaseError" : "UnknownError",
        }
      );
      return null;
    }
    if (!summaryRaw) return null;

    const summaryParsed = SummaryRowSchema.safeParse(summaryRaw);
    if (!summaryParsed.success) {
      logAppEvent("error", "[summarize-cache] summary row schema mismatch (fail-open)", {
        errorId: "CACHE_SUMMARY_SCHEMA_MISMATCH",
        videoId: video.id,
      });
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
    logAppEvent("error", "[summarize-cache] read failed (fail-open)", {
      errorId: "CACHE_READ_FAILED",
      videoId: videoIdForLog(youtubeUrl),
      errorName: err instanceof Error ? err.name : typeof err,
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
      logAppEvent(
        "error",
        "[summarize-cache] write skipped: service-role key not configured (cache disabled in production)",
        payload
      );
    } else {
      logAppEvent(
        "warn",
        "[summarize-cache] write skipped: service-role key not configured",
        payload
      );
    }
    return;
  }

  const videoKey = computeVideoKey(params.youtubeUrl);
  if (!videoKey) {
    throw new Error("video upsert failed: invalid YouTube video identity");
  }
  const canonicalUrl = canonicalYouTubeUrl(videoKey);

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .upsert(
      {
        youtube_url: canonicalUrl,
        youtube_video_id: videoKey,
        title: params.title || null,
        channel_name: params.channelName || null,
        language: params.language,
      },
      { onConflict: "youtube_video_id" }
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
    const tier = await getUserTier(
      params.userId,
      params.smokeProEntitled === true,
    );
    if (tier === "free") {
      await enforceFreeHistoryCap(supabase, params.userId, FREE_LIMITS.historyItems);
    }
  }
}

/**
 * For free-tier users, keeps user_video_history at most `capacity` rows.
 * Called after the history upsert; if the row count exceeds capacity,
 * delete the oldest (lowest accessed_at) rows. Best-effort: errors are
 * logged but not thrown — a transient eviction failure is far better
 * than failing the whole summary write.
 */
export async function enforceFreeHistoryCap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  capacity: number,
): Promise<void> {
  // Find IDs to evict: anything past the capacity-th most-recent row.
  // Range is 0-indexed; range(capacity, capacity+99) returns rows past
  // the keep-window (up to 100 stale rows in one call).
  const { data, error } = await supabase
    .from("user_video_history")
    .select("id, accessed_at")
    .eq("user_id", userId)
    .order("accessed_at", { ascending: false })
    .range(capacity, capacity + 99);

  if (error) {
    logAppEvent("error", "[summarize-cache] history-cap query failed", {
      errorId: "HISTORY_CAP_QUERY_FAIL",
      userId,
      errorCode: error.code,
    });
    return;
  }
  if (!data || data.length === 0) return;

  const ids = data.map((r: { id: string }) => r.id);
  const del = await supabase.from("user_video_history").delete().in("id", ids);
  if (del.error) {
    logAppEvent("error", "[summarize-cache] history-cap delete failed", {
      errorId: "HISTORY_CAP_DELETE_FAIL",
      userId,
      count: ids.length,
      errorCode: del.error.code,
    });
  }
}

export {
  type PromptLocale,
  type CachedOutputLanguage,
  type VideoMetadata,
  type SummaryBody,
  type CachedSummary,
  type CacheWriteParams,
  type CachedTranscript,
  type TranscriptWriteParams,
  computeVideoKey,
} from "./video-cache-contract";

export { getCachedTranscript, writeCachedTranscript } from "./transcript-cache";
