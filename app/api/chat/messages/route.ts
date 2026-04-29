import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCachedTranscript } from "@/lib/services/summarize-cache";
import {
  clearChatMessages,
  listChatMessages,
} from "@/lib/services/chat-store";
import {
  ChatMessagesQuerySchema,
  type ChatMessagesResponse,
} from "@/lib/api-contracts/chat";

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const AUTH_CLIENT_STATUSES = new Set([400, 401, 403]);

async function authenticate(): Promise<
  | { ok: true; user: User }
  | { ok: false; response: Response }
> {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_STATUSES.has(error.status ?? -1)) {
      console.error("[chat/messages] auth failed", {
        status: error.status ?? null,
        message: error.message,
      });
      return {
        ok: false,
        response: jsonError(503, "Auth service temporarily unavailable."),
      };
    }
    if (!data.user) {
      return { ok: false, response: jsonError(401, "Unauthorized") };
    }
    return { ok: true, user: data.user };
  } catch (err) {
    console.error("[chat/messages] auth threw", { err });
    return {
      ok: false,
      response: jsonError(503, "Auth service temporarily unavailable."),
    };
  }
}

function parseQuery(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  return ChatMessagesQuerySchema.safeParse(params);
}

export async function GET(request: Request) {
  const parsed = parseQuery(request);
  if (!parsed.success) {
    return jsonError(400, `Invalid query: ${parsed.error.message}`);
  }

  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  // No videos row yet → no thread possible. Return an empty list rather
  // than 404 so the chat tab can render its empty state without a banner.
  const transcript = await getCachedTranscript(parsed.data.youtube_url);
  if (!transcript) {
    // Log so ops can distinguish "user navigated to chat for a brand-new
    // URL" (expected, brief) from "transcript cache evicted while a chat
    // tab was open" (would point at a cache-policy regression). Without
    // this signal the 200/empty response is silent in production logs.
    console.info("[chat/messages] empty list — no transcript cached", {
      errorId: "CHAT_MESSAGES_NO_TRANSCRIPT",
      userId: auth.user.id,
      youtubeUrl: parsed.data.youtube_url,
    });
    const empty: ChatMessagesResponse = { messages: [] };
    return Response.json(empty);
  }

  try {
    const messages = await listChatMessages(auth.user.id, transcript.videoId);
    const body: ChatMessagesResponse = {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
    return Response.json(body);
  } catch (err) {
    console.error("[chat/messages] list failed", {
      errorId: "CHAT_MESSAGES_LIST_FAILED",
      userId: auth.user.id,
      err,
    });
    return jsonError(503, "Could not load chat history.");
  }
}

export async function DELETE(request: Request) {
  const parsed = parseQuery(request);
  if (!parsed.success) {
    return jsonError(400, `Invalid query: ${parsed.error.message}`);
  }

  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  // Same fail-soft as GET: no videos row → nothing to clear, return 204.
  const transcript = await getCachedTranscript(parsed.data.youtube_url);
  if (!transcript) {
    console.info("[chat/messages] clear no-op — no transcript cached", {
      errorId: "CHAT_MESSAGES_CLEAR_NO_TRANSCRIPT",
      userId: auth.user.id,
      youtubeUrl: parsed.data.youtube_url,
    });
    return new Response(null, { status: 204 });
  }

  try {
    await clearChatMessages(auth.user.id, transcript.videoId);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[chat/messages] clear failed", {
      errorId: "CHAT_MESSAGES_CLEAR_FAILED",
      userId: auth.user.id,
      err,
    });
    return jsonError(503, "Could not clear chat history.");
  }
}
