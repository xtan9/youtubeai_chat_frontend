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
  fetchVpsMetadata,
  primarySubtag,
  type VpsMetadataResult,
} from "@/lib/services/vps-metadata";
import {
  getCachedSummary,
  writeCachedSummary,
  type TranscriptSource,
  type PromptLocale,
  type ThinkingState,
} from "@/lib/services/summarize-cache";
import { detectLocale } from "@/lib/services/language-detect";
import { buildSummarizationPrompt } from "@/lib/prompts/summarization";
import { formatSseEvent, streamLlmSummary } from "@/lib/services/llm-client";
import {
  CLASSIFIER_EXCERPT_CHARS,
  HAIKU_CHAR_BUDGET,
  SONNET_CHAR_BUDGET,
  HAIKU,
  LONG_TOKENS,
  SHORT_TOKENS,
  chooseModel,
  classifyContent,
  getTranscriptMetadata,
} from "@/lib/services/model-routing";
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

// Same rationale as metadataErrorForLog but for the VPS /metadata client.
// Unwraps `reason: "error"` to its inner cause so Sentry groups on the
// actual thrown error rather than the Result wrapper; synthesizes a
// stable Error for the no-inner-error reasons. Exhaustive via `never`.
function vpsMetadataErrorForLog(
  result: Extract<VpsMetadataResult, { ok: false }> & {
    reason: Exclude<
      Extract<VpsMetadataResult, { ok: false }>["reason"],
      "aborted"
    >;
  }
): unknown {
  switch (result.reason) {
    case "error":
      return result.error;
    case "non_ok":
      return new Error(`vps metadata non_ok (status ${result.status})`);
    case "timeout":
      return new Error("vps metadata timeout");
    case "schema":
      // Embed the first zod issue path for grouping — a pure
      // "vps metadata schema" would collide across unrelated field
      // regressions.
      return new Error(
        `vps metadata schema (${result.issues[0]?.path.join(".") ?? "?"})`
      );
    case "config":
      return new Error("vps metadata config missing");
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

  // Status codes that mean "this request is not authenticated" as opposed
  // to "the auth service is broken." AuthSessionMissingError + friends are
  // 400; AuthApiError for bad JWT is 401; forbidden responses are 403.
  // Everything else (including 408 request-timeout, 429 rate-limited-at-
  // Supabase, any 5xx, and status-less fetch failures) is infra and must
  // surface as 503 so we don't silently 401 users during outages.
  const AUTH_CLIENT_ERROR_STATUSES = new Set([400, 401, 403]);
  const supabase = await createClient();
  let user: User | null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_ERROR_STATUSES.has(error.status ?? -1)) {
      console.error("[summarize/stream] auth failed", {
        stage: "auth" satisfies LogStage,
        status: error.status ?? null,
        message: error.message,
      });
      return jsonError(503, "Auth service temporarily unavailable.");
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
  // Bind the user + URL to the bypass in one log line so dashboards can
  // alert without joining against rate-limit.ts's infra-cause log. Do NOT
  // surface this distinction in the HTTP response — exposing fail_open to
  // clients tells abusers exactly when our abuse wall is down.
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
    });
  }
  const remaining = rateLimit.remaining;

  // Flag lives in the stream closure so the `cancel()` hook can flip it
  // when the consumer tears down the reader mid-flight. `start()` sets it
  // in its own `finally` on normal completion; either path makes
  // subsequent `sendEvent` calls no-op instead of writing to a dead
  // controller.
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
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

        // Ask the VPS for the video's language + available caption codes
        // up front. This drives both:
        //   - which caption track to request from /captions (avoids
        //     youtube-transcript-plus picking tracks[0], which is
        //     arbitrarily ordered and produced Arabic-for-French before)
        //   - the whisper --language pin when we fall back to /transcribe
        //
        // Graceful degradation: any failure (config, network, schema,
        // timeout) produces `detectedLang = null` and the whole chain
        // falls back to the legacy "no hint" flow. The feature is
        // strictly additive — never fatal.
        const vpsMeta = await fetchVpsMetadata(youtube_url, request.signal);
        if (isCallerAbort(request.signal)) return;
        let detectedLang: string | null = null;
        let availableCaptions: readonly string[] = [];
        if (vpsMeta.ok) {
          // Normalize to primary subtag so the "zh" short-circuit below
          // still fires when the VPS returns `zh-Hans` or similar. Also
          // the `availableCaptions` list from yt-dlp can contain mixed
          // tagged/untagged entries; normalizing both sides keeps the
          // .includes("en") check honest.
          detectedLang = primarySubtag(vpsMeta.data.language);
          availableCaptions = vpsMeta.data.availableCaptions.map(primarySubtag);
        } else if (vpsMeta.reason !== "aborted") {
          // Suppress alert-level logging when the VPS lacks the new
          // /metadata endpoint — during the deploy window (frontend ships
          // before the backend), every request would fire a false alarm.
          // Other non_ok statuses (500, etc.) still log at error level.
          if (vpsMeta.reason === "non_ok" && vpsMeta.status === 404) {
            console.warn("[summarize/stream] metadata endpoint unavailable", {
              errorId: "VPS_METADATA_404",
              status: 404,
              youtubeUrl: youtube_url,
            });
          } else {
            logStageError("metadata", vpsMetadataErrorForLog(vpsMeta));
          }
        }

        let captions;
        try {
          captions = await extractCaptions(
            youtube_url,
            request.signal,
            detectedLang ?? undefined
          );
        } catch (err) {
          if (isCallerAbort(request.signal)) return;
          logStageError("captions", err);
          sendEvent({ type: "error", message: USER_ERROR_PROCESS_FAILED });
          return;
        }

        // If the detected-language caption track isn't available but an
        // English one is, retry once with `lang="en"`. English captions
        // are a lower-quality but acceptable fallback per product
        // decision — preferable to paying for whisper when a usable
        // track already exists. Skipped when we don't have a detected
        // language (legacy path), when detected is already English, or
        // when `availableCaptions` doesn't promise an English track.
        if (
          !captions &&
          detectedLang &&
          detectedLang !== "en" &&
          availableCaptions.includes("en")
        ) {
          try {
            captions = await extractCaptions(
              youtube_url,
              request.signal,
              "en"
            );
          } catch (err) {
            if (isCallerAbort(request.signal)) return;
            logStageError("captions", err);
            sendEvent({ type: "error", message: USER_ERROR_PROCESS_FAILED });
            return;
          }
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
          // Wrapping in .then() normalizes any synchronous throw into a
          // rejection that the downstream .catch can classify, so a
          // refactor that drops `async` on fetchVideoMetadata can't
          // bypass the handler.
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
              request.signal,
              detectedLang ?? undefined
            );
            transcript = vpsResult.transcript;
            transcriptSource = "whisper";
            // PromptLocale stays binary (en|zh). If we pinned zh, trust
            // that; for every other detected language we still run
            // detectLocale on the transcript to catch CJK output from
            // mis-detection (or legacy "no hint" calls).
            language =
              detectedLang === "zh"
                ? "zh"
                : detectLocale(transcript.slice(0, 500));
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

        // Surface the BCP-47 detectedLang (e.g. "fr", "zh-Hans") when we have
        // it — the PromptLocale is binary (en|zh) and tells the user "en" for
        // every non-CJK video, which reads as "we think your French video is
        // English." Fall back to PromptLocale only when /metadata didn't
        // return a signal (e.g. VPS outage, pre-endpoint deploy).
        sendEvent({
          type: "status",
          message: `Detected language: ${detectedLang ?? language}`,
          stage: "summarize",
        });

        if (includeTranscript) {
          sendEvent({ type: "full_transcript", text: transcript });
        }

        // Resolve oembed metadata NOW (not after the LLM call) so the
        // classifier sees a real title on the Whisper path. By this point
        // VPS transcription already took minutes, so the oembed fetch has
        // almost always resolved — the await is effectively free.
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

        // Routing: compute metadata, run classifier in the middle zone,
        // pick a model via chooseModel, log the decision.
        const metadata = getTranscriptMetadata(transcript, language);
        const classifierInRange =
          metadata.tokens >= SHORT_TOKENS && metadata.tokens <= LONG_TOKENS;
        const classifier = classifierInRange
          ? await classifyContent({
              transcriptExcerpt: transcript.slice(0, CLASSIFIER_EXCERPT_CHARS),
              title,
              language,
              signal: request.signal,
            })
          : null;
        if (isCallerAbort(request.signal)) return;
        const decision = chooseModel(metadata, classifier);

        console.log("[summarize/stream] routing_decision", {
          event: "routing_decision",
          youtubeUrl: youtube_url,
          userId: authedUser.id,
          model: decision.model,
          reason: decision.reason,
          tokens: metadata.tokens,
          wordCount: metadata.wordCount,
          classifierRan: classifierInRange,
          dimensions: decision.dimensions,
        });

        // Model-aware truncation: Haiku's 200K context can't absorb the same
        // transcript length Sonnet's 1M can. Budgets exported from
        // model-routing.ts — replaces the old 15K-char cap for all models.
        const charBudget =
          decision.model === HAIKU ? HAIKU_CHAR_BUDGET : SONNET_CHAR_BUDGET;
        const prompt = buildSummarizationPrompt(transcript, charBudget);
        let fullSummary = "";
        let fullThinking = "";
        let summarizeSeconds: number | null = null;
        const llmStart = Date.now();

        try {
          for await (const event of streamLlmSummary({
            prompt,
            enableThinking,
            signal: request.signal,
            model: decision.model,
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

        // Oembed was already awaited before the classifier, so this
        // duration no longer includes an oembed round-trip tail. Includes
        // transcription + LLM always; classifier time is included only
        // when the classifier actually ran (middle-zone tokens).
        const processingTimeSeconds = (Date.now() - overallStart) / 1000;

        // Always emit a terminal summary so the client accumulator closes
        // cleanly, even when we skip the cache write below.
        sendEvent({
          type: "summary",
          category: "general",
          total_time: summarizeSecondsFinal + transcribeSeconds,
          summarize_time: summarizeSecondsFinal,
          transcribe_time: transcribeSeconds,
        });

        // Both title and channel drive the cached UI header. Either one
        // blank makes the cached row user-visibly broken, so skip the
        // write — a re-run is better than a headerless cache hit.
        if (metadataSkipCache || request.signal.aborted) return;
        if (!title || !channelName) {
          const payload = {
            errorId: "CACHE_SKIP_EMPTY_HEADER",
            youtubeUrl: youtube_url,
            source: transcriptSource,
            hasTitle: !!title,
            hasChannel: !!channelName,
          };
          // Alertable in prod: a systematic upstream regression producing
          // empty title/channel silently disables caching and re-bills
          // every request. Same incident class as rate-limit / cache-creds
          // fail-open — error severity in prod, warn in dev.
          if (process.env.NODE_ENV === "production") {
            console.error("[summarize/stream] CACHE_SKIP_EMPTY_HEADER", payload);
          } else {
            console.warn("[summarize/stream] CACHE_SKIP_EMPTY_HEADER", payload);
          }
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
          model: decision.model,
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
        // Order matters: flip `closed` BEFORE close(). Any in-flight
        // sendEvent() must observe the flag on its next entry and short-
        // circuit instead of racing the close() call.
        closed = true;
        try {
          controller.close();
        } catch (err) {
          // TypeError "already closed" is expected when the runtime closed
          // the controller first (abort, consumer cancel). Anything else
          // is a genuine stream bug and must surface.
          const isAlreadyClosed =
            err instanceof TypeError &&
            /closed|invalid state/i.test(err.message);
          if (!isAlreadyClosed) {
            console.error("[summarize/stream] close failed", { err });
          }
        }
      }
    },
    // `cancel()` fires when the consumer tears down the reader before we
    // finished (e.g. the browser tab closed, or Next.js wound down the
    // response). Set `closed` so future sendEvent() calls become no-ops
    // instead of writing to a dead controller. Does NOT abort upstream
    // work (captions/VPS/LLM/cache-write); those stop only when
    // request.signal aborts, which Vercel/Next.js typically fire on
    // client disconnect.
    cancel() {
      closed = true;
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
