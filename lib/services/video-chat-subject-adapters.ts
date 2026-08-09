import "server-only";
import { z } from "zod";
import {
  SAMPLES,
  type HeroSampleBase,
  type HeroSampleSummary,
  type SampleMeta,
} from "@/app/components/hero-demo-data";
import { isHeroDemoVideoId } from "@/lib/constants/hero-demo-ids";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import { TranscriptSegmentSchema } from "@/lib/types";
import { logAppEvent } from "@/lib/observability";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  readSuggestedFollowups,
  writeSuggestedFollowups,
  type SuggestedFollowups,
} from "./suggested-followups";
import type {
  CanonicalVideoIdentity,
  SuggestionCacheCapability,
  VideoChatSubject,
  VideoChatSubjectAdapter,
  VideoChatSubjectAdapterResult,
  VideoGrounding,
  VideoGroundingResolution,
} from "./video-chat-subject";
import { memoizeVideoGroundingLoader } from "./video-chat-subject";

const DatabaseVideoRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  channel_name: z.string().nullable(),
  language: z.enum(["en", "zh"]).nullable(),
});

const TranscriptSourceSchema = z.enum([
  "manual_captions",
  "auto_captions",
  "whisper",
]);
const PromptLocaleSchema = z.enum(["en", "zh"]);
const HeroSourceLanguageSchema = z.enum(SUPPORTED_LANGUAGE_CODES);
const OutputLanguageSchema = z.enum(SUPPORTED_LANGUAGE_CODES);

const DatabaseTranscriptRowSchema = z.object({
  video_id: z.string().min(1),
  segments: z.array(TranscriptSegmentSchema).min(1),
  transcript_source: TranscriptSourceSchema,
  language: PromptLocaleSchema,
});

const DatabaseSummaryRowSchema = z.object({
  video_id: z.string().min(1),
  transcript: z.string().nullable(),
  summary: z.string(),
  transcript_source: TranscriptSourceSchema,
  model: z.string().nullable(),
  processing_time_seconds: z.number().nullable(),
  transcribe_time_seconds: z.number().nullable(),
  summarize_time_seconds: z.number().nullable(),
  output_language: OutputLanguageSchema.nullable(),
});

const HeroSampleBaseSchema = z.object({
  id: z.string().min(1),
  segments: z.array(TranscriptSegmentSchema),
  nativeLanguage: z.string().nullable(),
});

const HeroSampleSummarySchema = z.object({
  id: z.string().min(1),
  language: z.string().min(1),
  summary: z.string().min(1),
  model: z.string().min(1),
});

type DatabaseVideoRow = z.infer<typeof DatabaseVideoRowSchema>;
type DatabaseServiceRoleClient = NonNullable<
  ReturnType<typeof getServiceRoleClient>
>;

function statelessHeroDemoSubject(
  identity: CanonicalVideoIdentity,
  samples: ReadonlyArray<SampleMeta>,
): VideoChatSubject {
  return {
    identity,
    source: "hero_demo",
    grounding: memoizeVideoGroundingLoader(() =>
      loadHeroDemoGrounding(identity, samples),
    ),
  };
}

function databaseSubject(
  identity: CanonicalVideoIdentity,
  video: DatabaseVideoRow,
  supabase: DatabaseServiceRoleClient,
): VideoChatSubject {
  const videoId = video.id;
  const suggestionCache: SuggestionCacheCapability = {
    videoId,
    read: () => readSuggestedFollowups(videoId),
    write: (followups: SuggestedFollowups) =>
      writeSuggestedFollowups(videoId, followups),
  };

  return {
    identity,
    source: "database",
    retainedThread: { videoId },
    entitlement: { videoId },
    suggestionCache,
    grounding: memoizeVideoGroundingLoader(() =>
      loadDatabaseGrounding(supabase, video, identity.youtubeVideoId),
    ),
  };
}

