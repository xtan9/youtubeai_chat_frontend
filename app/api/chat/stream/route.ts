import { after } from "next/server";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { checkRateLimit } from "@/lib/services/rate-limit";
import {
  checkChatEntitlement,
  resolveRegisteredSubscription,
} from "@/lib/services/entitlements";
import {
  appendChatTurn,
  appendChatUserMessage,
  listChatMessages,
  type ChatMessageRow,
} from "@/lib/services/chat-store";
import { buildChatMessages, MAX_HISTORY_MESSAGES } from "@/lib/prompts/chat";
import { streamChatCompletion } from "@/lib/services/llm-chat-client";
import { formatSseEvent } from "@/lib/services/llm-client";
import {
  ChatStreamRequestSchema,
  type ChatSseEvent,
} from "@/lib/api-contracts/chat";
import { formatTimestamp } from "@/lib/utils/timestamp-citations";
import {
  resolveVideoChatSubject,
  type VideoChatSubject,
  type VideoGroundingResolution,
  type VideoChatSubjectResolution,
} from "@/lib/services/video-chat-subject";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import { logAppEvent, videoIdForLog } from "@/lib/observability";
import {
  markAnonymousTrialChatMessageStarted,
  refundAnonymousTrialChatMessage,
  reserveAnonymousTrialChatMessage,
  type AnonymousTrialReservationResult,
} from "@/lib/services/anonymous-trial";
import {
  admitRegisteredFreeHeroDemoChatMessage,
  type RegisteredFreeHeroDemoAdmissionResult,
} from "@/lib/services/registered-free-hero-demo";

// Chat turns are typically much shorter than the summarize pipeline
// (no transcription, no segmenting), so 120s is enough headroom for
// the longest reasonable answer. The summarize route uses 300s because
// it owns the whole transcribe→LLM pipeline; chat owns only the LLM
// step.
export const maxDuration = 120;

// Spark has a 128K context window. 400K transcript characters are roughly
// 100K English tokens, leaving room for the system prompt, summary, history,
// and the current turn.
const TRANSCRIPT_HARD_CAP_CHARS = 400_000;
const CJK_TRANSCRIPT_HARD_CAP_CHARS = 64_000;
const CJK_CHAR_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g;

function transcriptHardCapChars(transcript: string): number {
  const cjkChars = transcript.match(CJK_CHAR_REGEX)?.length ?? 0;
  const cjkRatio = cjkChars / Math.max(transcript.length, 1);
  return cjkRatio >= 0.2
    ? CJK_TRANSCRIPT_HARD_CAP_CHARS
    : TRANSCRIPT_HARD_CAP_CHARS;
}

const USER_ERROR_GENERIC =
  "Something went wrong answering your question. Please try again.";
const USER_ERROR_NO_SUMMARY =
  "Generate the summary first, then ask follow-up questions.";
const USER_ERROR_TRANSCRIPT_TOO_LONG =
  "This video's transcript is too long for chat. Please try a shorter video.";
const USER_ERROR_SERVICE_UNAVAILABLE =
  "Chat service temporarily unavailable. Please try again later.";

const CHAT_STREAM_SUBJECT_NOT_READY = "CHAT_STREAM_SUBJECT_NOT_READY";
const CHAT_STREAM_SUBJECT_UNAVAILABLE = "CHAT_STREAM_SUBJECT_UNAVAILABLE";
const CHAT_STREAM_GROUNDING_NOT_READY = "CHAT_STREAM_GROUNDING_NOT_READY";
const CHAT_STREAM_GROUNDING_UNAVAILABLE = "CHAT_STREAM_GROUNDING_UNAVAILABLE";

function jsonError(status: number, message: string, requestId: string, errorId: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      [REQUEST_ID_HEADER]: requestId,
      "X-Error-ID": errorId,
    },
  });
}

function logSubjectNotReady(videoId: string): void {
  logAppEvent("info", "[chat/stream] subject not ready", {
    errorId: CHAT_STREAM_SUBJECT_NOT_READY,
    videoId,
    reason: "not_ready",
  });
}

function subjectUnavailableResponse(
  requestId: string,
  videoId: string,
  errorName?: string,
): Response {
  logAppEvent("error", "[chat/stream] subject unavailable", {
    errorId: CHAT_STREAM_SUBJECT_UNAVAILABLE,
    videoId,
    errorName: errorName ?? null,
    errorClass: "SubjectResolution",
  });
  return jsonError(
    503,
    USER_ERROR_SERVICE_UNAVAILABLE,
    requestId,
    CHAT_STREAM_SUBJECT_UNAVAILABLE,
  );
}

