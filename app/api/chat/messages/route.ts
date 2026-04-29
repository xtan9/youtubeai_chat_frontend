import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCachedTranscript } from "@/lib/services/summarize-cache";
import {
  clearChatMessages,
  listChatMessages,
} from "@/lib/services/chat-store";

const YOUTUBE_URL_RE =
  /^https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;

const QuerySchema = z.object({
  youtube_url: z
    .url()
    .regex(YOUTUBE_URL_RE, "must be an https YouTube URL"),
});

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
  return QuerySchema.safeParse(params);
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
    return Response.json({ messages: [] });
  }

  try {
    const messages = await listChatMessages(auth.user.id, transcript.videoId);
    return Response.json({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
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