function groundingUnavailable(
  event: string,
  errorId: string,
  videoId: string,
  errorClass: string,
): VideoGroundingResolution {
  logAppEvent("error", event, { errorId, videoId, errorClass });
  return { status: "unavailable" };
}

function isNoTimingShape(
  segments: ReadonlyArray<{ start: number; duration: number }>,
): boolean {
  return (
    segments.length === 1 &&
    segments[0].start === 0 &&
    segments[0].duration === 0
  );
}

async function loadHeroDemoGrounding(
  identity: CanonicalVideoIdentity,
  samples: ReadonlyArray<SampleMeta>,
): Promise<VideoGroundingResolution> {
  const sample = samples.find(
    (candidate) => candidate.id === identity.youtubeVideoId,
  );
  if (!sample) {
    return groundingUnavailable(
      "[video-chat-subject] Hero Demo registry drift",
      "HERO_DEMO_REGISTRY_DRIFT",
      identity.youtubeVideoId,
      "RegistryDrift",
    );
  }

  let base: HeroSampleBase;
  try {
    base = await sample.loadBase();
  } catch (error) {
    return groundingUnavailable(
      "[video-chat-subject] Hero Demo base load failed",
      "HERO_DEMO_BASE_LOAD_FAILED",
      identity.youtubeVideoId,
      error instanceof Error ? error.name : "HeroDemoBaseLoadError",
    );
  }

  const parsedBase = HeroSampleBaseSchema.safeParse(base);
  if (!parsedBase.success || parsedBase.data.id !== identity.youtubeVideoId) {
    return groundingUnavailable(
      "[video-chat-subject] Hero Demo base schema mismatch",
      "VIDEO_CHAT_SUBJECT_HERO_DEMO_BASE_SCHEMA_MISMATCH",
      identity.youtubeVideoId,
      "SchemaMismatch",
    );
  }

  if (
    parsedBase.data.segments.length === 0 ||
    isNoTimingShape(parsedBase.data.segments)
  ) {
    logAppEvent("info", "[video-chat-subject] Hero Demo Grounding not ready", {
      errorId: "VIDEO_CHAT_SUBJECT_HERO_DEMO_GROUNDING_NOT_READY",
      videoId: identity.youtubeVideoId,
      reason: "not_ready",
    });
    return { status: "not_ready" };
  }

  const sourceLanguage = HeroSourceLanguageSchema.safeParse(
    parsedBase.data.nativeLanguage,
  );
  if (!sourceLanguage.success) {
    return groundingUnavailable(
      "[video-chat-subject] Hero Demo source language invalid",
      "VIDEO_CHAT_SUBJECT_HERO_DEMO_SOURCE_LANGUAGE_INVALID",
      identity.youtubeVideoId,
      "SchemaMismatch",
    );
  }

  let summary: HeroSampleSummary;
  try {
    summary = await sample.loadSummary(sourceLanguage.data);
  } catch (error) {
    return groundingUnavailable(
      "[video-chat-subject] Hero Demo Summary load failed",
      "HERO_DEMO_SUMMARY_LOAD_FAILED",
      identity.youtubeVideoId,
      error instanceof Error ? error.name : "HeroDemoSummaryLoadError",
    );
  }

  const parsedSummary = HeroSampleSummarySchema.safeParse(summary);
  if (
    !parsedSummary.success ||
    parsedSummary.data.id !== identity.youtubeVideoId ||
    parsedSummary.data.language !== sourceLanguage.data
  ) {
    return groundingUnavailable(
      "[video-chat-subject] Hero Demo Grounding schema mismatch",
      "VIDEO_CHAT_SUBJECT_HERO_DEMO_GROUNDING_SCHEMA_MISMATCH",
      identity.youtubeVideoId,
      "SchemaMismatch",
    );
  }

  const title = sample.title;
  const channelName = sample.channel;
  const grounding: VideoGrounding = {
    transcript: {
      videoId: identity.youtubeVideoId,
      title,
      channelName,
      segments: parsedBase.data.segments,
      transcriptSource: "auto_captions",
      language: sourceLanguage.data,
    },
    summary: {
      videoId: identity.youtubeVideoId,
      title,
      channelName,
      language: sourceLanguage.data,
      transcript: "",
      summary: parsedSummary.data.summary,
      transcriptSource: "auto_captions",
      model: parsedSummary.data.model,
      processingTimeSeconds: 0,
      transcribeTimeSeconds: 0,
      summarizeTimeSeconds: 0,
      outputLanguage: null,
    },
  };

  return { status: "ready", grounding };
}

