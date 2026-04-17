import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { extractCaptions } from "@/lib/services/caption-extractor";
import { transcribeViaVps } from "@/lib/services/vps-client";
import {
  fetchVideoMetadata,
  type VideoMetadataResult,
} from "@/lib/services/video-metadata";
import {
  getCachedSummary,
  writeCachedSummary,
  type TranscriptSource,
  type PromptLocale,
  type ThinkingState,
} from "@/lib/services/summarize-cache";
import { detectLocale } from "@/lib/services/language-detect";
import { buildSummarizationPrompt } from "@/lib/prompts/summarization";
import {
  formatSseEvent,
  streamLlmSummary,
} from "@/lib/services/llm-client";
import { checkRateLimit } from "@/lib/services/rate-limit";
import {
  forwardLlmEvent,
  streamCached,
  type SendEvent,
} from "./stream-events";

export const maxDuration = 300;

// Public app → only https URLs on canonical YouTube hosts. Route-level filter
// is defense-in-depth; the video-id extractor narrows further.
const YOUTUBE_URL_RE =
  /^https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;
const RequestBodySchema = z.object({
  youtube_url: z
    .string()
    .url()
    .regex(YOUTUBE_URL_RE, "must be an https YouTube URL"),
  enable_thinking: z.boolean().optional().default(false),
  include_transcript: z.boolean().optional().default(false),
});

// Generic user-facing messages; full error details stay in server logs.
const USER_ERROR_PROCESS_FAILED =
  "Couldn't process this video. Please try again or try a different URL.";
const USER_ERROR_GENERIC =
  "Something went wrong generating the summary. Please try again.";

export type Stage =
  | "captions"
  | "vps"
  | "metadata"
  | "llm"
  | "cache"
  | "unknown";

