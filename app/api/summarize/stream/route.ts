import { after } from "next/server";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import {
  getCachedSummary,
  writeCachedSummary,
} from "@/lib/services/summarize-cache";
import {
  acquireTranscript,
  type TranscriptAcquisitionOutcome,
  type TranscriptAcquisitionProgress,
  type TranscriptAcquisitionSuccess,
} from "@/lib/services/transcript-acquisition";
import { buildSummarizationPrompt } from "@/lib/prompts/summarization";
import { streamLlmSummary } from "@/lib/services/llm-client";
import {
  CLASSIFIER_EXCERPT_CHARS,
  getSparkCharBudget,
  LONG_TOKENS,
  SHORT_TOKENS,
  chooseModel,
  classifyContent,
  getTranscriptMetadata,
} from "@/lib/services/model-routing";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { cookies } from "next/headers";
import {
  ANON_COOKIE_NAME,
  ANON_COOKIE_MAX_AGE_SECONDS,
  signAnonId,
  verifyAnonId,
} from "@/lib/services/anon-cookie";
import { checkSummaryEntitlement } from "@/lib/services/entitlements";
import { randomUUID } from "node:crypto";
import {
  SummaryRequestSchema,
  formatSummarySseEvent,
} from "@/lib/api-contracts/summary";
import {
  forwardLlmEvent,
  streamCached,
  type SendEvent,
} from "./stream-events";
import type { LogStage } from "@/lib/stages";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import { logAppEvent, videoIdForLog } from "@/lib/observability";
import { hasTimedTranscriptSegments } from "@/lib/types";

