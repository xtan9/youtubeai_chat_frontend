import { createHash } from "crypto";
import { z } from "zod";
import { extractVideoId } from "./youtube-url";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

export type PromptLocale = "en" | "zh";
export type TranscriptSource = "manual_captions" | "auto_captions" | "whisper";

export interface VideoMetadata {
  readonly title: string;
  readonly channelName: string;
  readonly language: PromptLocale;
}

// Discriminated on `enableThinking`, so the type system enforces the invariant
// "thinking is null when thinking was not requested."
export type ThinkingState =
  | { readonly enableThinking: true; readonly thinking: string | null }
  | { readonly enableThinking: false; readonly thinking: null };

export type SummaryBody = ThinkingState & {
  readonly transcript: string;
  readonly summary: string;
  readonly transcriptSource: TranscriptSource;
  readonly model: string;
  readonly processingTimeSeconds: number;
  readonly transcribeTimeSeconds: number;
  readonly summarizeTimeSeconds: number;
};

export type CachedSummary = VideoMetadata &
  SummaryBody & { readonly videoId: string };

export type CacheWriteParams = VideoMetadata &
  SummaryBody & { readonly youtubeUrl: string; readonly userId?: string };

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

const SummaryRowSchema = z
  .object({
    transcript: z.string().nullable(),
    summary: z.string(),
    thinking: z.string().nullable(),
    transcript_source: TranscriptSourceSchema,
    enable_thinking: z.boolean(),
    model: z.string().nullable(),
    processing_time_seconds: z.number().nullable(),
    transcribe_time_seconds: z.number().nullable(),
    summarize_time_seconds: z.number().nullable(),
  })
  .refine((s) => s.enable_thinking || s.thinking === null, {
    message: "thinking must be null when enable_thinking is false",
    path: ["thinking"],
  });

// Write-side schema is deliberately stricter than the read-side: new rows
// must have non-null transcript/model/timings. The read schema allows nulls
// for historical rows written before the split columns existed. Don't
// unify them without a backfill. The refine is a belt-and-suspenders guard
// against callers that bypassed the `ThinkingState` discriminated union via
// an `any` cast — the DB CHECK is the authoritative invariant.
const SummaryWriteSchema = z
  .object({
    video_id: z.string(),
    transcript: z.string(),
    summary: z.string().min(1),
    thinking: z.string().nullable(),
    transcript_source: TranscriptSourceSchema,
    enable_thinking: z.boolean(),
    model: z.string(),
    processing_time_seconds: z.number().min(0),
    transcribe_time_seconds: z.number().min(0),
    summarize_time_seconds: z.number().min(0),
  })
  .refine((s) => s.enable_thinking || s.thinking === null, {
    message: "thinking must be null when enable_thinking is false",
    path: ["thinking"],
  });

// Detect via structured issue fields, not the human-readable message — so
// rewording or localization of the message doesn't silently reclassify a
// data-integrity violation as generic schema drift.
function isThinkingInvariantViolation(err: z.ZodError): boolean {
  return err.issues.some(
    (i) => i.code === "custom" && i.path[0] === "thinking"
  );
}

/**
 * Fails open (null) on any error with a log so a broken cache surfaces as
 * "every request re-billed through the LLM gateway" rather than silent
 * degradation.
 */
export async function getCachedSummary(
  youtubeUrl: string,
  enableThinking: boolean
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

    const { data: summaryRaw, error: summaryError } = await supabase
      .from("summaries")
      .select(
        "transcript, summary, thinking, transcript_source, enable_thinking, model, processing_time_seconds, transcribe_time_seconds, summarize_time_seconds"
      )
      .eq("video_id", video.id)
      .eq("enable_thinking", enableThinking)
      .maybeSingle();

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
      if (isThinkingInvariantViolation(summaryParsed.error)) {
        // DB CHECK `summaries_thinking_consistent` is supposed to make this
        // unreachable. Reaching it means the constraint was bypassed or never
        // applied — treat as a data-integrity incident, not routine drift.
        console.error(
          "[summarize-cache] DATA INTEGRITY: thinking invariant violated in DB row",
          { videoId: video.id, issues: summaryParsed.error.issues }
        );
      } else {
        console.error(
          "[summarize-cache] summary row schema mismatch (fail-open)",
          { videoId: video.id, issues: summaryParsed.error.issues }
        );
      }
      return null;
    }
    const s = summaryParsed.data;

    const thinkingState: ThinkingState = s.enable_thinking
      ? { enableThinking: true, thinking: s.thinking }
      : { enableThinking: false, thinking: null };

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
      ...thinkingState,
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
    thinking: params.thinking,
    transcript_source: params.transcriptSource,
    enable_thinking: params.enableThinking,
    model: params.model,
    processing_time_seconds: params.processingTimeSeconds,
    transcribe_time_seconds: params.transcribeTimeSeconds,
    summarize_time_seconds: params.summarizeTimeSeconds,
  };

  const writeCheck = SummaryWriteSchema.safeParse(summaryRow);
  if (!writeCheck.success) {
    throw new Error(
      `summary write rejected by invariant check: ${writeCheck.error.message}`,
      { cause: writeCheck.error }
    );
  }

  const { error: summaryError } = await supabase
    .from("summaries")
    .upsert(writeCheck.data, { onConflict: "video_id,enable_thinking" });

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