async function loadDatabaseGrounding(
  supabase: DatabaseServiceRoleClient,
  video: DatabaseVideoRow,
  youtubeVideoId: string,
): Promise<VideoGroundingResolution> {
  try {
    const [transcriptResult, summaryResult] = await Promise.all([
      supabase
        .from("video_transcripts")
        .select("video_id, segments, transcript_source, language")
        .eq("video_id", video.id)
        .maybeSingle(),
      supabase
        .from("summaries")
        .select(
          "video_id, transcript, summary, transcript_source, model, processing_time_seconds, transcribe_time_seconds, summarize_time_seconds, output_language",
        )
        .eq("video_id", video.id)
        .is("output_language", null)
        .maybeSingle(),
    ]);

    if (transcriptResult.error) {
      return groundingUnavailable(
        "[video-chat-subject] database Transcript lookup failed",
        "VIDEO_CHAT_SUBJECT_DATABASE_TRANSCRIPT_LOOKUP_FAILED",
        video.id,
        "SupabaseError",
      );
    }
    if (summaryResult.error) {
      return groundingUnavailable(
        "[video-chat-subject] database Summary lookup failed",
        "VIDEO_CHAT_SUBJECT_DATABASE_SUMMARY_LOOKUP_FAILED",
        video.id,
        "SupabaseError",
      );
    }

    if (!transcriptResult.data || !summaryResult.data) {
      return { status: "not_ready" };
    }

    const transcript = DatabaseTranscriptRowSchema.safeParse(
      transcriptResult.data,
    );
    const summary = DatabaseSummaryRowSchema.safeParse(summaryResult.data);
    if (!transcript.success || !summary.success) {
      return groundingUnavailable(
        "[video-chat-subject] database Grounding schema mismatch",
        "VIDEO_CHAT_SUBJECT_DATABASE_GROUNDING_SCHEMA_MISMATCH",
        video.id,
        "SchemaMismatch",
      );
    }

    if (
      transcript.data.video_id !== video.id ||
      summary.data.video_id !== video.id
    ) {
      return groundingUnavailable(
        "[video-chat-subject] database Grounding Video mismatch",
        "VIDEO_CHAT_SUBJECT_DATABASE_GROUNDING_VIDEO_MISMATCH",
        youtubeVideoId,
        "SchemaMismatch",
      );
    }

    // The query is scoped to output_language IS NULL. Keep this explicit
    // after validation so a translated row can never satisfy Grounding if a
    // mock, proxy, or stale PostgREST schema returns the wrong row.
    if (summary.data.output_language !== null) {
      return { status: "not_ready" };
    }

    if (isNoTimingShape(transcript.data.segments)) {
      return { status: "not_ready" };
    }

    const title = video.title ?? "";
    const channelName = video.channel_name ?? "";
    const language = video.language ?? transcript.data.language;

    return {
      status: "ready",
      grounding: {
        transcript: {
          videoId: video.id,
          title,
          channelName,
          segments: transcript.data.segments,
          transcriptSource: transcript.data.transcript_source,
          language,
        },
        summary: {
          videoId: video.id,
          title,
          channelName,
          language,
          transcript: summary.data.transcript ?? "",
          summary: summary.data.summary,
          transcriptSource: summary.data.transcript_source,
          model: summary.data.model ?? "",
          processingTimeSeconds: summary.data.processing_time_seconds ?? 0,
          transcribeTimeSeconds:
            summary.data.transcribe_time_seconds ?? 0,
          summarizeTimeSeconds: summary.data.summarize_time_seconds ?? 0,
          outputLanguage: null,
        },
      },
    };
  } catch (error) {
    return groundingUnavailable(
      "[video-chat-subject] database Grounding read threw",
      "VIDEO_CHAT_SUBJECT_DATABASE_GROUNDING_READ_FAILED",
      youtubeVideoId,
      error instanceof Error ? error.name : "DatabaseAdapterError",
    );
  }
}