export const maxDuration = 300;

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
  extraHeaders?: Record<string, string>,
  requestId?: string,
  errorId?: string
) {
  const headers = {
    "Content-Type": "application/json",
    ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
    ...(errorId ? { "X-Error-ID": errorId } : {}),
    ...extraHeaders,
  };
  return new Response(JSON.stringify({ message }), {
    status,
    headers,
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

export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", undefined, requestId, "INVALID_JSON");
  }

  const parsed = SummaryRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(
      400,
      "Invalid request body",
      undefined,
      requestId,
      "INVALID_REQUEST"
    );
  }
  const {
    youtube_url,
    include_transcript: includeTranscript,
    output_language: outputLanguageCode,
  } = parsed.data;

  const principalResult = await resolveRequestPrincipal({
    source: "summary_stream",
    requestId,
  });
  if (principalResult.kind === "unavailable") {
    return jsonError(
      503,
      "Auth service temporarily unavailable.",
      undefined,
      requestId,
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }
  if (principalResult.kind === "missing") {
    return jsonError(401, "Unauthorized", undefined, requestId, "AUTH_REQUIRED");
  }

  const { principal } = principalResult;
  const { userId, isAnonymous } = principal;

  const rateLimit = await checkRateLimit(userId, isAnonymous);
  // Bind the user + URL to the bypass in one log line so dashboards can
  // alert without joining against rate-limit.ts's infra-cause log. Do NOT
  // surface this distinction in the HTTP response — exposing fail_open to
  // clients tells abusers exactly when our abuse wall is down.
  if (rateLimit.reason === "fail_open") {
    logAppEvent("error", "[summarize/stream] rate-limit bypassed (fail-open)", {
      stage: "unknown" satisfies LogStage,
      errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
      userId,
      videoId: videoIdForLog(youtube_url),
      requestId,
    });
  }
  if (!rateLimit.allowed) {
    return jsonError(429, "Rate limit exceeded. Please try again later.", {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
    }, requestId, "RATE_LIMITED");
  }
  const remaining = rateLimit.remaining;

  // Resolve anon-id cookie for anonymous users. Set-Cookie is applied later
  // via the response headers if we minted a new id.
  let anonId: string | null = null;
  let setAnonCookie: string | null = null;
  if (isAnonymous) {
    const jar = await cookies();
    const existing = jar.get(ANON_COOKIE_NAME)?.value ?? null;
    const verified = existing ? verifyAnonId(existing) : null;
    if (verified) {
      anonId = verified;
    } else {
      const fresh = randomUUID();
      const signed = signAnonId(fresh);
      if (signed) {
        anonId = fresh;
        setAnonCookie = signed;
      }
    }
  }

  let entitlement: Awaited<ReturnType<typeof checkSummaryEntitlement>>;
  if (isAnonymous) {
    if (anonId) {
      entitlement = await checkSummaryEntitlement({ anonId, isAnon: true });
    } else {
      // ANON_COOKIE_SECRET missing/too short — anon-cookie service already
      // logged ANON_COOKIE_SECRET_MISSING. Fail-open as anon (allow this
      // request, log the bypass) instead of debiting the signed-in monthly
      // counter, which would silently grant 10/month to anon users.
      logAppEvent("error", "[summarize/stream] anon entitlement bypassed - secret missing", {
        stage: "unknown" satisfies LogStage,
        errorId: "ENTITLEMENT_ANON_FAIL_OPEN_NO_SECRET",
        userId,
        videoId: videoIdForLog(youtube_url),
        requestId,
      });
      entitlement = {
        tier: "anon",
        allowed: true,
        remaining: 1,
        reason: "fail_open",
      };
    }
  } else {
    entitlement = await checkSummaryEntitlement({ userId, isAnon: false });
  }

  if (entitlement.reason === "fail_open") {
    logAppEvent("error", "[summarize/stream] entitlement bypassed (fail-open)", {
      stage: "unknown" satisfies LogStage,
      errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST",
      userId,
      isAnonymous,
      videoId: videoIdForLog(youtube_url),
      requestId,
    });
  }
  if (!entitlement.allowed) {
    const errorCode = entitlement.tier === "anon"
      ? "anon_quota_exceeded"
      : "free_quota_exceeded";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [REQUEST_ID_HEADER]: requestId,
      "X-Error-ID": "QUOTA_EXCEEDED",
    };
    if (setAnonCookie) {
      headers["Set-Cookie"] = `${ANON_COOKIE_NAME}=${setAnonCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}`;
    }
    return new Response(
      JSON.stringify({
        message:
          entitlement.tier === "anon"
            ? "Sign up to keep using the app — get 10 free summaries each month."
            : "You've used your 10 free summaries this month. Upgrade for unlimited.",
        errorCode,
        tier: entitlement.tier,
        upgradeUrl: "/pricing",
      }),
      { status: 402, headers }
    );
  }

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
        // Validate before entering the enqueue catch. A contract violation
        // must reach the route's protocol-error path instead of being
        // mistaken for an ordinary closed-controller race.
        const encoded = encoder.encode(formatSummarySseEvent(data));
        try {
          controller.enqueue(encoded);
        } catch (err) {
          // If we still reach here, the controller died outside our control
          // — log unconditionally so the bug is visible.
          logAppEvent("error", "[summarize/stream] enqueue failed", {
            errorName: err instanceof Error ? err.name : typeof err,
            aborted: request.signal.aborted,
            requestId,
          });
        }
      };

      const logStageError = (stage: LogStage, err: unknown) => {
        logAppEvent("error", `[summarize/stream] ${stage} failed`, {
          stage,
          videoId: videoIdForLog(youtube_url),
          userId,
          requestId,
          ...(err instanceof Error && { errorName: err.name }),
        });
      };

      try {
        const cached = await getCachedSummary(
          youtube_url,
          outputLanguageCode ?? null
        );
        const overallStart = Date.now();

        // A cached Summary does not need Transcript Acquisition when the
        // caller did not request the canonical Transcript payload. Keep the
        // existing Summary-cache fast path and its stored timing snapshot.
        if (cached && !includeTranscript) {
          streamCached(sendEvent, cached, { includeTranscript: false });
          return;
        }

        const sendAcquisitionProgress = (
          progress: TranscriptAcquisitionProgress
        ): void => {
          switch (progress.type) {
            case "stored_reuse":
              sendEvent({
                type: "status",
                message: "Using cached transcript, summarizing...",
                stage: "summarize",
              });
              return;
            case "caption_acquisition":
              sendEvent({
                type: "status",
                message: "Extracting captions...",
                stage: "transcribe",
              });
              return;
            case "audio_transcription":
              sendEvent({
                type: "status",
                message: "No captions found. Transcribing audio...",
                stage: "transcribe",
              });
              return;
            case "language_detection":
              sendEvent({
                type: "status",
                message: `Detected language: ${progress.detectedLanguage}`,
                stage: "summarize",
              });
              return;
            default: {
              const _exhaustive: never = progress;
              return _exhaustive;
            }
          }
        };

        // A Summary cache hit can still need Transcript Acquisition when the
        // caller requested the canonical timed Transcript. The acquisition
        // seam decides whether the stored Transcript is valid, heals its
        // metadata, or acquires a replacement before this cached Summary is
        // streamed. Keeping one invocation here makes that boundary the only
        // production source-selection entry point for the route.
        const bufferedProgress: TranscriptAcquisitionProgress[] | null = cached
          ? []
          : null;

        if (!cached) {
          sendEvent({ type: "metadata", category: "general", cached: false });
        }

        const acquisitionResult: TranscriptAcquisitionOutcome =
          await acquireTranscript({
            youtubeUrl: youtube_url,
            signal: request.signal,
            requestId,
            onProgress: (progress) => {
              if (bufferedProgress) bufferedProgress.push(progress);
              else sendAcquisitionProgress(progress);
            },
          });

        if (
          cached &&
          acquisitionResult.outcome === "success" &&
          acquisitionResult.reusedStoredTranscript
        ) {
          streamCached(sendEvent, cached, {
            includeTranscript,
            segments: acquisitionResult.segments,
            source: acquisitionResult.transcriptSource,
            title: acquisitionResult.title,
            channelName: acquisitionResult.channelName,
            transcribeTimeSeconds:
              acquisitionResult.acquisitionDurationSeconds,
          });
          return;
        }

        if (cached) {
          // The Summary itself came from the validated cache row even when
          // Transcript Acquisition has to run again to restore timed
          // segments. Origin must describe the Summary source, not whether
          // this request spent time repairing its optional Transcript.
          sendEvent({
            type: "metadata",
            category: "general",
            cached: true,
            title: cached.title,
            channel: cached.channelName,
          });
          bufferedProgress?.forEach(sendAcquisitionProgress);
        }

        if (acquisitionResult.outcome === "caller_aborted") return;
        if (acquisitionResult.outcome === "acquisition_failed") {
          sendEvent({
            type: "error",
            message: USER_ERROR_PROCESS_FAILED,
            errorId: acquisitionResult.failure.errorId,
          });
          return;
        }

        const acquired: TranscriptAcquisitionSuccess = acquisitionResult;
        const segments = acquired.segments;
        const transcriptSource = acquired.transcriptSource;
        const language = acquired.promptLocale;
        const title = acquired.title ?? "";
        const channelName = acquired.channelName ?? "";
        const transcribeSeconds = acquired.acquisitionDurationSeconds;

        // A metadata endpoint outage is intentionally non-fatal. Acquisition
        // still returns the prompt locale inferred from the canonical
        // Transcript, so the existing product status remains truthful.
        if (!acquired.reusedStoredTranscript && !acquired.detectedLanguage) {
          sendEvent({
            type: "status",
            message: `Detected language: ${language}`,
            stage: "summarize",
          });
        }

        if (includeTranscript && hasTimedTranscriptSegments(segments)) {
          sendEvent({
            type: "full_transcript",
            segments,
            source: transcriptSource,
          });
        }

        // Partial-pipeline shortcut: if the per-language Summary cache hit
        // earlier but Transcript Acquisition had to repair or acquire the
        // canonical Transcript, stream the cached Summary without re-billing
        // the LLM.
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

        logAppEvent("info", "[summarize/stream] routing_decision", {
          event: "routing_decision",
          videoId: videoIdForLog(youtube_url),
          userId,
          requestId,
          model: decision.model,
          reason: decision.reason,
          tokens: metadata.tokens,
          wordCount: metadata.wordCount,
          classifierRan: classifierInRange,
          dimensions: decision.dimensions,
        });

        // Spark has a 128K context window. Keep enough headroom for the
        // summary instructions and generated answer after the transcript.
        const charBudget = getSparkCharBudget(language);
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

        // Transcript Acquisition has already awaited any required metadata
        // recovery before the classifier, so this duration no longer
        // includes a metadata round-trip tail. Includes transcription + LLM
        // always; classifier time is included only when the classifier
        // actually ran (middle-zone tokens).
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
        if (request.signal.aborted) return;
        if (!title || !channelName) {
          const payload = {
            errorId: "CACHE_SKIP_EMPTY_HEADER",
            videoId: videoIdForLog(youtube_url),
            requestId,
            source: transcriptSource,
            hasTitle: !!title,
            hasChannel: !!channelName,
          };
          // Alertable in prod: a systematic upstream regression producing
          // empty title/channel silently disables caching and re-bills
          // every request. Same incident class as rate-limit / cache-creds
          // fail-open — error severity in prod, warn in dev.
          if (process.env.NODE_ENV === "production") {
            logAppEvent("error", "[summarize/stream] CACHE_SKIP_EMPTY_HEADER", payload);
          } else {
            logAppEvent("warn", "[summarize/stream] CACHE_SKIP_EMPTY_HEADER", payload);
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
        // supported primitive for this exact post-response work. Transcript
        // persistence is owned by acquisition and completes before this
        // route receives its success outcome, so it does not belong here.
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
                userId,
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
              logAppEvent("error", "[summarize/stream] CACHE_WRITE_FAILED", {
                errorId: "CACHE_WRITE_FAILED",
                stage: "cache" satisfies LogStage,
                pgCode,
                videoId: videoIdForLog(youtube_url),
                requestId,
                userId,
                outputLanguage: outputLanguageCode ?? null,
                errorName: err instanceof Error ? err.name : typeof err,
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
          logAppEvent("error", "[summarize/stream] CACHE_WRITE_SCHEDULE_FAILED", {
            errorId: "CACHE_WRITE_SCHEDULE_FAILED",
            stage: "cache" satisfies LogStage,
            videoId: videoIdForLog(youtube_url),
            requestId,
            userId,
            outputLanguage: outputLanguageCode ?? null,
            errorName: err instanceof Error ? err.name : typeof err,
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
            logAppEvent("error", "[summarize/stream] close failed", {
              errorName: err instanceof Error ? err.name : typeof err,
              requestId,
            });
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

  const streamHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-RateLimit-Remaining": String(remaining),
    [REQUEST_ID_HEADER]: requestId,
  };
  if (setAnonCookie) {
    streamHeaders["Set-Cookie"] = `${ANON_COOKIE_NAME}=${setAnonCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}`;
  }
  return new Response(stream, { headers: streamHeaders });
}
