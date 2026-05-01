import { after } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/services/rate-limit";
import {
  getCachedSummary,
  getCachedTranscript,
} from "@/lib/services/summarize-cache";
import { checkChatEntitlement } from "@/lib/services/entitlements";
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
import { isHeroDemoVideoId } from "@/lib/constants/hero-demo-ids";
import { getYoutubeVideoId } from "@/app/summary/utils";

// Chat turns are typically much shorter than the summarize pipeline
// (no transcription, no segmenting), so 120s is enough headroom for
// the longest reasonable answer. The summarize route uses 300s because
// it owns the whole transcribe→LLM pipeline; chat owns only the LLM
// step.
export const maxDuration = 120;

// Hard cap on transcript size to keep prompt sane. ~4 chars/token; 600k
// chars ≈ 150k tokens leaves headroom under typical Claude context limits
// after the system instructions and chat history are added.
const TRANSCRIPT_HARD_CAP_CHARS = 600_000;

const USER_ERROR_GENERIC =
  "Something went wrong answering your question. Please try again.";
const USER_ERROR_NO_SUMMARY =
  "Generate the summary first, then ask follow-up questions.";
const USER_ERROR_TRANSCRIPT_TOO_LONG =
  "This video's transcript is too long for chat. Please try a shorter video.";

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = ChatStreamRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, `Invalid request body: ${parsed.error.message}`);
  }
  const { youtube_url, message } = parsed.data;

  // Match the summary route's auth-vs-infra error classification: 4xx
  // from supabase auth means the request is unauthenticated; everything
  // else means the auth service is sick and we should 503.
  const AUTH_CLIENT_STATUSES = new Set([400, 401, 403]);
  const supabase = await createClient();
  let user: User | null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_STATUSES.has(error.status ?? -1)) {
      console.error("[chat/stream] auth failed", {
        status: error.status ?? null,
        message: error.message,
      });
      return jsonError(503, "Auth service temporarily unavailable.");
    }
    user = data.user;
  } catch (err) {
    console.error("[chat/stream] auth threw", { err });
    return jsonError(503, "Auth service temporarily unavailable.");
  }
  if (!user) return jsonError(401, "Unauthorized");

  const userId = user.id;
  const isAnonymous = user.is_anonymous ?? false;

  // Anonymous chat is allowed only for the hero-demo sample videos so the
  // marketing page on `/` can let visitors actually feel the chat
  // experience without a sign-up wall. Their own pasted URLs still 402.
  // Reuses the canonical extractor so `embed/`, `shorts/`, `m.youtube.com`
  // forms (and the 11-char length guard) all parse identically to the
  // rest of the app.
  const demoVideoId = getYoutubeVideoId(youtube_url);
  const isDemoVideo = isHeroDemoVideoId(demoVideoId);

  if (isAnonymous && !isDemoVideo) {
    return new Response(
      JSON.stringify({
        message: "Sign up to chat about your videos.",
        errorCode: "anon_chat_blocked",
        tier: "anon",
        upgradeUrl: "/auth/sign-up",
      }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  const rateLimit = await checkRateLimit(userId, isAnonymous);
  if (rateLimit.reason === "fail_open") {
    console.error("[chat/stream] rate-limit bypassed (fail-open)", {
      errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
      userId,
      youtubeUrl: youtube_url,
    });
  }
  if (!rateLimit.allowed) {
    return jsonError(429, "Rate limit exceeded. Please try again later.");
  }

  // Chat is gated on the video-native summary row already existing for
  // this video. `getCachedSummary(url, null)` filters strictly with
  // `output_language IS NULL` (see summarize-cache.ts), so a user who
  // only generated translated summaries hits 404 here — chat in
  // translated languages is a follow-up. Both reads run in parallel
  // because they're independent cache lookups.
  const [cachedSummary, cachedTranscript] = await Promise.all([
    getCachedSummary(youtube_url, null),
    getCachedTranscript(youtube_url),
  ]);
  if (!cachedSummary || !cachedTranscript) {
    return jsonError(404, USER_ERROR_NO_SUMMARY);
  }

  const entitlement = await checkChatEntitlement(userId, cachedSummary.videoId);
  if (entitlement.reason === "fail_open") {
    console.error("[chat/stream] entitlement bypassed (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST",
      userId,
      videoId: cachedSummary.videoId,
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
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  const videoId = cachedTranscript.videoId;
  // Prefix each segment with its [mm:ss] start time so the model can
  // cite real video timestamps in answers. Without this, the assistant
  // sees a flat run-on transcript and (correctly) refuses to invent
  // `[mm:ss]` positions — caught in production e2e where the model
  // explicitly told the user "the transcript does not include video
  // timestamps." formatTimestamp uses the same shape the citation
  // parser on the frontend recognizes, so the round-trip is closed.
  const transcriptText = cachedTranscript.segments
    .map((s) => `${formatTimestamp(s.start)} ${s.text}`)
    .join("\n");
  if (transcriptText.length > TRANSCRIPT_HARD_CAP_CHARS) {
    return jsonError(413, USER_ERROR_TRANSCRIPT_TOO_LONG);
  }

  let history: readonly ChatMessageRow[];
  try {
    const fullHistory = await listChatMessages(userId, videoId);
    // Cap history at the route boundary so a long-running thread can't
    // blow the LLM's context window and the per-turn token cost stays
    // bounded regardless of how many turns the user has accumulated.
    history =
      fullHistory.length > MAX_HISTORY_MESSAGES
        ? fullHistory.slice(-MAX_HISTORY_MESSAGES)
        : fullHistory;
  } catch (err) {
    console.error("[chat/stream] history load failed", {
      errorId: "CHAT_HISTORY_LOAD_FAILED",
      userId,
      videoId,
      err,
    });
    return jsonError(503, "Could not load chat history.");
  }

  // Anthropic prompt caching via OpenAI-compat. Off by default — the
  // gateway (CLIProxyAPI) hasn't been verified to pass cache_control
  // through at the time of writing. Operators can flip the flag in
  // env after running a probe (re-send the same primer twice and
  // inspect Anthropic billing for cache hits). When stripped by the
  // gateway, cache_control gracefully degrades to "no cache" rather
  // than a 4xx, so the rollout is safe.
  const cacheStablePrefix =
    process.env.LLM_PROMPT_CACHE_ENABLED?.toLowerCase() === "true";
  const messages = buildChatMessages({
    transcript: transcriptText,
    summary: cachedSummary.summary,
    history,
    userMessage: message,
    cacheStablePrefix,
  });

  // Stream-side state. `closed` flips on natural end OR consumer cancel
  // so any in-flight enqueue short-circuits instead of writing into a
  // dead controller. `assistantBuffer` accumulates the full response so
  // the post-stream persist can see what to write. `userMessagePersisted`
  // de-duplicates the user-only persist between the start() abort branch
  // and the cancel() hook — without this, both could fire and we'd insert
  // the same question twice.
  let closed = false;
  let assistantBuffer = "";
  let userMessagePersisted = false;

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
          console.error("[chat/stream] enqueue failed", {
            errorId: "CHAT_ENQUEUE_FAILED",
            eventType: data.type,
            err,
          });
        }
      };

      // Schedule the user-only persist exactly once. Used by both the
      // start()-side abort branch and cancel(); the dedupe flag keeps a
      // post-success cancel() (rare, but observed when a flush races a
      // disconnect) from inserting the question a second time.
      const persistUserOnly = (errorId: string) => {
        if (userMessagePersisted) return;
        userMessagePersisted = true;
        try {
          after(async () => {
            try {
              await appendChatUserMessage(userId, videoId, message);
            } catch (persistErr) {
              console.error("[chat/stream] user-only persist failed", {
                errorId,
                userId,
                videoId,
                err: persistErr,
              });
            }
          });
        } catch (afterErr) {
          console.error("[chat/stream] user-only persist scheduling failed", {
            errorId: `${errorId}_SCHEDULE`,
            userId,
            videoId,
            err: afterErr,
          });
        }
      };

      try {
        try {
          for await (const evt of streamChatCompletion({
            messages,
            signal: request.signal,
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
          console.error("[chat/stream] llm failed", {
            errorId: "CHAT_LLM_FAILED",
            userId,
            videoId,
            err,
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
          console.error("[chat/stream] empty assistant response", {
            errorId: "CHAT_EMPTY_RESPONSE",
            userId,
            videoId,
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
        try {
          await appendChatTurn({
            userId,
            videoId,
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
          console.error("[chat/stream] persist failed", {
            errorId: "CHAT_PERSIST_FAILED",
            userId,
            videoId,
            err: persistErr,
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
            console.error("[chat/stream] close failed", { err });
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
      if (userMessagePersisted) return;
      userMessagePersisted = true;
      try {
        after(async () => {
          try {
            await appendChatUserMessage(userId, videoId, message);
          } catch (err) {
            console.error("[chat/stream] cancel-persist failed", {
              errorId: "CHAT_CANCEL_PERSIST_FAILED",
              userId,
              videoId,
              err,
            });
          }
        });
      } catch (afterErr) {
        console.error("[chat/stream] cancel persist scheduling failed", {
          errorId: "CHAT_CANCEL_PERSIST_SCHEDULE_FAILED",
          userId,
          videoId,
          err: afterErr,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
