import { createHash } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Language = "en" | "zh";
export type TranscriptSource = "manual_captions" | "auto_captions" | "whisper";

export interface VideoMetadata {
  readonly title: string;
  readonly channelName: string;
  readonly language: Language;
}

export interface SummaryBody {
  readonly transcript: string;
  readonly summary: string;
  readonly thinking: string | null;
  readonly transcriptSource: TranscriptSource;
  readonly enableThinking: boolean;
  readonly model: string;
  readonly processingTimeSeconds: number;
}

export interface CachedSummary extends VideoMetadata, SummaryBody {
  readonly videoId: string;
}

export interface CacheWriteParams extends VideoMetadata, SummaryBody {
  readonly youtubeUrl: string;
  readonly userId?: string;
}

export function computeUrlHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey);
}

// Supabase returns `PGRST116` for ".single() found no rows" — that's a normal
// cache miss, not a real error. Anything else is unexpected.
const PGRST_NO_ROWS = "PGRST116";

function isNoRowsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === PGRST_NO_ROWS
  );
}

/**
 * Cache read. Returns null on miss; fails open (null) on any error with a log
 * so a broken cache surfaces as "all requests re-billed through the LLM gateway"
 * rather than silent degradation.
 */
export async function getCachedSummary(
  youtubeUrl: string,
  enableThinking: boolean
): Promise<CachedSummary | null> {
  const supabase = createServiceRoleClient();
  if (!supabase) return null;

  try {
    const urlHash = computeUrlHash(youtubeUrl);
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("url_hash", urlHash)
      .maybeSingle();

    if (videoError && !isNoRowsError(videoError)) {
      console.error("[summarize-cache] video lookup failed (fail-open)", {
        urlHash,
        error: videoError,
      });
      return null;
    }
    if (!video) return null;

    const { data: summary, error: summaryError } = await supabase
      .from("summaries")
      .select("*")
      .eq("video_id", video.id)
      .eq("enable_thinking", enableThinking)
      .maybeSingle();

    if (summaryError && !isNoRowsError(summaryError)) {
      console.error("[summarize-cache] summary lookup failed (fail-open)", {
        videoId: video.id,
        error: summaryError,
      });
      return null;
    }
    if (!summary) return null;

    return {
      videoId: video.id,
      title: video.title ?? "",
      channelName: video.channel_name ?? "",
      language: (video.language ?? "en") as Language,
      transcript: summary.transcript ?? "",
      summary: summary.summary,
      thinking: summary.thinking,
      transcriptSource: summary.transcript_source as TranscriptSource,
      enableThinking: summary.enable_thinking,
      model: summary.model ?? "",
      processingTimeSeconds: summary.processing_time_seconds ?? 0,
    };
  } catch (err) {
    console.error("[summarize-cache] read failed (fail-open)", {
      youtubeUrl,
      err,
    });
    return null;
  }
}

/**
 * Cache write. Fails silently; logs with context. Runs after the user already
 * has their summary, so a failure here doesn't affect the response.
 */
export async function writeCachedSummary(
  params: CacheWriteParams
): Promise<void> {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    console.warn(
      "[summarize-cache] write skipped: service-role key not configured"
    );
    return;
  }

  // Enforce invariant: thinking is null when thinking was disabled.
  const thinking = params.enableThinking ? params.thinking : null;

  try {
    const urlHash = computeUrlHash(params.youtubeUrl);

    const { data: video, error: videoError } = await supabase
      .from("videos")
      .upsert(
        {
          youtube_url: params.youtubeUrl,
          url_hash: urlHash,
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
        thinking,
        transcript_source: params.transcriptSource,
        enable_thinking: params.enableThinking,
        model: params.model,
        processing_time_seconds: params.processingTimeSeconds,
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
