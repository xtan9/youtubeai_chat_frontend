import { createHash } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface CachedSummary {
  videoId: string;
  title: string;
  channelName: string;
  language: string;
  transcript: string;
  summary: string;
  thinking: string | null;
  transcriptSource: string;
  enableThinking: boolean;
  model: string | null;
  processingTime: number | null;
}

export interface CacheWriteParams {
  youtubeUrl: string;
  title: string;
  channelName: string;
  language: string;
  transcript: string;
  summary: string;
  thinking: string | null;
  transcriptSource: string;
  enableThinking: boolean;
  model: string;
  processingTimeSeconds: number;
  userId?: string;
}

export function computeUrlHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

/**
 * Creates a Supabase client with service-role credentials.
 * Used for cache operations that need to bypass RLS.
 * Returns null if credentials are not configured.
 */
function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey);
}

/**
 * Look up a cached summary by YouTube URL and thinking preference.
 * Returns null on cache miss or any error (fail-open).
 */
export async function getCachedSummary(
  youtubeUrl: string,
  enableThinking: boolean
): Promise<CachedSummary | null> {
  try {
    const supabase = createServiceRoleClient();
    if (!supabase) return null;

    const urlHash = computeUrlHash(youtubeUrl);
    const { data: video } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("url_hash", urlHash)
      .single();

    if (!video) return null;

    const { data: summary } = await supabase
      .from("summaries")
      .select("*")
      .eq("video_id", video.id)
      .eq("enable_thinking", enableThinking)
      .single();

    if (!summary) return null;

    return {
      videoId: video.id,
      title: video.title,
      channelName: video.channel_name,
      language: video.language,
      transcript: summary.transcript,
      summary: summary.summary,
      thinking: summary.thinking,
      transcriptSource: summary.transcript_source,
      enableThinking: summary.enable_thinking,
      model: summary.model,
      processingTime: summary.processing_time_seconds,
    };
  } catch {
    return null;
  }
}

/**
 * Write a summary to the cache. Fails silently (logs errors).
 */
export async function writeCachedSummary(
  params: CacheWriteParams
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    if (!supabase) {
      console.warn("Cache write skipped: Supabase service-role key not configured");
      return;
    }

    const urlHash = computeUrlHash(params.youtubeUrl);

    const { data: video, error: videoError } = await supabase
      .from("videos")
      .upsert(
        {
          youtube_url: params.youtubeUrl,
          url_hash: urlHash,
          title: params.title,
          channel_name: params.channelName,
          language: params.language,
        },
        { onConflict: "url_hash" }
      )
      .select("id")
      .single();

    if (videoError || !video) {
      console.error("Failed to upsert video:", videoError);
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
      },
      { onConflict: "video_id,enable_thinking" }
    );

    if (summaryError) {
      console.error("Failed to upsert summary:", summaryError);
      return;
    }

    if (params.userId) {
      await supabase
        .from("user_video_history")
        .upsert(
          { user_id: params.userId, video_id: video.id },
          { onConflict: "user_id,video_id" }
        );
    }
  } catch (err) {
    console.error("Cache write failed:", err);
  }
}
