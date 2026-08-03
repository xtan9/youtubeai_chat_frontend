import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isTranscriptSource,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";

interface VideoMetadata {
  videoTitle: string | null;
  channelName: string | null;
  language: string | null;
  videoFetchFailed: boolean;
}

export interface VideoTranscriptDisclosure extends VideoMetadata {
  summaryId: string;
  videoId: string;
  transcript: string | null;
  source: TranscriptSource;
  createdAt: string;
}

export interface SummaryTranscriptDisclosure extends VideoMetadata {
  summaryId: string;
  transcript: string | null;
  summary: string;
  thinking: string | null;
  source: TranscriptSource;
  model: string | null;
  processingTimeSeconds: number | null;
  createdAt: string;
}

export class TranscriptDisclosureError extends Error {
  constructor(scope: string, detail: string) {
    super(`[transcript-disclosure:${scope}] ${detail}`);
    this.name = "TranscriptDisclosureError";
  }
}

function parseSource(row: Record<string, unknown>, context: string): TranscriptSource {
  const rawSource = String(row.transcript_source ?? "auto_captions");
  if (!isTranscriptSource(rawSource)) {
    throw new TranscriptDisclosureError(
      "source",
      `${context} has unknown transcript_source '${rawSource}'`,
    );
  }
  return rawSource;
}

async function readVideoMetadata(
  client: SupabaseClient,
  videoId: string,
  context: string,
): Promise<VideoMetadata> {
  try {
    const { data, error } = await client
      .from("videos")
      .select("title, channel_name, language")
      .eq("id", videoId)
      .maybeSingle();

    if (error) {
      console.error(`[${context}] video metadata fetch failed`, {
        videoId,
        message: error.message,
      });
      return {
        videoTitle: null,
        channelName: null,
        language: null,
        videoFetchFailed: true,
      };
    }

    if (!data) {
      return {
        videoTitle: null,
        channelName: null,
        language: null,
        videoFetchFailed: false,
      };
    }

    const row = data as Record<string, unknown>;
    return {
      videoTitle: (row.title as string | null) ?? null,
      channelName: (row.channel_name as string | null) ?? null,
      language: (row.language as string | null) ?? null,
      videoFetchFailed: false,
    };
  } catch (error) {
    console.error(`[${context}] video metadata fetch threw`, {
      videoId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      videoTitle: null,
      channelName: null,
      language: null,
      videoFetchFailed: true,
    };
  }
}

/** Read the newest transcript summary for a Video. */
export async function getVideoTranscriptDisclosure(
  client: SupabaseClient,
  videoId: string,
): Promise<VideoTranscriptDisclosure | null> {
  const { data, error } = await client
    .from("summaries")
    .select("id, video_id, transcript, transcript_source, created_at")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new TranscriptDisclosureError("summary", error.message);
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const source = parseSource(row, `video ${videoId}`);
  const metadata = await readVideoMetadata(
    client,
    videoId,
    "transcript-disclosure",
  );

  return {
    summaryId: String(row.id),
    videoId,
    transcript: (row.transcript as string | null) ?? null,
    source,
    ...metadata,
    createdAt: String(row.created_at),
  };
}

/** Read a transcript summary by id, including its optional Video metadata. */
export async function getTranscriptDisclosureBySummaryId(
  client: SupabaseClient,
  summaryId: string,
): Promise<SummaryTranscriptDisclosure | null> {
  const { data, error } = await client
    .from("summaries")
    .select(
      "id, video_id, transcript, summary, thinking, transcript_source, model, processing_time_seconds, created_at",
    )
    .eq("id", summaryId)
    .maybeSingle();
  if (error) {
    throw new TranscriptDisclosureError("summary", error.message);
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const source = parseSource(row, `summary ${summaryId}`);
  const videoId = row.video_id ? String(row.video_id) : null;
  const metadata = videoId
    ? await readVideoMetadata(client, videoId, "transcript-disclosure")
    : {
        videoTitle: null,
        channelName: null,
        language: null,
        videoFetchFailed: false,
      };

  return {
    summaryId: String(row.id),
    transcript: (row.transcript as string | null) ?? null,
    summary: String(row.summary ?? ""),
    thinking: (row.thinking as string | null) ?? null,
    ...metadata,
    source,
    model: (row.model as string | null) ?? null,
    processingTimeSeconds:
      typeof row.processing_time_seconds === "number"
        ? row.processing_time_seconds
        : null,
    createdAt: String(row.created_at),
  };
}
