import { z } from "zod";
import type { User } from "@supabase/supabase-js";
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
  DEFAULT_LLM_MODEL,
  formatSseEvent,
  streamLlmSummary,
} from "@/lib/services/llm-client";
import { checkRateLimit } from "@/lib/services/rate-limit";
import {
  forwardLlmEvent,
  streamCached,
  type SendEvent,
} from "./stream-events";
import type { LogStage } from "@/lib/stages";

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
const USER_ERROR_EMPTY_SUMMARY =
  "The model returned no summary. Please try again.";

export type { LogStage } from "@/lib/stages";

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

// Caller-disconnect is the only thing that counts as a silently-dropped abort.
// `err.name === "AbortError"` also fires on internal timeouts composed via
// AbortSignal.any — classifying those as aborts would silently hide VPS/LLM
// timeouts and leave the SSE stream closed with no error event. Always
// distinguish via `signal.aborted` (which is true only when the caller's own
// signal fired).
function isCallerAbort(signal: AbortSignal): boolean {
  return signal.aborted;
}

// Upstream failures warrant skipping the cache write + logging. Caller-abort
// is a different class — the user disconnected, it's not an oembed problem.
function isUpstreamMetadataFailure(
  result: VideoMetadataResult
): result is Extract<VideoMetadataResult, { ok: false }> & {
  reason: Exclude<
    Extract<VideoMetadataResult, { ok: false }>["reason"],
    "aborted"
  >;
} {
  return !result.ok && result.reason !== "aborted";
}

