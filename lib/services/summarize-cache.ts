import { createHash } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type Language = "en" | "zh";
export type TranscriptSource = "manual_captions" | "auto_captions" | "whisper";

export interface VideoMetadata {
  readonly title: string;
  readonly channelName: string;
  readonly language: Language;
}

/**
 * Discriminated on `enableThinking`, so the type system enforces the invariant
 * "thinking is null when thinking was not requested."
 */
export type ThinkingState =
  | { readonly enableThinking: true; readonly thinking: string | null }
  | { readonly enableThinking: false; readonly thinking: null };

export type SummaryBody = ThinkingState & {
  readonly transcript: string;
  readonly summary: string;
  readonly transcriptSource: TranscriptSource;
  readonly model: string;
  readonly processingTimeSeconds: number;
};

export type CachedSummary = VideoMetadata &
  SummaryBody & { readonly videoId: string };

export type CacheWriteParams = VideoMetadata &
  SummaryBody & { readonly youtubeUrl: string; readonly userId?: string };

export function computeUrlHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey);
}

// Shape of the rows we actually care about. We parse Supabase responses
// through these so a stale enum value or a dropped column is a loud cache
// miss, not a silently corrupted typed object.
const LanguageSchema = z.enum(["en", "zh"]);
const TranscriptSourceSchema = z.enum([
  "manual_captions",
  "auto_captions",
  "whisper",
]);

const VideoRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  channel_name: z.string().nullable(),
  language: LanguageSchema.nullable(),
});

const SummaryRowSchema = z.object({
  transcript: z.string().nullable(),
  summary: z.string(),
  thinking: z.string().nullable(),
  transcript_source: TranscriptSourceSchema,
  enable_thinking: z.boolean(),
  model: z.string().nullable(),
  processing_time_seconds: z.number().nullable(),
});

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
    const { data: videoRaw, error: videoError } = await supabase
      .from("videos")
      .select("id, title, channel_name, language")
      .eq("url_hash", urlHash)
      .maybeSingle();

    if (videoError) {
      console.error("[summarize-cache] video lookup failed (fail-open)", {
        urlHash,
        error: videoError,
      });
      return null;
    }
    if (!videoRaw) return null;

    const videoParsed = VideoRowSchema.safeParse(videoRaw);
    if (!videoParsed.success) {
      console.error("[summarize-cache] video row schema mismatch (fail-open)", {
        urlHash,
        issues: videoParsed.error.issues,
      });
      return null;
    }
    const video = videoParsed.data;

    const { data: summaryRaw, error: summaryError } = await supabase
      .from("summaries")
      .select(
        "transcript, summary, thinking, transcript_source, enable_thinking, model, processing_time_seconds"
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
      console.error(
        "[summarize-cache] summary row schema mismatch (fail-open)",
        { videoId: video.id, issues: summaryParsed.error.issues }
      );
      return null;
    }
    const s = summaryParsed.data;

    const thinkingState: ThinkingState = s.enable_thinking
      ? { enableThinking: true, thinking: s.thinking }
      : { enableThinking: false, thinking: null };

    return {
      videoId: video.id,
      title: video.title ?? "",
      channelName: video.channel_name ?? "",
      language: video.language ?? "en",
      transcript: s.transcript ?? "",
      summary: s.summary,
      transcriptSource: s.transcript_source,
      model: s.model ?? "",
      processingTimeSeconds: s.processing_time_seconds ?? 0,
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
        thinking: params.thinking,
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