export function createHeroDemoVideoChatSubjectAdapter(
  samples: ReadonlyArray<SampleMeta> = SAMPLES,
): VideoChatSubjectAdapter {
  return {
    kind: "hero_demo",
    async resolve(
      identity: CanonicalVideoIdentity,
    ): Promise<VideoChatSubjectAdapterResult> {
      // The resolver only selects this adapter for the allowlist. Keep the
      // guard here as a defense for direct adapter callers without ever
      // falling through to the database source.
      if (!isHeroDemoVideoId(identity.youtubeVideoId)) {
        return { status: "not_ready" };
      }
      return {
        status: "resolved",
        subject: statelessHeroDemoSubject(identity, samples),
      };
    },
  };
}

export function createDatabaseVideoChatSubjectAdapter(): VideoChatSubjectAdapter {
  return {
    kind: "database",
    async resolve(
      identity: CanonicalVideoIdentity,
    ): Promise<VideoChatSubjectAdapterResult> {
      const supabase = getServiceRoleClient();
      if (!supabase) {
        logAppEvent("error", "[video-chat-subject] database client unavailable", {
          errorId: "VIDEO_CHAT_SUBJECT_DATABASE_UNAVAILABLE",
          videoId: identity.youtubeVideoId,
          errorClass: "ServiceRoleUnavailable",
        });
        return { status: "unavailable" };
      }

      try {
        // Resolve the Video once. The resulting UUID is captured by every
        // persistence-backed capability and by the lazy Grounding loader.
        const { data, error } = await supabase
          .from("videos")
          .select("id, title, channel_name, language")
          .eq("youtube_video_id", identity.youtubeVideoId)
          .maybeSingle();

        if (error) {
          logAppEvent("error", "[video-chat-subject] database lookup failed", {
            errorId: "VIDEO_CHAT_SUBJECT_DATABASE_LOOKUP_FAILED",
            videoId: identity.youtubeVideoId,
            errorClass: "SupabaseError",
          });
          return { status: "unavailable" };
        }

        if (!data) return { status: "not_ready" };

        const parsed = DatabaseVideoRowSchema.safeParse(data);
        if (!parsed.success) {
          logAppEvent(
            "error",
            "[video-chat-subject] database row schema mismatch",
            {
              errorId: "VIDEO_CHAT_SUBJECT_DATABASE_SCHEMA_MISMATCH",
              videoId: identity.youtubeVideoId,
              errorClass: "SchemaMismatch",
            },
          );
          return { status: "unavailable" };
        }

        return {
          status: "resolved",
          subject: databaseSubject(identity, parsed.data, supabase),
        };
      } catch (error) {
        logAppEvent("error", "[video-chat-subject] database lookup threw", {
          errorId: "VIDEO_CHAT_SUBJECT_DATABASE_LOOKUP_FAILED",
          videoId: identity.youtubeVideoId,
          errorName: error instanceof Error ? error.name : typeof error,
          errorClass: "DatabaseAdapterError",
        });
        return { status: "unavailable" };
      }
    },
  };
}

export const heroDemoVideoChatSubjectAdapter =
  createHeroDemoVideoChatSubjectAdapter();

export const databaseVideoChatSubjectAdapter =
  createDatabaseVideoChatSubjectAdapter();
