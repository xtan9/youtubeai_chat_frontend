import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { extractCaptions } from "@/lib/services/caption-extractor";
import { transcribeViaVps } from "@/lib/services/vps-client";
import {
  getCachedSummary,
  writeCachedSummary,
  type CachedSummary,
  type TranscriptSource,
  type Language,
} from "@/lib/services/summarize-cache";
import { detectLanguage } from "@/lib/services/language-detect";
import { buildSummarizationPrompt } from "@/lib/prompts/summarization";
import {
  formatSseEvent,
  streamLlmSummary,
  type LlmEvent,
} from "@/lib/services/llm-client";
import { checkRateLimit } from "@/lib/services/rate-limit";

export const maxDuration = 300;

const RequestBodySchema = z.object({
  youtube_url: z.string().min(1),
  enable_thinking: z.boolean().optional().default(false),
  include_transcript: z.boolean().optional().default(false),
});

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
      const sendEvent = (data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(formatSseEvent(data)));

      try {
        const cached = await getCachedSummary(youtube_url, enableThinking);
        if (cached) {
          streamCached(sendEvent, cached, { enableThinking, includeTranscript });
          controller.close();
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
        let language: Language;
        let title = "";
        let channelName = "";

        const captions = await extractCaptions(youtube_url);
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
          try {
            const vpsResult = await transcribeViaVps(youtube_url, request.signal);
            transcript = vpsResult.transcript;
            transcriptSource = "whisper";
            language = detectLanguage(transcript.slice(0, 500));
          } catch (err) {
            console.error("[summarize/stream] VPS transcription failed", {
              youtubeUrl: youtube_url,
              userId: user.id,
              err,
            });
            const message =
              err instanceof Error ? err.message : "Transcription failed";
            sendEvent({
              type: "error",
              message: `Could not process this video: ${message}`,
            });
            controller.close();
            return;
          }
        }

        sendEvent({
          type: "status",
          message: `Detected language: ${language}`,
        });

        if (includeTranscript) {
          sendEvent({ type: "full_transcript", text: transcript });
        }

        const prompt = buildSummarizationPrompt(transcript, language);
        let fullSummary = "";
        let fullThinking = "";

        for await (const event of streamLlmSummary({
          prompt,
          enableThinking,
          signal: request.signal,
        })) {
          forwardLlmEvent(event, sendEvent);
          if (event.type === "content") fullSummary += event.text;
          else if (event.type === "thinking") fullThinking += event.text;
        }

        const overallDuration = (Date.now() - overallStart) / 1000;

        if (fullSummary) {
          writeCachedSummary({
            youtubeUrl: youtube_url,
            title,
            channelName,
            language,
            transcript,
            summary: fullSummary,
            thinking: enableThinking ? fullThinking || null : null,
            transcriptSource,
            enableThinking,
            model: process.env.LLM_MODEL || "claude-sonnet-4-6",
            processingTimeSeconds: overallDuration,
            userId: user.id,
          }).catch((err) => {
            console.error("[summarize/stream] cache write failed (non-fatal)", {
              youtubeUrl: youtube_url,
              userId: user.id,
              err,
            });
          });
        }
      } catch (err) {
        console.error("[summarize/stream] unhandled error", {
          youtubeUrl: youtube_url,
          userId: user.id,
          err,
        });
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        sendEvent({ type: "error", message: `Error: ${message}` });
      } finally {
        controller.close();
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

function forwardLlmEvent(
  event: LlmEvent,
  sendEvent: (data: Record<string, unknown>) => void
) {
  switch (event.type) {
    case "status":
      sendEvent({ type: "status", message: event.message, stage: event.stage });
      return;
    case "thinking":
      sendEvent({ type: "thinking", text: event.text });
      return;
    case "content":
      sendEvent({ type: "content", text: event.text });
      return;
    case "timing":
      sendEvent({
        type: "summary",
        category: "general",
        total_time: event.total_time,
        summarize_time: event.summarize_time,
        transcribe_time: event.transcribe_time,
      });
      return;
  }
}

/**
 * Replay a cached summary as events in the same order as a fresh run
 * (thinking → content → transcript → summary), so the frontend accumulator
 * renders cache hits identically to live streams.
 */
function streamCached(
  sendEvent: (data: Record<string, unknown>) => void,
  cached: CachedSummary,
  opts: { enableThinking: boolean; includeTranscript: boolean }
) {
  sendEvent({
    type: "metadata",
    category: "general",
    cached: true,
    title: cached.title,
    channel: cached.channelName,
  });

  if (opts.enableThinking && cached.thinking) {
    sendEvent({ type: "thinking", text: cached.thinking });
  }

  sendEvent({ type: "content", text: cached.summary });

  if (opts.includeTranscript && cached.transcript) {
    sendEvent({ type: "full_transcript", text: cached.transcript });
  }

  sendEvent({
    type: "summary",
    category: "general",
    total_time: cached.processingTimeSeconds,
    summarize_time: cached.processingTimeSeconds,
    transcribe_time: 0,
  });
}
