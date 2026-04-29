import { z } from "zod";
import { after } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/services/rate-limit";
import {
  getCachedSummary,
  getCachedTranscript,
} from "@/lib/services/summarize-cache";
import {
  appendChatTurn,
  appendChatUserMessage,
  listChatMessages,
} from "@/lib/services/chat-store";
import { buildChatMessages } from "@/lib/prompts/chat";
import { streamChatCompletion } from "@/lib/services/llm-chat-client";
import { formatSseEvent } from "@/lib/services/llm-client";

// Chat turns can take longer than a basic API route's default; cap at
// 120s to match the gateway's typical streaming budget. Long completions
// shouldn't run forever — if we hit the cap, the client sees the stream
// close cleanly and any partial assistant text is discarded (no half-
// turn persisted).
export const maxDuration = 120;

const YOUTUBE_URL_RE =
  /^https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;
const RequestBodySchema = z.object({
  youtube_url: z
    .url()
    .regex(YOUTUBE_URL_RE, "must be an https YouTube URL"),
  message: z.string().min(1).max(4000),
});

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

  const parsed = RequestBodySchema.safeParse(rawBody);
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

  // Chat is gated on the summary already existing for this video. Read
  // the cached summary + transcript in parallel; both must be present.
  // NOTE: getCachedSummary(url, null) targets the video-native row; if
  // the user previously generated only translated rows we still find the
  // transcript and a cached summary in either form. For v1 we accept the
  // native-row summary as the chat context; translated chat is a follow-up.
  const [cachedSummary, cachedTranscript] = await Promise.all([
    getCachedSummary(youtube_url, null),
    getCachedTranscript(youtube_url),
  ]);
  if (!cachedSummary || !cachedTranscript) {
    return jsonError(404, USER_ERROR_NO_SUMMARY);
  }

  const videoId = cachedTranscript.videoId;
  const transcriptText = cachedTranscript.segments
    .map((s) => s.text)
    .join(" ");
  if (transcriptText.length > TRANSCRIPT_HARD_CAP_CHARS) {
    return jsonError(413, USER_ERROR_TRANSCRIPT_TOO_LONG);
  }

  let history: readonly Awaited<ReturnType<typeof listChatMessages>>[number][];
  try {
    history = await listChatMessages(userId, videoId);
  } catch (err) {
    console.error("[chat/stream] history load failed", {
      errorId: "CHAT_HISTORY_LOAD_FAILED",
      userId,
      videoId,
      err,
    });
    return jsonError(503, "Could not load chat history.");
  }

  const messages = buildChatMessages({
    transcript: transcriptText,
    summary: cachedSummary.summary,
    history,
    userMessage: message,
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
      const sendEvent = (data: Record<string, unknown>) => {
        if (request.signal.aborted || closed) return;
        try {
          controller.enqueue(encoder.encode(formatSseEvent(data)));
        } catch (err) {
          console.error("[chat/stream] enqueue failed", { err });
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
            } else {
              sendEvent({ type: "done" });
            }
          }
        } catch (err) {
          if (request.signal.aborted) {
            // Caller disconnect mid-stream. Preserve the user's message
            // so it shows up on reload — the assistant's partial output
            // is dropped (no half-turn persisted).
            if (!userMessagePersisted) {
              userMessagePersisted = true;
              after(async () => {
                try {
                  await appendChatUserMessage(userId, videoId, message);
                } catch (persistErr) {
                  console.error("[chat/stream] abort-persist failed", {
                    errorId: "CHAT_ABORT_PERSIST_FAILED",
                    userId,
                    videoId,
                    err: persistErr,
                  });
                }
              });
            }
            return;
          }
          console.error("[chat/stream] llm failed", {
            errorId: "CHAT_LLM_FAILED",
            userId,
            videoId,
            err,
          });
          sendEvent({ type: "error", message: USER_ERROR_GENERIC });
          return;
        }

        if (assistantBuffer.length === 0) {
          // Gateway closed without any content — surface it so the
          // client doesn't hang in a "streaming" state forever.
          console.error("[chat/stream] empty assistant response", {
            errorId: "CHAT_EMPTY_RESPONSE",
            userId,
            videoId,
          });
          sendEvent({ type: "error", message: USER_ERROR_GENERIC });
          return;
        }

        // Persist the turn after the response is delivered. Same pattern
        // as the summary route's after() cache write — keeps the
        // function alive until the DB insert resolves without blocking
        // the user.
        try {
          after(async () => {
            try {
              await appendChatTurn({
                userId,
                videoId,
                userMessage: message,
                assistantMessage: assistantBuffer,
              });
            } catch (persistErr) {
              console.error("[chat/stream] persist failed", {
                errorId: "CHAT_PERSIST_FAILED",
                userId,
                videoId,
                err: persistErr,
              });
            }
          });
        } catch (afterErr) {
          // after() registration itself threw — log distinctly so a
          // Next.js contract regression surfaces separately from a
          // Supabase blip.
          console.error("[chat/stream] persist scheduling failed", {
            errorId: "CHAT_PERSIST_SCHEDULE_FAILED",
            userId,
            videoId,
            err: afterErr,
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
      // stream closed so any race-y enqueue becomes a no-op, and persist
      // the user message so the question survives reload — but only if
      // start()'s abort branch hasn't already done so.
      closed = true;
      if (!userMessagePersisted) {
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
