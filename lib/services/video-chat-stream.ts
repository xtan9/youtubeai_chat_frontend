import { after } from "next/server";
import {
  appendVideoChatTurn,
  appendVideoChatUserMessage,
} from "@/lib/services/video-chat-history";
import type { buildChatMessages } from "@/lib/prompts/chat";
import { streamChatCompletion } from "@/lib/services/llm-chat-client";
import { formatSseEvent } from "@/lib/services/llm-client";
import { type ChatSseEvent } from "@/lib/api-contracts/chat";
import { type VideoChatSubject } from "@/lib/services/video-chat-subject";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { logAppEvent } from "@/lib/observability";
import {
  completeAnonymousTrialChatMessage,
  markAnonymousTrialChatMessageStarted,
  refundAnonymousTrialChatMessage,
  type AnonymousTrialReservationResult,
} from "@/lib/services/anonymous-trial";
import {
  type RegisteredFreeHeroDemoAdmissionResult,
} from "@/lib/services/registered-free-hero-demo";
import {
  MAX_ANONYMOUS_TRIAL_RESULT_CHARS,
  validateAnonymousTrialChatResult,
} from "@/lib/services/anonymous-trial-chat-result";

const USER_ERROR_GENERIC =
  "Something went wrong answering your question. Please try again.";

export function createVideoChatStreamResponse({
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
}: {
  readonly request: Request;
  readonly requestId: string;
  readonly userId: string;
  readonly videoId: string;
  readonly message: string;
  readonly messages: ReturnType<typeof buildChatMessages>;
  readonly retainedThread: VideoChatSubject["retainedThread"];
  readonly anonymousTrialEnabled: boolean;
  readonly anonymousReservation: Extract<AnonymousTrialReservationResult, { outcome: "admitted" }> | null;
  readonly anonymousTrialAvailableCitations: ReadonlySet<string>;
  readonly registeredFreeHeroDemoAdmission: Extract<RegisteredFreeHeroDemoAdmissionResult, { outcome: "admitted" }> | null;
}): Response {
  // Stream-side state. `closed` flips on natural end or consumer cancel so
  // in-flight enqueues stop, while `assistantBuffer` holds the durable answer.
  // `userMessagePersisted` prevents duplicate user-only writes on abort races.
  let closed = false;
  let assistantBuffer = "";
  let anonymousTrialStarted = false;
  let anonymousTrialCompletion:
    | ReturnType<typeof completeAnonymousTrialChatMessage>
    | undefined;
  const releaseAnonymousTrialLease = () => {
    if (!anonymousTrialStarted || !anonymousReservation) {
      return Promise.resolve();
    }
    anonymousTrialCompletion ??= completeAnonymousTrialChatMessage({
      userId,
      reservationId: anonymousReservation.reservationId,
    });
    return anonymousTrialCompletion;
  };
  // A subject without retention starts with no persistence work to do.
  let userMessagePersisted = !retainedThread;

  // Schedule the user-only persist exactly once. Used by both the
  // start()-side abort branch and cancel(); the dedupe flag keeps a
  // post-success cancel() (rare, but observed when a flush races a
  // disconnect) from inserting the question a second time.
  const persistUserOnly = (errorId: string, cancelled = false) => {
    if (!retainedThread || userMessagePersisted) return;
    userMessagePersisted = true;
    try {
      after(async () => {
        try {
          await appendVideoChatUserMessage(
            userId,
            retainedThread,
            message,
          );
        } catch (persistErr) {
          logAppEvent("error", cancelled ? "[chat/stream] cancel-persist failed" : "[chat/stream] user-only persist failed", {
            errorId,
            userId,
            videoId,
            errorName: persistErr instanceof Error ? persistErr.name : typeof persistErr,
            requestId,
          });
        }
      });
    } catch (afterErr) {
      logAppEvent("error", cancelled ? "[chat/stream] cancel persist scheduling failed" : "[chat/stream] user-only persist scheduling failed", {
        errorId: cancelled ? "CHAT_CANCEL_PERSIST_SCHEDULE_FAILED" : `${errorId}_SCHEDULE`,
        userId,
        videoId,
        errorName: afterErr instanceof Error ? afterErr.name : typeof afterErr,
        requestId,
      });
    }
  };

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

      const rejectInvalidAnonymousAnswer = () => {
        logAppEvent("warn", "[chat/stream] anonymous trial terminal outcome", {
          errorId: "CHAT_ANONYMOUS_ANSWER_INVALID",
          outcome: "invalid_grounding",
          userId,
          videoId,
          requestId,
        });
        // The admitted model call is still part of the retained thread:
        // keep the learner's question for a safe retry, but never persist
        // or expose the rejected assistant payload.
        persistUserOnly("CHAT_ANONYMOUS_ANSWER_INVALID_PERSIST_FAILED");
        sendEvent({
          type: "error",
          message:
            "We couldn't validate that answer against the selected video. Try another question.",
          errorCode: "anonymous_trial_invalid_answer",
        });
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
          anonymousTrialStarted = true;
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
              if (
                anonymousTrialEnabled &&
                assistantBuffer.length + evt.text.length >
                  MAX_ANONYMOUS_TRIAL_RESULT_CHARS
              ) {
                rejectInvalidAnonymousAnswer();
                return;
              }
              assistantBuffer += evt.text;
              if (!anonymousTrialEnabled) {
                sendEvent({ type: "delta", text: evt.text });
              }
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

        if (anonymousTrialEnabled) {
          const validated = validateAnonymousTrialChatResult(
            assistantBuffer,
            anonymousTrialAvailableCitations,
          );
          if (validated.outcome === "rejected") {
            rejectInvalidAnonymousAnswer();
            return;
          }
          assistantBuffer = validated.text;
          sendEvent({ type: "delta", text: validated.text });
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
          await appendVideoChatTurn({
            userId,
            thread: retainedThread,
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
        await releaseAnonymousTrialLease();
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
      void releaseAnonymousTrialLease();
      persistUserOnly("CHAT_CANCEL_PERSIST_FAILED", true);
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