function logGroundingNotReady(videoId: string): void {
  logAppEvent("info", "[chat/stream] Grounding not ready", {
    errorId: CHAT_STREAM_GROUNDING_NOT_READY,
    videoId,
    reason: "not_ready",
  });
}

function groundingUnavailableResponse(requestId: string): Response {
  return jsonError(
    503,
    USER_ERROR_SERVICE_UNAVAILABLE,
    requestId,
    CHAT_STREAM_GROUNDING_UNAVAILABLE,
  );
}

async function loadSubjectGrounding(
  subject: VideoChatSubject,
): Promise<VideoGroundingResolution> {
  if (!subject.grounding) {
    logGroundingNotReady(subject.identity.youtubeVideoId);
    return { status: "not_ready" };
  }

  try {
    const outcome = await subject.grounding.load();
    if (outcome.status === "ready") return outcome;
    if (outcome.status === "not_ready") {
      logGroundingNotReady(subject.identity.youtubeVideoId);
      return outcome;
    }
    logAppEvent("error", "[chat/stream] Grounding unavailable", {
      errorId: CHAT_STREAM_GROUNDING_UNAVAILABLE,
      videoId: subject.identity.youtubeVideoId,
      errorName: null,
      errorClass: "GroundingResolution",
    });
    return outcome;
  } catch (error) {
    logAppEvent("error", "[chat/stream] Grounding unavailable", {
      errorId: CHAT_STREAM_GROUNDING_UNAVAILABLE,
      videoId: subject.identity.youtubeVideoId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorClass: "GroundingResolution",
    });
    return { status: "unavailable" };
  }
}

