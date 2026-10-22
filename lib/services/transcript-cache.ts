import { canonicalYouTubeUrl } from "./youtube-url";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { type TranscriptSegment } from "@/lib/types";
import { decodeCaptionEntities } from "@/lib/utils/decode-caption-entities";
import { logAppEvent, videoIdForLog } from "@/lib/observability";
import {
  type CachedTranscript,
  type TranscriptWriteParams,
  computeVideoKey,
  VideoRowSchema,
  TranscriptRowSchema,
  TranscriptWriteSchema,
} from "./video-cache-contract";

// True when segments carry no timing information — the placeholder shape
// emitted by migration 20260424000006's backfill and by the rollout-window
// VPS legacy-transcript fallback (caption-extractor.ts, vps-client.ts).
// Used by both the read-side eviction and the write-side guard so the
// cache invariant "all stored rows have real timing" is enforced from both
// directions; without the writer guard, a regressed VPS could re-create
// the same shape and the eviction would loop on every request.
function isNoTimingShape(
  segments: readonly TranscriptSegment[]
): boolean {
  return (
    segments.length === 1 &&
    segments[0].start === 0 &&
    segments[0].duration === 0
  );
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
    if (!videoKey) return null;
    const { data: videoRaw, error: videoError } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("youtube_video_id", videoKey)
      .maybeSingle();

    if (videoError) {
      logAppEvent(
        "error",
        "[summarize-cache] transcript: video lookup failed (fail-open)",
        {
          errorId: "TRANSCRIPT_VIDEO_LOOKUP_ERROR",
          videoId: videoIdForLog(youtubeUrl),
          errorName: videoError.message ? "SupabaseError" : "UnknownError",
        }
      );
      return null;
    }
    if (!videoRaw) return null;

    const videoParsed = VideoRowSchema.safeParse(videoRaw);
    if (!videoParsed.success) {
      logAppEvent(
        "error",
        "[summarize-cache] transcript: video row schema mismatch (fail-open)",
        {
          errorId: "TRANSCRIPT_VIDEO_SCHEMA_MISMATCH",
          videoId: videoIdForLog(youtubeUrl),
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
      logAppEvent(
        "error",
        "[summarize-cache] transcript: lookup failed (fail-open)",
        {
          errorId: "TRANSCRIPT_LOOKUP_ERROR",
          videoId: video.id,
          errorName: transcriptError.message ? "SupabaseError" : "UnknownError",
        }
      );
      return null;
    }
    if (!transcriptRaw) return null;

    const parsed = TranscriptRowSchema.safeParse(transcriptRaw);
    if (!parsed.success) {
      logAppEvent(
        "error",
        "[summarize-cache] transcript: row schema mismatch (fail-open)",
        {
          errorId: "TRANSCRIPT_SCHEMA_MISMATCH",
          videoId: video.id,
        }
      );
      return null;
    }

    // Evict the no-timing-info shape — single segment with start=0,
    // duration=0. Produced by migration 20260424000006's backfill of rows
    // cached before per-line timing was persisted, and by the rollout-
    // window VPS legacy fallback in caption-extractor / vps-client when
    // the VPS returns only `transcript`. Returning null forces re-fetch;
    // the writer below refuses to persist the same shape, so the pair
    // converges to "cache holds only rows with real timing."
    //
    // Real captions/whisper output always has positive duration on at
    // least one segment, so the false-evict surface is empty in practice.
    const rawSegments = parsed.data.segments;
    if (isNoTimingShape(rawSegments)) {
      logAppEvent(
        "warn",
        "[summarize-cache] transcript: legacy-backfill row evicted (will re-transcribe)",
        {
          errorId: "TRANSCRIPT_LEGACY_BACKFILL_EVICT",
          videoId: video.id,
        }
      );
      return null;
    }

    // Decode any XML entities that were persisted before the captions
    // pipeline started decoding them itself. See
    // lib/utils/decode-caption-entities for the bug class — without this
    // pass, rows written before that fix render `I&#39;m` literally.
    // Whisper-source rows pass through unchanged (no entities to begin
    // with), and freshly-written caption rows are already clean, so the
    // operation is idempotent on healthy data.
    const segments = rawSegments.map((s) => ({
      ...s,
      text: decodeCaptionEntities(s.text),
    }));

    return {
      videoId: video.id,
      title: video.title ?? "",
      channelName: video.channel_name ?? "",
      segments,
      transcriptSource: parsed.data.transcript_source,
      language: parsed.data.language,
    };
  } catch (err) {
    logAppEvent("error", "[summarize-cache] transcript read failed (fail-open)", {
      errorId: "TRANSCRIPT_READ_THREW",
      videoId: videoIdForLog(youtubeUrl),
      errorName: err instanceof Error ? err.name : typeof err,
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
      logAppEvent(
        "error",
        "[summarize-cache] transcript write skipped: service-role key not configured (cache disabled in production)",
        payload
      );
    } else {
      logAppEvent(
        "warn",
        "[summarize-cache] transcript write skipped: service-role key not configured",
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

  // Companion to the read-side eviction: refuse to persist the no-timing
  // shape so a regressed VPS that returns only `transcript` (rollout-
  // window legacy fallback) can't re-create rows the reader will just
  // evict next request, looping VPS captions/whisper compute. Skipping
  // the write keeps the user-visible stream working and the cache empty
  // for that video — next visit re-fetches, no loop.
  if (isNoTimingShape(params.segments)) {
    logAppEvent(
      "warn",
      "[summarize-cache] transcript: refusing to persist no-timing shape",
      {
        errorId: "TRANSCRIPT_LEGACY_SHAPE_NOT_PERSISTED",
        videoId: videoIdForLog(params.youtubeUrl),
      }
    );
    return;
  }

  // Sparse upsert: only include title/channel in the payload when the
  // caller actually has values. Supabase's upsert generates
  // `INSERT ... ON CONFLICT DO UPDATE SET col = EXCLUDED.col` only for
  // columns present in the payload, so omitting `title` here means an
  // existing populated row is NOT clobbered with NULL. This matters
  // because the route writes the transcript cache fire-and-forget; a
  // late-resolving transcript write must not overwrite metadata that
  // writeCachedSummary already persisted.
  const videoRow: Record<string, string | null> = {
    youtube_url: canonicalUrl,
    youtube_video_id: videoKey,
    language: params.language,
  };
  if (params.title) videoRow.title = params.title;
  if (params.channelName) videoRow.channel_name = params.channelName;

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .upsert(videoRow, { onConflict: "youtube_video_id" })
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