function jsonError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>
) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function isAbortError(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = RequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, `Invalid request body: ${parsed.error.message}`);
  }
  const {
    youtube_url,
    enable_thinking: enableThinking,
    include_transcript: includeTranscript,
  } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError(401, "Unauthorized");

  const isAnonymous = user.is_anonymous ?? false;

  const { allowed, remaining } = await checkRateLimit(user.id, isAnonymous);
  if (!allowed) {
    return jsonError(429, "Rate limit exceeded. Please try again later.", {
      "X-RateLimit-Remaining": String(remaining),
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent: SendEvent = (data) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(formatSseEvent(data)));
        } catch (err) {
          if (!request.signal.aborted) {
            console.error("[summarize/stream] enqueue failed post-close", {
              err,
            });
          }
        }
      };

      const logStageError = (stage: Stage, err: unknown) => {
        console.error(`[summarize/stream] ${stage} failed`, {
          stage,
          youtubeUrl: youtube_url,
          userId: user.id,
          err,
        });
      };

      try {
        const cached = await getCachedSummary(youtube_url, enableThinking);
        if (cached) {
          streamCached(sendEvent, cached, { enableThinking, includeTranscript });
          return;
        }

        const overallStart = Date.now();
        sendEvent({ type: "metadata", category: "general", cached: false });
        sendEvent({
          type: "status",
          message: "Extracting captions...",
          stage: "transcribe",
        });

        let transcript: string;
        let transcriptSource: TranscriptSource;
        let language: PromptLocale;
        let title = "";
        let channelName = "";
        // Whisper-only. Kicked off before VPS transcription so oembed runs in
        // parallel with audio transcription. Resolved lazily at cache-write
        // time so the round-trip doesn't serialize with summarization.
        let metadataPromise: Promise<VideoMetadataResult> | null = null;
        let metadataFetchFailed = false;

        const transcribeStart = Date.now();
        let captions;
        try {
          captions = await extractCaptions(youtube_url);
        } catch (err) {
          if (isAbortError(err, request.signal)) return;
          logStageError("captions", err);
          sendEvent({ type: "error", message: USER_ERROR_PROCESS_FAILED });
          return;
        }

        if (captions) {
          transcript = captions.transcript;
          transcriptSource = captions.source;
          language = captions.language;
          title = captions.title;
          channelName = captions.channelName;
        } else {
          sendEvent({
            type: "status",
            message: "No captions found. Transcribing audio...",
            stage: "transcribe",
          });
          metadataPromise = fetchVideoMetadata(youtube_url, request.signal);
          try {
            const vpsResult = await transcribeViaVps(
              youtube_url,
              request.signal
            );
            transcript = vpsResult.transcript;
            transcriptSource = "whisper";
            language = detectLocale(transcript.slice(0, 500));
          } catch (err) {
            if (isAbortError(err, request.signal)) return;
            logStageError("vps", err);
            sendEvent({
              type: "error",
              message: USER_ERROR_PROCESS_FAILED,
            });
            return;
          }
        }
        const transcribeSeconds = (Date.now() - transcribeStart) / 1000;

        sendEvent({ type: "status", message: `Detected language: ${language}` });

        if (includeTranscript) {
          sendEvent({ type: "full_transcript", text: transcript });
        }

        const prompt = buildSummarizationPrompt(transcript, language);
        let fullSummary = "";
        let fullThinking = "";
        let summarizeSeconds: number | null = null;
        const llmStart = Date.now();

        try {
          for await (const event of streamLlmSummary({
            prompt,
            enableThinking,
            signal: request.signal,
          })) {
            forwardLlmEvent(event, sendEvent, transcribeSeconds);
            if (event.type === "content") fullSummary += event.text;
            else if (event.type === "thinking") fullThinking += event.text;
            else if (event.type === "timing")
              summarizeSeconds = event.summarizeSeconds;
          }
        } catch (err) {
          if (isAbortError(err, request.signal)) return;
          logStageError("llm", err);
          sendEvent({ type: "error", message: USER_ERROR_GENERIC });
          return;
        }

        // Fallback if the generator exited without emitting timing (e.g. a
        // future refactor skips the terminal event). Keep the value honest
        // rather than caching 0.
        const summarizeSecondsFinal =
          summarizeSeconds ?? (Date.now() - llmStart) / 1000;

        if (!fullSummary) return;

        if (metadataPromise) {
          const result = await metadataPromise;
          if (result.ok) {
            title = result.data.title;
            channelName = result.data.channelName;
          } else if (result.reason !== "aborted") {
            metadataFetchFailed = true;
            logStageError("metadata", result);
          }
        }

        // Always emit a terminal summary so the client accumulator closes
        // cleanly, even when we skip the cache write below.
        sendEvent({
          type: "summary",
          category: "general",
          total_time: summarizeSecondsFinal + transcribeSeconds,
          summarize_time: summarizeSecondsFinal,
          transcribe_time: transcribeSeconds,
        });

        // Skip caching when oembed failed so the next request retries instead
        // of being served a title-less row for life. "Video genuinely has no
        // metadata" (result.ok with empty strings) still caches.
        if (metadataFetchFailed) return;

        const thinkingState: ThinkingState = enableThinking
          ? { enableThinking: true, thinking: fullThinking || null }
          : { enableThinking: false, thinking: null };

        writeCachedSummary({
          youtubeUrl: youtube_url,
          title,
          channelName,
          language,
          transcript,
          summary: fullSummary,
          transcriptSource,
          model: process.env.LLM_MODEL || "claude-sonnet-4-6",
          processingTimeSeconds: (Date.now() - overallStart) / 1000,
          transcribeTimeSeconds: transcribeSeconds,
          summarizeTimeSeconds: summarizeSecondsFinal,
          userId: user.id,
          ...thinkingState,
        }).catch((err) => logStageError("cache", err));
      } catch (err) {
        if (isAbortError(err, request.signal)) return;
        logStageError("unknown", err);
        sendEvent({ type: "error", message: USER_ERROR_GENERIC });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed on abort — nothing to do.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-RateLimit-Remaining": String(remaining),
    },
  });
}