export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", requestId, "INVALID_JSON");
  }

  const parsed = ChatStreamRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "Invalid request body", requestId, "INVALID_REQUEST");
  }
  const { youtube_url, message } = parsed.data;

  const principalResult = await resolveRequestPrincipal({
    source: "chat_stream",
    requestId,
  });
  if (principalResult.kind === "unavailable") {
    return jsonError(
      503,
      "Auth service temporarily unavailable.",
      requestId,
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }
  if (principalResult.kind === "missing") {
    return jsonError(401, "Unauthorized", requestId, "AUTH_REQUIRED");
  }

  const { userId, isAnonymous, smokeProEntitled } = principalResult.principal;

  // Never spend upstream tokens for anonymous users. The former hero-demo
  // exception was an unmetered public relay: callers could rotate anonymous
  // sessions and repeatedly invoke the LLM without owning the gateway key.
  const anonymousTrialEnabled =
    isAnonymous && process.env.ANONYMOUS_TRIAL_ENABLED?.trim() === "true";
  if (isAnonymous && !anonymousTrialEnabled) {
    return new Response(
      JSON.stringify({
        message: "Sign up to chat about videos.",
        errorCode: "anon_chat_blocked",
        tier: "anon",
        upgradeUrl: "/auth/sign-up",
      }),
      {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          [REQUEST_ID_HEADER]: requestId,
          "X-Error-ID": "CHAT_ANON_BLOCKED",
        },
      }
    );
  }

  if (anonymousTrialEnabled && message.length > 500) {
    return jsonError(
      400,
      "Anonymous Trial messages must be 500 characters or fewer.",
      requestId,
      "ANONYMOUS_TRIAL_MESSAGE_TOO_LONG",
    );
  }

  // Every authenticated request consumes the same per-user rate limit.
  // Entitlement and retention are selected by the resolved subject because
  // stateless subjects have no database-backed targets.
  //
  // The subject resolver is the only source boundary for Grounding; this
  // route never assembles evidence from cache or static source helpers.
  const rateLimit = await checkRateLimit(userId, isAnonymous);
  if (rateLimit.reason === "fail_open") {
    logAppEvent("error", "[chat/stream] rate-limit bypassed (fail-open)", {
      errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
      userId,
      videoId: videoIdForLog(youtube_url),
      requestId,
    });
  }
  if (!rateLimit.allowed) {
    return jsonError(
      429,
      "Rate limit exceeded. Please try again later.",
      requestId,
      "RATE_LIMITED"
    );
  }

  // Resolve the canonical Video and its coherent Grounding before applying
  // per-Video policies or constructing the prompt.
  let resolution: VideoChatSubjectResolution;
  try {
    resolution = await resolveVideoChatSubject(youtube_url);
  } catch (error) {
    return subjectUnavailableResponse(
      requestId,
      videoIdForLog(youtube_url),
      error instanceof Error ? error.name : typeof error,
    );
  }

  if (resolution.status === "invalid") {
    logAppEvent("warn", "[chat/stream] invalid subject", {
      errorId: "CHAT_STREAM_SUBJECT_INVALID",
      errorClass: "InvalidVideoUrl",
    });
    return jsonError(400, "Invalid request body", requestId, "INVALID_REQUEST");
  }
  if (resolution.status === "not_ready") {
    logSubjectNotReady(resolution.identity.youtubeVideoId);
    return jsonError(404, USER_ERROR_NO_SUMMARY, requestId, "SUMMARY_NOT_FOUND");
  }
  if (resolution.status === "unavailable") {
    return subjectUnavailableResponse(
      requestId,
      resolution.identity.youtubeVideoId,
    );
  }

  const { subject } = resolution;
  if (anonymousTrialEnabled && subject.source !== "hero_demo") {
    return new Response(
      JSON.stringify({
        message: "Sign up to chat about videos.",
        errorCode: "anon_chat_blocked",
        tier: "anon",
        upgradeUrl: "/auth/sign-up",
      }),
      {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          [REQUEST_ID_HEADER]: requestId,
          "X-Error-ID": "CHAT_ANON_SUBJECT_BLOCKED",
        },
      },
    );
  }
  const groundingOutcome = await loadSubjectGrounding(subject);
  if (groundingOutcome.status === "not_ready") {
    return jsonError(
      404,
      USER_ERROR_NO_SUMMARY,
      requestId,
      "SUMMARY_NOT_FOUND",
    );
  }
  if (groundingOutcome.status === "unavailable") {
    return groundingUnavailableResponse(requestId);
  }

  const { grounding } = groundingOutcome;
  const { retainedThread, entitlement: entitlementTarget } = subject;
  const videoId = grounding.transcript.videoId;

  let registeredFreeHeroDemoAdmission: Extract<
    RegisteredFreeHeroDemoAdmissionResult,
    { outcome: "admitted" }
  > | null = null;
  if (!isAnonymous && subject.source === "hero_demo") {
    const subscription = await resolveRegisteredSubscription(
      userId,
      smokeProEntitled,
    );
    if (subscription.kind === "unavailable") {
      return jsonError(
        503,
        "Chat allowance temporarily unavailable.",
        requestId,
        "REGISTERED_FREE_HERO_DEMO_SUBSCRIPTION_UNAVAILABLE",
      );
    }
    if (subscription.tier === "free") {
      const admission = await admitRegisteredFreeHeroDemoChatMessage({
        userId,
        youtubeVideoId: subject.identity.youtubeVideoId,
      });
      if (admission.outcome === "unavailable") {
        return jsonError(
          503,
          "Chat allowance temporarily unavailable.",
          requestId,
          "REGISTERED_FREE_HERO_DEMO_ALLOWANCE_UNAVAILABLE",
        );
      }
      if (admission.outcome === "exhausted") {
        return new Response(
          JSON.stringify({
            message:
              "You've used your 5 free chat messages on this demo. Upgrade for unlimited.",
            errorCode: "free_chat_exceeded",
            tier: "free",
            remainingMessages: admission.remainingMessages,
            upgradeUrl: "/pricing",
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json",
              [REQUEST_ID_HEADER]: requestId,
              "X-Error-ID": "REGISTERED_FREE_HERO_DEMO_EXHAUSTED",
            },
          },
        );
      }
      registeredFreeHeroDemoAdmission = admission;
    }
  }

  if (entitlementTarget) {
    const entitlement = await checkChatEntitlement(
      userId,
      entitlementTarget.videoId,
      smokeProEntitled,
    );
    if (entitlement.reason === "fail_open") {
      logAppEvent("error", "[chat/stream] entitlement bypassed (fail-open)", {
        errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST",
        userId,
        videoId: entitlementTarget.videoId,
        requestId,
      });
    }
    if (!entitlement.allowed) {
      return new Response(
        JSON.stringify({
          message: "You've used your 5 free chat messages on this video. Upgrade for unlimited.",
          errorCode: "free_chat_exceeded",
          tier: entitlement.tier,
          upgradeUrl: "/pricing",
        }),
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            [REQUEST_ID_HEADER]: requestId,
            "X-Error-ID": "CHAT_QUOTA_EXCEEDED",
          },
        }
      );
    }
  }

  // Prefix each segment with its [mm:ss] start time so the model can
  // cite real video timestamps in answers. Without this, the assistant
  // sees a flat run-on transcript and (correctly) refuses to invent
  // `[mm:ss]` positions — caught in production e2e where the model
  // explicitly told the user "the transcript does not include video
  // timestamps." formatTimestamp uses the same shape the citation
  // parser on the frontend recognizes, so the round-trip is closed.
  const transcriptText = grounding.transcript.segments
    .map((s) => `${formatTimestamp(s.start)} ${s.text}`)
    .join("\n");
  if (transcriptText.length > transcriptHardCapChars(transcriptText)) {
    return jsonError(
      413,
      USER_ERROR_TRANSCRIPT_TOO_LONG,
      requestId,
      "TRANSCRIPT_TOO_LONG"
    );
  }

  // Only a retained-thread capability can load or persist history.
  let history: readonly ChatMessageRow[];
  if (!retainedThread) {
    history = [];
  } else {
    try {
      const fullHistory = await listChatMessages(userId, retainedThread.videoId);
      // Cap history at the route boundary so a long-running thread can't
      // blow the LLM's context window and the per-turn token cost stays
      // bounded regardless of how many turns the user has accumulated.
      history =
        fullHistory.length > MAX_HISTORY_MESSAGES
          ? fullHistory.slice(-MAX_HISTORY_MESSAGES)
          : fullHistory;
    } catch (err) {
      logAppEvent("error", "[chat/stream] history load failed", {
        errorId: "CHAT_HISTORY_LOAD_FAILED",
        userId,
        videoId: retainedThread.videoId,
        errorName: err instanceof Error ? err.name : typeof err,
        requestId,
      });
      return jsonError(
        503,
        "Could not load chat history.",
        requestId,
        "CHAT_HISTORY_LOAD_FAILED"
      );
    }
  }

  // Anthropic-specific cache_control blocks are not valid for the OpenAI
  // backend. Keep the legacy prompt-builder option disabled even if an old
  // deployment still carries LLM_PROMPT_CACHE_ENABLED.
  const cacheStablePrefix = false;
  const messages = buildChatMessages({
    transcript: transcriptText,
    summary: grounding.summary.summary,
    history,
    userMessage: message,
    cacheStablePrefix,
  });

  let anonymousReservation: Extract<
    AnonymousTrialReservationResult,
    { outcome: "admitted" }
  > | null = null;
  if (anonymousTrialEnabled) {
    const reservation = await reserveAnonymousTrialChatMessage({ userId });
    if (reservation.outcome === "exhausted") {
      return new Response(
        JSON.stringify({
          message: "You've used all 5 Anonymous Trial messages.",
          errorCode: "anonymous_trial_exhausted",
          tier: "anon",
          remainingMessages: 0,
          upgradeUrl: "/auth/sign-up",
        }),
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            [REQUEST_ID_HEADER]: requestId,
            "X-Error-ID": "ANONYMOUS_TRIAL_EXHAUSTED",
          },
        },
      );
    }
    if (reservation.outcome === "unavailable") {
      return new Response(
        JSON.stringify({
          message: "Anonymous chat is temporarily unavailable. Create an account to continue.",
          errorCode: "anonymous_trial_unavailable",
          upgradeUrl: "/auth/sign-up",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            [REQUEST_ID_HEADER]: requestId,
            "X-Error-ID": "ANONYMOUS_TRIAL_UNAVAILABLE",
          },
        },
      );
    }
    anonymousReservation = reservation;
  }

  // Stream-side state. `closed` flips on natural end or consumer cancel so
  // in-flight enqueues stop, while `assistantBuffer` holds the durable answer.
  // `userMessagePersisted` prevents duplicate user-only writes on abort races.
  let closed = false;
  let assistantBuffer = "";
  // A stateless subject starts with no persistence work to do.
  let userMessagePersisted = !retainedThread;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent = (data: ChatSseEvent) => {
        if (request.signal.aborted || closed) return;
        try {
          controller.enqueue(encoder.encode(formatSseEvent(data)));
        } catch (err) {
          // Stream-emit failures are usually a torn-down consumer reader,
          // but real bugs (encoder failure, controller in invalid state
          // we didn't see coming) need a stable errorId for log search.
          // Tag the eventType so post-incident triage can tell whether
          // a delta was lost (annoying) vs. the terminal `done` was lost
          // (the client falls back to reader-close, but we want to know).
          logAppEvent("error", "[chat/stream] enqueue failed", {
            errorId: "CHAT_ENQUEUE_FAILED",
            errorClass: data.type,
            errorName: err instanceof Error ? err.name : typeof err,
            requestId,
          });
        }
      };

      // Schedule the user-only persist exactly once. Used by both the
      // start()-side abort branch and cancel(); the dedupe flag keeps a
      // post-success cancel() (rare, but observed when a flush races a
      // disconnect) from inserting the question a second time.
      const persistUserOnly = (errorId: string) => {
        if (!retainedThread || userMessagePersisted) return;
        userMessagePersisted = true;
        try {
          after(async () => {
            try {
              await appendChatUserMessage(
                userId,
                retainedThread.videoId,
                message,
              );
            } catch (persistErr) {
              logAppEvent("error", "[chat/stream] user-only persist failed", {
                errorId,
                userId,
                videoId,
                errorName: persistErr instanceof Error ? persistErr.name : typeof persistErr,
                requestId,
              });
            }
          });
        } catch (afterErr) {
          logAppEvent("error", "[chat/stream] user-only persist scheduling failed", {
            errorId: `${errorId}_SCHEDULE`,
            userId,
            videoId,
            errorName: afterErr instanceof Error ? afterErr.name : typeof afterErr,
            requestId,
          });
        }
      };

      try {
        if (registeredFreeHeroDemoAdmission) {
          sendEvent({
            type: "registered_free_hero_demo_admitted",
            remainingMessages:
              registeredFreeHeroDemoAdmission.remainingMessages,
          });
        }
        if (anonymousReservation) {
          const started = await markAnonymousTrialChatMessageStarted({
            userId,
            reservationId: anonymousReservation.reservationId,
          });
          if (started.outcome !== "started" && started.outcome !== "already_started") {
            await refundAnonymousTrialChatMessage({
              userId,
              reservationId: anonymousReservation.reservationId,
            });
            sendEvent({
              type: "error",
              message: "Anonymous chat is temporarily unavailable. Create an account to continue.",
              errorCode: "anonymous_trial_unavailable",
            });
            return;
          }
          sendEvent({
            type: "anonymous_trial_admitted",
            reservationId: anonymousReservation.reservationId,
            remainingMessages: started.remainingMessages,
          });
        }
        try {
          for await (const evt of streamChatCompletion({
            messages,
            signal: request.signal,
            ...(anonymousTrialEnabled ? { maxOutputTokens: 600 } : {}),
          })) {
            if (request.signal.aborted) break;
            if (evt.type === "delta") {
              assistantBuffer += evt.text;
              sendEvent({ type: "delta", text: evt.text });
            }
            // We don't forward the generator's `done` here — the inline
            // persist below sends the terminal `done` event so the
            // client only sees `done` AFTER the turn is durable. Any
            // generator `done` arriving early is intentionally ignored.
          }
          // Post-loop abort: if the iterator finished cleanly because
          // signal.aborted was checked at the top of the body, treat
          // this exactly like a thrown abort — preserve the user
          // message and drop the assistant partial. Without this branch
          // the success path below would persist a partial turn.
          if (request.signal.aborted) {
            persistUserOnly("CHAT_ABORT_PERSIST_FAILED");
            return;
          }
        } catch (err) {
          if (request.signal.aborted) {
            // Caller disconnect mid-stream. Preserve the user's message
            // so it shows up on reload — the assistant's partial output
            // is dropped (no half-turn persisted).
            persistUserOnly("CHAT_ABORT_PERSIST_FAILED");
            return;
          }
          logAppEvent("error", "[chat/stream] llm failed", {
            errorId: "CHAT_LLM_FAILED",
            userId,
            videoId,
            errorName: err instanceof Error ? err.name : typeof err,
            requestId,
          });
          // The thread is the artifact — preserve the user's question
          // even when the LLM call failed so they can retry without
          // retyping. The dedupe inside persistUserOnly keeps cancel()
          // from also scheduling.
          persistUserOnly("CHAT_LLM_FAILED_PERSIST_FAILED");
          sendEvent({ type: "error", message: USER_ERROR_GENERIC });
          return;
        }

        if (assistantBuffer.length === 0) {
          // Gateway closed without any content — surface it so the
          // client doesn't hang in a "streaming" state forever, but
          // still preserve the user's question for retry.
          logAppEvent("error", "[chat/stream] empty assistant response", {
            errorId: "CHAT_EMPTY_RESPONSE",
            userId,
            videoId,
            requestId,
          });
          persistUserOnly("CHAT_EMPTY_RESPONSE_PERSIST_FAILED");
          sendEvent({ type: "error", message: USER_ERROR_GENERIC });
          return;
        }

        // Persist the turn INLINE before sending the terminal `done`.
        // The summary route's cache write uses after() because the
        // cache is best-effort, but the chat thread IS the artifact —
        // a silent persist failure here would let the user see a
        // complete answer that vanishes on reload. Adding ~50–200ms of
        // DB-write latency to the perceived close is the right trade.
        //
        if (!retainedThread) {
          sendEvent({ type: "done" });
          return;
        }
        try {
          await appendChatTurn({
            userId,
            videoId: retainedThread.videoId,
            userMessage: message,
            assistantMessage: assistantBuffer,
          });
          // Only flip the dedupe flag AFTER the insert succeeded. If
          // we'd flipped it before the await and the insert threw,
          // a racing cancel() would short-circuit and we'd silently
          // drop the user's question on reload (round-2 review I-B).
          userMessagePersisted = true;
          sendEvent({ type: "done" });
        } catch (persistErr) {
          logAppEvent("error", "[chat/stream] persist failed", {
            errorId: "CHAT_PERSIST_FAILED",
            userId,
            videoId,
            errorName: persistErr instanceof Error ? persistErr.name : typeof persistErr,
            requestId,
          });
          // Best-effort fallback: the joint insert failed, so try a
          // user-only insert so the question survives reload. Both
          // calls landing on the same Supabase blip is rare; if it
          // also fails the helper logs it. The flag is still false at
          // this point, so persistUserOnly's dedupe doesn't short-
          // circuit, and a future cancel() will also see false and be
          // a no-op (the after() callback is the only thing that
          // would still fire).
          persistUserOnly("CHAT_PERSIST_FALLBACK_FAILED");
          sendEvent({
            type: "error",
            message:
              "Your message was answered, but we couldn't save it. Try again.",
          });
        }
      } finally {
        // Order matters: flip `closed` BEFORE close(). Any in-flight
        // sendEvent() observes the flag on its next call and short-
        // circuits instead of racing the close().
        closed = true;
        try {
          controller.close();
        } catch (err) {
          // "already closed" is expected if the runtime tore the stream
          // down first (caller abort). Anything else is a real bug.
          const isAlreadyClosed =
            err instanceof TypeError &&
            /closed|invalid state/i.test(err.message);
          if (!isAlreadyClosed) {
            logAppEvent("error", "[chat/stream] close failed", {
              errorName: err instanceof Error ? err.name : typeof err,
              requestId,
            });
          }
        }
      }
    },
    cancel() {
      // Consumer tore down the reader before start() finished. Mark the
      // stream closed so any race-y enqueue becomes a no-op, and
      // persist the user message so the question survives reload —
      // unless the success path already persisted (or scheduled) it via
      // appendChatTurn, in which case `userMessagePersisted` is set and
      // the dedupe guard inside persistUserOnly returns immediately.
      closed = true;
      if (!retainedThread || userMessagePersisted) return;
      userMessagePersisted = true;
      try {
        after(async () => {
          try {
            await appendChatUserMessage(
              userId,
              retainedThread.videoId,
              message,
            );
          } catch (err) {
            logAppEvent("error", "[chat/stream] cancel-persist failed", {
              errorId: "CHAT_CANCEL_PERSIST_FAILED",
              userId,
              videoId,
              errorName: err instanceof Error ? err.name : typeof err,
              requestId,
            });
          }
        });
      } catch (afterErr) {
        logAppEvent("error", "[chat/stream] cancel persist scheduling failed", {
          errorId: "CHAT_CANCEL_PERSIST_SCHEDULE_FAILED",
          userId,
          videoId,
          errorName: afterErr instanceof Error ? afterErr.name : typeof afterErr,
          requestId,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
