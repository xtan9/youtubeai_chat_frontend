import { z } from "zod";
import { after } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { extractCaptions } from "@/lib/services/caption-extractor";
import { transcribeViaVps, VpsTranscribeError } from "@/lib/services/vps-client";
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
  getCachedTranscript,
  writeCachedSummary,
  writeCachedTranscript,
  type TranscriptSegment,
  type TranscriptSource,
  type PromptLocale,
} from "@/lib/services/summarize-cache";
import { detectLocale } from "@/lib/services/language-detect";
import { buildSummarizationPrompt } from "@/lib/prompts/summarization";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
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
  include_transcript: z.boolean().optional().default(false),
  // Optional summary-output-language override. Omitted means "video's own
  // language" (current default behavior — matches the video-native cache
  // row). An invalid code fails request validation with 400.
  output_language: z.enum(SUPPORTED_LANGUAGE_CODES).optional(),
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
    include_transcript: includeTranscript,
    output_language: outputLanguageCode,
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
        // Pull `.status` off typed VPS errors so log-search alerts can
        // fingerprint failure classes (503-from-VPS = Groq quota /
        // GROQ_FAILED_NO_FALLBACK gate, 500 = WHISPER_EMPTY_RESULT, the
        // string-tagged variants = pre-HTTP fetch failures the frontend
        // saw) without regex-substring-matching on err.message. The
        // `errorId` is a stable token so dashboards can group by it.
        const isVpsTyped = err instanceof VpsTranscribeError;
        const status = isVpsTyped ? err.status : undefined;
        const errorId = isVpsTyped
          ? `VPS_TRANSCRIBE_FAILED_${err.status}`
          : undefined;
        console.error(`[summarize/stream] ${stage} failed`, {
          stage,
          youtubeUrl: youtube_url,
          userId: authedUser.id,
          err,
          ...(status !== undefined && { status }),
          ...(errorId !== undefined && { errorId }),
          ...(isVpsTyped &&
            err.bodyExcerpt && { bodyExcerpt: err.bodyExcerpt.slice(0, 200) }),
        });
      };

      try {
        const cached = await getCachedSummary(
          youtube_url,
          outputLanguageCode ?? null
        );
        if (cached) {
          // The cached summary row stores only the flat string the LLM
          // consumed; segments (with per-line timing) live on the separate
          // video_transcripts row. Fetch them only when the client asked
          // for the transcript so we don't pay an extra DB round-trip on
          // include_transcript=false requests (the common path for the
          // production summary flow).
          let cachedSegments: readonly TranscriptSegment[] | undefined;
          if (includeTranscript) {
            const cachedT = await getCachedTranscript(youtube_url);
            cachedSegments = cachedT?.segments;
          }
          // Honor the cache only when the client doesn't need a
          // transcript, or we have one with real per-line timing.
          // Synthesizing a single `[{start:0, duration:0}]` from
          // `cached.transcript` would re-create the exact placeholder
          // the read-side eviction in summarize-cache.getCachedTranscript
          // is tearing down — the user keeps seeing one un-clickable
          // 00:00 paragraph forever. Falling through re-runs the VPS
          // pipeline; one re-bill per affected video, after which both
          // caches hold real segments + summary and subsequent visits
          // are fast.
          if (!includeTranscript || cachedSegments !== undefined) {
            streamCached(sendEvent, cached, {
              includeTranscript,
              segments: cachedSegments,
            });
            return;
          }
        }

        const overallStart = Date.now();
        sendEvent({ type: "metadata", category: "general", cached: false });
        sendEvent({
          type: "status",
          message: "Extracting captions...",
          stage: "transcribe",
        });

        // Definite-assignment assertions: the transcript-acquisition step
        // (either the shortcut path or the captions/Whisper pipeline)
        // assigns all three on every path the code can reach — but TS's
        // flow analyzer can't correlate the `reusedNativeTranscript` flag
        // with the nested if/else in the pipeline. Both paths assign;
        // reaching the use-site with these unset is unreachable at runtime.
        //
        // `segments` is the canonical shape; the flat `transcript` string
        // is derived once below for the LLM/classifier/cache snapshot path.
        // Storing both representations would let them drift; deriving means
        // "what we summarized" is provably the concatenation of "what we
        // showed."
        let segments!: readonly TranscriptSegment[];
        let transcriptSource!: TranscriptSource;
        let language!: PromptLocale;
        let title = "";
        let channelName = "";
        // Populated by the VPS /metadata call inside the transcription
        // pipeline; stays null on the translation-shortcut path (we have
        // language from the cached native row, no /metadata round-trip).
        let detectedLang: string | null = null;
        let availableCaptions: readonly string[] = [];
        // Whisper-only. The .catch at construction guards against unhandled
        // rejection if the LLM path errors before we await the promise.
        let metadataPromise: Promise<VideoMetadataResult> | null = null;

        const transcribeStart = Date.now();

        // Transcript cache shortcut: any request (any language) for a
        // video we've already transcribed reuses that transcript and skips
        // the entire transcription pipeline (VPS metadata + captions +
        // Whisper). Independent of whether the per-language summary cache
        // row exists — the transcript is its own first-class artifact, so
        // a mid-LLM abort or a language switch right after summary completion
        // both find the cached transcript here.
        let reusedCachedTranscript = false;
        const cachedTranscript = await getCachedTranscript(youtube_url);
        if (isCallerAbort(request.signal)) return;
        if (cachedTranscript) {
          segments = cachedTranscript.segments;
          transcriptSource = cachedTranscript.transcriptSource;
          language = cachedTranscript.language;
          title = cachedTranscript.title;
          channelName = cachedTranscript.channelName;
          reusedCachedTranscript = true;
          sendEvent({
            type: "status",
            message: "Using cached transcript, summarizing...",
            stage: "summarize",
          });
          // Recovery: a previous Whisper-path request may have written
          // the videos row with NULL title/channel (transcript cache is
          // written before oembed resolves) and then aborted before
          // writeCachedSummary backfilled the metadata. Without this
          // guard, every subsequent shortcut request would skip oembed,
          // hit the empty-header guard at end-of-pipeline, and never
          // write the per-language summary row — re-billing the LLM
          // forever for a video that's already transcribed. Fetching
          // oembed here is the only place that re-establishes the
          // header so the cache write at the bottom can complete.
          if (!title || !channelName) {
            metadataPromise = Promise.resolve()
              .then(() => fetchVideoMetadata(youtube_url, request.signal))
              .catch(
                (err): VideoMetadataResult =>
                  request.signal.aborted
                    ? { ok: false, reason: "aborted" }
                    : { ok: false, reason: "error", error: err }
              );
          }
        }

        if (!reusedCachedTranscript) {
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
          segments = captions.segments;
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
            segments = vpsResult.segments;
            transcriptSource = "whisper";
            // PromptLocale stays binary (en|zh). If we pinned zh, trust
            // that; for every other detected language we still run
            // detectLocale on the transcript to catch CJK output from
            // mis-detection (or legacy "no hint" calls). Slice the first
            // ~500 chars of the joined text rather than streaming all
            // segments through detectLocale — the heuristic only needs a
            // sample.
            language =
              detectedLang === "zh"
                ? "zh"
                : detectLocale(
                    segments
                      .map((s) => s.text)
                      .join(" ")
                      .slice(0, 500)
                  );
          } catch (err) {
            if (isCallerAbort(request.signal)) return;
            // logStageError extracts `.status` and stamps a stable
            // `errorId: VPS_TRANSCRIBE_FAILED_<status>` when err is a
            // VpsTranscribeError, so log-search alerts can fingerprint
            // 503 (Groq quota / GROQ_FAILED_NO_FALLBACK gate) vs. 500
            // (WHISPER_EMPTY_RESULT) vs. timeout/network without
            // regex-matching err.message. User-visible behavior is
            // unchanged — still emits the generic
            // USER_ERROR_PROCESS_FAILED SSE event.
            logStageError("vps", err);
            sendEvent({
              type: "error",
              message: USER_ERROR_PROCESS_FAILED,
            });
            return;
          }
        }

        // Whisper path only: resolve oembed BEFORE writing the transcript
        // cache. The captions path already has title/channel; the Whisper
        // path doesn't (oembed was kicked off in parallel and not yet
        // awaited). Resolving here means the videos row written by
        // writeCachedTranscript carries real title/channel — eliminating
        // the race where a late transcript-cache write could clobber
        // values that writeCachedSummary already populated, and the
        // permanent-cache-disable bug if this request aborts before
        // end-of-pipeline. Re-awaiting the same promise at line ~533
        // is a no-op (resolved promises return their cached value).
        if (metadataPromise) {
          const result = await metadataPromise;
          if (result.ok) {
            title = result.data.title;
            channelName = result.data.channelName;
          }
          // Don't set metadataSkipCache here — the lower await still runs
          // and handles the failure-classification + log. We just want
          // title/channel for the transcript-cache write; if oembed
          // failed, we proceed with empty strings (writeCachedTranscript
          // skips the column rather than nulling out an existing value).
        }

        // Persist transcript NOW, before the LLM call. If this request
        // aborts mid-LLM (caller disconnect, language switch, gateway
        // error), the next request still finds the transcript and skips
        // re-transcription. Both the captions and Whisper paths now have
        // title/channel resolved by this point; writeCachedTranscript
        // sparsely upserts so empty/undefined values won't overwrite an
        // existing populated videos row.
        // Fire-and-forget: a transcript-cache write failure must not
        // delay the user-visible summary stream — but the failure is
        // alertable since it disables the cache for that video.
        writeCachedTranscript({
          youtubeUrl: youtube_url,
          segments,
          transcriptSource,
          language,
          title: title || undefined,
          channelName: channelName || undefined,
        }).catch((err) =>
          console.error("[summarize/stream] transcript cache write failed", {
            errorId: "TRANSCRIPT_WRITE_FAILED",
            youtubeUrl: youtube_url,
            err,
          })
        );
        } // end !reusedCachedTranscript
        // Only measure real transcription time. On the shortcut path we
        // didn't do transcription — attributing the cache-lookup duration
        // here poisons `transcribe_time_seconds` on the translation cache
        // row (and shows the user "Transcription: 0.02s" which is a lie).
        const transcribeSeconds = reusedCachedTranscript
          ? 0
          : (Date.now() - transcribeStart) / 1000;

        // Surface the BCP-47 detectedLang when we have it — PromptLocale is
        // binary (en|zh) and tells the user "en" for every non-CJK video,
        // which reads as "we think your French video is English." Skipped
        // entirely on the shortcut path because `detectedLang` is never set
        // there (we'd just print the PromptLocale fallback and regress the
        // very UX this event exists to fix). The user already saw the
        // detection on their first render.
        if (!reusedCachedTranscript) {
          sendEvent({
            type: "status",
            message: `Detected language: ${detectedLang ?? language}`,
            stage: "summarize",
          });
        }

        if (includeTranscript) {
          sendEvent({ type: "full_transcript", segments });
        }

        // Partial-pipeline shortcut: if the per-language summary cache hit
        // earlier but we re-transcribed because segments were missing
        // (read-side eviction in summarize-cache or never persisted),
        // stream the cached summary verbatim instead of re-billing the
        // LLM. The transcript cache write already happened above on the
        // !reusedCachedTranscript branch, so the next request hits both
        // shortcuts. Skipping the LLM also avoids clobbering the existing
        // summary row with a non-deterministic re-run.
        if (cached) {
          sendEvent({ type: "content", text: cached.summary });
          sendEvent({
            type: "summary",
            category: "general",
            total_time: cached.summarizeTimeSeconds + transcribeSeconds,
            summarize_time: cached.summarizeTimeSeconds,
            transcribe_time: transcribeSeconds,
          });
          return;
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

        // Derive the flat transcript string ONCE here for everything
        // downstream that needs string text (classifier excerpt, prompt,
        // summary cache snapshot). Storing this on a long-lived field
        // would let it drift from `segments` — keeping it local enforces
        // "what we summarized" === "concatenation of what we showed."
        const transcriptText = segments.map((s) => s.text).join(" ");

        // Routing: compute metadata, run classifier in the middle zone,
        // pick a model via chooseModel, log the decision.
        const metadata = getTranscriptMetadata(transcriptText, language);
        const classifierInRange =
          metadata.tokens >= SHORT_TOKENS && metadata.tokens <= LONG_TOKENS;
        const classifier = classifierInRange
          ? await classifyContent({
              transcriptExcerpt: transcriptText.slice(
                0,
                CLASSIFIER_EXCERPT_CHARS
              ),
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
        const prompt = buildSummarizationPrompt(
          transcriptText,
          charBudget,
          outputLanguageCode
        );
        let fullSummary = "";
        let summarizeSeconds: number | null = null;
        const llmStart = Date.now();

        try {
          for await (const event of streamLlmSummary({
            prompt,
            signal: request.signal,
            model: decision.model,
          })) {
            forwardLlmEvent(event, sendEvent);
            if (event.type === "content") fullSummary += event.text;
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

        // Defer to next/server's after() so Vercel keeps the function alive
        // until the cache write resolves. The previous fire-and-forget
        // `.catch` raced the controller.close() in the finally block —
        // Lambda freezes the container shortly after the response stream
        // ends, killing the in-flight HTTP fetch to PostgREST and surfacing
        // as `TypeError: fetch failed` on the videos upsert (observed 3×
        // for as3SgPXRRC4 on 2026-04-27, plus a longer tail across other
        // videos that healed only on a later retry). after() is the
        // supported primitive for this exact post-response work;
        // writeCachedTranscript above doesn't need it because it fires
        // before the LLM streams and settles during that window.
        //
        // The await INSIDE the try is load-bearing: after() reports a
        // rejected callback Promise to the platform's error logger
        // without our structured fields (errorId, pgCode, outputLanguage,
        // youtubeUrl, userId), which breaks the dashboard slicing the
        // catch payload feeds. Keep the await wrapped — don't hoist.
        //
        // The outer try/catch around the after() registration itself
        // guards a synchronous throw from Next.js (e.g., "after was
        // called outside a request scope" if the runtime ever loses the
        // AsyncLocalStorage chain through the ReadableStream construction).
        // Without it, the throw escapes to the outer handler at the
        // bottom of start(), which would emit a generic error event AFTER
        // the user already received their terminal `summary` event.
        try {
          after(async () => {
            try {
              await writeCachedSummary({
                youtubeUrl: youtube_url,
                title,
                channelName,
                language,
                // Snapshot the flat string the LLM consumed. The cache row is a
                // record of "what we summarized" — segments live separately on
                // video_transcripts and stay the canonical source for the UI.
                transcript: transcriptText,
                summary: fullSummary,
                transcriptSource,
                model: decision.model,
                processingTimeSeconds,
                transcribeTimeSeconds: transcribeSeconds,
                summarizeTimeSeconds: summarizeSecondsFinal,
                userId: authedUser.id,
                outputLanguage: outputLanguageCode ?? null,
              });
            } catch (err) {
              // Cache write is best-effort — never propagate to the user.
              // But each failure class warrants a different signal:
              // 23505 is schema drift (incident — see PR #25), PGRST204 is
              // stale PostgREST schema cache (transient), auth-class errors
              // are creds rotation. Carry the SQLSTATE + outputLanguage so a
              // dashboard can split the spike by class without joining log
              // lines after the fact (every 23505 line had outputLanguage
              // non-null on the day this incident shipped — that field
              // alone would have flagged it).
              const pgCode =
                err && typeof err === "object" && "code" in err
                  ? (err as { code: unknown }).code
                  : undefined;
              console.error("[summarize/stream] CACHE_WRITE_FAILED", {
                errorId: "CACHE_WRITE_FAILED",
                stage: "cache" satisfies LogStage,
                pgCode,
                youtubeUrl: youtube_url,
                userId: authedUser.id,
                outputLanguage: outputLanguageCode ?? null,
                err,
              });
            }
          });
        } catch (err) {
          // after() registration itself failed (sync throw from Next.js).
          // Distinct errorId so dashboards can separate "scheduling
          // failed" (runtime contract regression) from "cache write
          // failed" (Supabase / network). Don't re-throw — the user
          // already has their summary; emitting a generic error event
          // here would land AFTER the terminal `summary` event and look
          // to the client like a failed run despite a complete answer.
          console.error("[summarize/stream] CACHE_WRITE_SCHEDULE_FAILED", {
            errorId: "CACHE_WRITE_SCHEDULE_FAILED",
            stage: "cache" satisfies LogStage,
            youtubeUrl: youtube_url,
            userId: authedUser.id,
            outputLanguage: outputLanguageCode ?? null,
            err,
          });
        }
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
