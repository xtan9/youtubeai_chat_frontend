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

const THINKING_INVARIANT_MESSAGE =
  "thinking must be null when enable_thinking is false";

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
    message: THINKING_INVARIANT_MESSAGE,
    path: ["thinking"],
  });

function isThinkingInvariantViolation(err: z.ZodError): boolean {
  return err.issues.some((i) => i.message === THINKING_INVARIANT_MESSAGE);
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

// Runs after the user already has their summary; failure logs but doesn't
// affect the response.
export async function writeCachedSummary(
  params: CacheWriteParams
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    console.warn(
      "[summarize-cache] write skipped: service-role key not configured"
    );
    return;
  }

  try {
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
      console.error("[summarize-cache] video upsert failed", {
        youtubeUrl: params.youtubeUrl,
        error: videoError,
      });
      return;
    }

    const { error: summaryError } = await supabase.from("summaries").upsert(
      {
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
      },
      { onConflict: "video_id,enable_thinking" }
    );

    if (summaryError) {
      console.error("[summarize-cache] summary upsert failed", {
        videoId: video.id,
        error: summaryError,
      });
      return;
    }

    if (params.userId) {
      const { error: historyError } = await supabase
        .from("user_video_history")
        .upsert(
          { user_id: params.userId, video_id: video.id },
          { onConflict: "user_id,video_id" }
        );
      if (historyError) {
        console.error("[summarize-cache] history upsert failed", {
          userId: params.userId,
          videoId: video.id,
          error: historyError,
        });
      }
    }
  } catch (err) {
    console.error("[summarize-cache] write failed", {
      youtubeUrl: params.youtubeUrl,
      err,
    });
  }
}