// Synthesize a stable Error for Sentry grouping when there's no underlying
// thrown error to wrap. Switch is exhaustive via `never` so a new reason
// in VideoMetadataResult fails compilation here.
function metadataErrorForLog(
  result: Extract<VideoMetadataResult, { ok: false }> & {
    reason: Exclude<
      Extract<VideoMetadataResult, { ok: false }>["reason"],
      "aborted"
    >;
  }
): unknown {
  switch (result.reason) {
    case "error":
      return result.error;
    case "non_ok":
      return new Error(`oembed non_ok (status ${result.status})`);
    case "timeout":
      return new Error("oembed timeout");
    case "schema":
      return new Error("oembed schema");
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
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
  let user: User | null;
  try {
    const { data, error } = await supabase.auth.getUser();
    // Client-side auth errors (missing/expired session, invalid JWT) surface
    // as status 400/401/403 and ARE "not authenticated" — return 401.
    // Server-side errors (status >= 500) or status-less failures (fetch
    // unreachable) mean we can't tell if the user is valid — return 503 so
    // on-call can alert on the rate instead of blaming users.
    if (error) {
      const status = error.status ?? 0;
      const isInfraError = status === 0 || status >= 500;
      if (isInfraError) {
        console.error("[summarize/stream] auth failed", {
          stage: "auth" satisfies LogStage,
          status,
          message: error.message,
        });
        return jsonError(503, "Auth service temporarily unavailable.");
      }
    }
    user = data.user;
  } catch (err) {
    console.error("[summarize/stream] auth threw", {
      stage: "auth" satisfies LogStage,
      err,
    });
    return jsonError(503, "Auth service temporarily unavailable.");
  }
  if (!user) return jsonError(401, "Unauthorized");

  const authedUser = user;
  const isAnonymous = authedUser.is_anonymous ?? false;

  const rateLimit = await checkRateLimit(authedUser.id, isAnonymous);
  // Surface fail-open at the route layer so the user/URL is bound to the
  // bypass in one log line — rate-limit.ts logs the infra cause, the route
  // logs the request that was waved through.
  if (rateLimit.reason === "fail_open") {
    console.error("[summarize/stream] rate-limit bypassed (fail-open)", {
      stage: "unknown" satisfies LogStage,
      errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
      userId: authedUser.id,
      youtubeUrl: youtube_url,
    });
  }
  if (!rateLimit.allowed) {
    return jsonError(429, "Rate limit exceeded. Please try again later.", {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Mode": rateLimit.reason,
    });
  }
  const remaining = rateLimit.remaining;
  const rateLimitMode = rateLimit.reason;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Explicit closed flag: set once in `finally`, checked before every
      // enqueue. Cheaper and far more robust than pattern-matching the
      // `TypeError` message on `enqueue` (runtime-specific wording that
      // would silently change classification across Node/Edge versions).
      let closed = false;
      const sendEvent: SendEvent = (data) => {
        if (request.signal.aborted || closed) return;
        try {
          controller.enqueue(encoder.encode(formatSseEvent(data)));
        } catch (err) {
          // If we still reach here, the controller died outside our control
          // — log unconditionally so the bug is visible.
          console.error("[summarize/stream] enqueue failed", {
            err,
            aborted: request.signal.aborted,
          });
        }
      };

      const logStageError = (stage: LogStage, err: unknown) => {
        console.error(`[summarize/stream] ${stage} failed`, {
          stage,
          youtubeUrl: youtube_url,
          userId: authedUser.id,
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
        // Whisper-only. The .catch at construction guards against unhandled
        // rejection if the LLM path errors before we await the promise.
        let metadataPromise: Promise<VideoMetadataResult> | null = null;

        const transcribeStart = Date.now();
        let captions;
        try {
          captions = await extractCaptions(youtube_url);
        } catch (err) {
          if (isCallerAbort(request.signal)) return;
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
          // Wrapping in Promise.resolve().then() normalizes any synchronous
          // throw from fetchVideoMetadata into a rejection that the .catch
          // can classify. The function is already async today, but the
          // wrapper is cheap belt-and-suspenders so a future refactor that
          // accidentally throws before `await` can't bypass this handler.
          metadataPromise = Promise.resolve()
            .then(() => fetchVideoMetadata(youtube_url, request.signal))
            .catch(
              (err): VideoMetadataResult =>
                request.signal.aborted
                  ? { ok: false, reason: "aborted" }
                  : { ok: false, reason: "error", error: err }
            );
          try {
            const vpsResult = await transcribeViaVps(
              youtube_url,
              request.signal
            );
            transcript = vpsResult.transcript;
            transcriptSource = "whisper";
            language = detectLocale(transcript.slice(0, 500));
          } catch (err) {
            if (isCallerAbort(request.signal)) return;
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
            forwardLlmEvent(event, sendEvent);
            if (event.type === "content") fullSummary += event.text;
            else if (event.type === "thinking") fullThinking += event.text;
            else if (event.type === "timing")
              summarizeSeconds = event.summarizeSeconds;
          }
        } catch (err) {
          if (isCallerAbort(request.signal)) return;
          logStageError("llm", err);
          sendEvent({ type: "error", message: USER_ERROR_GENERIC });
          return;
        }

        // Fallback if the generator exited without emitting timing (e.g. a
        // future refactor skips the terminal event). Keep the value honest
        // rather than caching 0.
        const summarizeSecondsFinal =
          summarizeSeconds ?? (Date.now() - llmStart) / 1000;

        // Empty output isn't a silent-close UX — surface it so the client
        // accumulator doesn't hang in "generating" state forever.
        if (!fullSummary) {
          logStageError("llm", new Error("empty summary from gateway"));
          sendEvent({ type: "error", message: USER_ERROR_EMPTY_SUMMARY });
          return;
        }

        // Capture processing time BEFORE awaiting metadata so the metric
        // doesn't include the oembed round-trip — a slow oembed would
        // otherwise inflate processing_time_seconds in the cache row.
        const processingTimeSeconds = (Date.now() - overallStart) / 1000;

        let metadataSkipCache = false;
        if (metadataPromise) {
          const result = await metadataPromise;
          if (result.ok) {
            title = result.data.title;
            channelName = result.data.channelName;
          } else if (isUpstreamMetadataFailure(result)) {
            metadataSkipCache = true;
            logStageError("metadata", metadataErrorForLog(result));
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

        // Skip the cache write on (a) upstream metadata failure, (b) caller
        // abort, or (c) missing title OR channel. Both fields drive the
        // cached UI header — either one blank makes the row user-visibly
        // broken, so both must be present or the cache hit is worse than
        // a re-run. Blank fields reach here from oembed success-with-empty
        // OR from caption-extractor when videoDetails lack title/author.
        if (metadataSkipCache || request.signal.aborted) return;
        if (!title || !channelName) {
          console.warn("[summarize/stream] CACHE_SKIP_EMPTY_HEADER", {
            errorId: "CACHE_SKIP_EMPTY_HEADER",
            youtubeUrl: youtube_url,
            source: transcriptSource,
            hasTitle: !!title,
            hasChannel: !!channelName,
          });
          return;
        }

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
          model: process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
          processingTimeSeconds,
          transcribeTimeSeconds: transcribeSeconds,
          summarizeTimeSeconds: summarizeSecondsFinal,
          userId: authedUser.id,
          ...thinkingState,
        }).catch((err) => logStageError("cache", err));
      } catch (err) {
        if (isCallerAbort(request.signal)) return;
        logStageError("unknown", err);
        sendEvent({ type: "error", message: USER_ERROR_GENERIC });
      } finally {
        closed = true;
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
      "X-RateLimit-Mode": rateLimitMode,
    },
  });
}
