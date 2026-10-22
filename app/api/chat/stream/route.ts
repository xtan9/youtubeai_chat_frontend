import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { checkChatEntitlement, resolveRegisteredSubscription } from "@/lib/services/entitlements";
import { listVideoChatMessages } from "@/lib/services/video-chat-history";
import type { ChatMessageRow } from "@/lib/services/chat-store";
import { buildChatMessages, MAX_HISTORY_MESSAGES } from "@/lib/prompts/chat";
import { ChatStreamRequestSchema } from "@/lib/api-contracts/chat";
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
  reserveAnonymousTrialChatMessage,
  type AnonymousTrialReservationResult,
} from "@/lib/services/anonymous-trial";
import {
  admitRegisteredFreeHeroDemoChatMessage,
  type RegisteredFreeHeroDemoAdmissionResult,
} from "@/lib/services/registered-free-hero-demo";
import { createVideoChatStreamResponse } from "../../../../lib/services/video-chat-stream";

// Chat turns are typically much shorter than the summarize pipeline
// (no transcription, no segmenting), so 120s is enough headroom for
// the longest reasonable answer. The summarize route uses 300s because
// it owns the whole transcribe→LLM pipeline; chat owns only the LLM
// step.
export const maxDuration = 120;

// Preserve the existing transcript budget for cost and latency. 400K chars are roughly
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

function anonymousTrialRemainingBucket(
  remainingMessages: number | undefined,
): "0" | "1-4" | "5" | "unavailable" {
  if (remainingMessages === 0) return "0";
  if (remainingMessages === 5) return "5";
  if (remainingMessages !== undefined) return "1-4";
  return "unavailable";
}

function logAnonymousTrialAdmissionDenied(input: {
  readonly level: "error" | "warn" | "info";
  readonly errorId: string;
  readonly outcome: string;
  readonly remainingMessages?: number;
}): void {
  logAppEvent(input.level, "[chat/stream] anonymous trial admission denied", {
    errorId: input.errorId,
    outcome: input.outcome,
    remainingAllowanceBucket: anonymousTrialRemainingBucket(
      input.remainingMessages,
    ),
  });
}

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
  // some future subject kinds may have neither boundary.
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
      const fullHistory = await listVideoChatMessages(userId, retainedThread);
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
        videoId:
          retainedThread.kind === "database"
            ? retainedThread.videoId
            : retainedThread.youtubeVideoId,
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
    anonymousTrialStructuredResult: anonymousTrialEnabled,
  });
  const anonymousTrialAvailableCitations = new Set(
    grounding.transcript.segments.map((segment) =>
      formatTimestamp(segment.start),
    ),
  );

  let anonymousReservation: Extract<
    AnonymousTrialReservationResult,
    { outcome: "admitted" }
  > | null = null;
  if (anonymousTrialEnabled) {
    const reservation = await reserveAnonymousTrialChatMessage({ userId, request });
    if (reservation.outcome === "exhausted") {
      logAnonymousTrialAdmissionDenied({
        level: "info",
        errorId: "ANONYMOUS_TRIAL_EXHAUSTED",
        outcome: reservation.outcome,
        remainingMessages: reservation.remainingMessages,
      });
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
      logAnonymousTrialAdmissionDenied({
        level: "error",
        errorId: "ANONYMOUS_TRIAL_UNAVAILABLE",
        outcome: "dependency_failure",
      });
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
    if (reservation.outcome !== "admitted") {
      const denial = {
        network_limited: {
          status: 429,
          errorId: "ANONYMOUS_TRIAL_NETWORK_LIMITED",
          message: "Anonymous chat is busy on this network. Try again later or create an account.",
          errorCode: "anonymous_trial_rate_limited",
        },
        concurrent: {
          status: 409,
          errorId: "ANONYMOUS_TRIAL_CONCURRENT",
          message: "Another anonymous response is in progress. Try again shortly.",
          errorCode: "anonymous_trial_concurrent",
        },
        global_shutdown: {
          status: 503,
          errorId: "ANONYMOUS_TRIAL_GLOBAL_SHUTDOWN",
          message: "Anonymous chat is temporarily unavailable. Create an account to continue.",
          errorCode: "anonymous_trial_unavailable",
        },
      }[reservation.outcome];
      logAnonymousTrialAdmissionDenied({
        level: reservation.outcome === "global_shutdown" ? "error" : "warn",
        errorId: denial.errorId,
        outcome: reservation.outcome,
        remainingMessages: reservation.remainingMessages,
      });
      return new Response(
        JSON.stringify({
          message: denial.message,
          errorCode: denial.errorCode,
          remainingMessages: reservation.remainingMessages,
          upgradeUrl: "/auth/sign-up",
        }),
        {
          status: denial.status,
          headers: {
            "Content-Type": "application/json",
            [REQUEST_ID_HEADER]: requestId,
            "X-Error-ID": denial.errorId,
            ...(reservation.outcome === "network_limited"
              ? { "Retry-After": "3600" }
              : {}),
          },
        },
      );
    }
    anonymousReservation = reservation;
  }

  return createVideoChatStreamResponse({
    request,
    requestId,
    userId,
    videoId,
    message,
    messages,
    retainedThread,
    anonymousTrialEnabled,
    anonymousReservation,
    anonymousTrialAvailableCitations,
    registeredFreeHeroDemoAdmission,
  });
}
