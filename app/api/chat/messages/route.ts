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
import { logAppEvent, videoIdForLog } from "@/lib/observability";

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
      logAppEvent("error", "[chat/messages] auth failed", {
        status: error.status ?? null,
        errorId: "CHAT_MESSAGES_AUTH_FAILED",
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
    logAppEvent("error", "[chat/messages] auth threw", {
      errorId: "CHAT_MESSAGES_AUTH_THREW",
      errorName: err instanceof Error ? err.name : typeof err,
    });
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
    // Log so a frontend regression that ships malformed query params
    // surfaces in ops dashboards before users notice 400 banners.
    logAppEvent("warn", "[chat/messages] invalid query (GET)", {
      errorId: "CHAT_MESSAGES_QUERY_INVALID",
      errorClass: "SchemaMismatch",
    });
    return jsonError(400, "Invalid query");
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
    logAppEvent("info", "[chat/messages] empty list — no transcript cached", {
      errorId: "CHAT_MESSAGES_NO_TRANSCRIPT",
      userId: auth.user.id,
      videoId: videoIdForLog(parsed.data.youtube_url),
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
    logAppEvent("error", "[chat/messages] list failed", {
      errorId: "CHAT_MESSAGES_LIST_FAILED",
      userId: auth.user.id,
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return jsonError(503, "Could not load chat history.");
  }
}

export async function DELETE(request: Request) {
  const parsed = parseQuery(request);
  if (!parsed.success) {
    logAppEvent("warn", "[chat/messages] invalid query (DELETE)", {
      errorId: "CHAT_MESSAGES_QUERY_INVALID",
      errorClass: "SchemaMismatch",
    });
    return jsonError(400, "Invalid query");
  }

  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  // Same fail-soft as GET: no videos row → nothing to clear, return 204.
  const transcript = await getCachedTranscript(parsed.data.youtube_url);
  if (!transcript) {
    logAppEvent("info", "[chat/messages] clear no-op — no transcript cached", {
      errorId: "CHAT_MESSAGES_CLEAR_NO_TRANSCRIPT",
      userId: auth.user.id,
      videoId: videoIdForLog(parsed.data.youtube_url),
    });
    return new Response(null, { status: 204 });
  }

  try {
    await clearChatMessages(auth.user.id, transcript.videoId);
    return new Response(null, { status: 204 });
  } catch (err) {
    logAppEvent("error", "[chat/messages] clear failed", {
      errorId: "CHAT_MESSAGES_CLEAR_FAILED",
      userId: auth.user.id,
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return jsonError(503, "Could not clear chat history.");
  }
}
