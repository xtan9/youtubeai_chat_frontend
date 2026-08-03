import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  clearChatMessages,
  listChatMessages,
} from "@/lib/services/chat-store";
import {
  resolveVideoChatSubject,
  type CanonicalVideoIdentity,
  type VideoChatSubject,
} from "@/lib/services/video-chat-subject";
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

type HistorySubjectResult =
  | {
      readonly ok: true;
      readonly subject: VideoChatSubject | null;
      readonly identity: CanonicalVideoIdentity;
    }
  | { readonly ok: false; readonly response: Response };

function subjectUnavailableResponse(
  operation: "GET" | "DELETE",
  videoId: string,
): Response {
  logAppEvent(
    "error",
    `[chat/messages] subject resolution unavailable (${operation})`,
    {
      errorId: "CHAT_MESSAGES_SUBJECT_UNAVAILABLE",
      videoId,
      errorClass: "SubjectResolution",
    },
  );
  return jsonError(
    503,
    operation === "GET"
      ? "Could not load chat history."
      : "Could not clear chat history.",
  );
}

async function resolveHistorySubject(
  youtubeUrl: string,
  operation: "GET" | "DELETE",
): Promise<HistorySubjectResult> {
  try {
    const resolution = await resolveVideoChatSubject(youtubeUrl);
    if (resolution.status === "invalid") {
      logAppEvent("warn", `[chat/messages] invalid subject (${operation})`, {
        errorId: "CHAT_MESSAGES_SUBJECT_INVALID",
        errorClass: "InvalidVideoUrl",
      });
      return { ok: false, response: jsonError(400, "Invalid query") };
    }
    if (resolution.status === "unavailable") {
      return {
        ok: false,
        response: subjectUnavailableResponse(
          operation,
          resolution.identity.youtubeVideoId,
        ),
      };
    }
    if (resolution.status === "not_ready") {
      return {
        ok: true,
        subject: null,
        identity: resolution.identity,
      };
    }
    return {
      ok: true,
      subject: resolution.subject,
      identity: resolution.subject.identity,
    };
  } catch {
    return {
      ok: false,
      response: subjectUnavailableResponse(operation, videoIdForLog(youtubeUrl)),
    };
  }
}

function noRetainedThreadReason(
  subject: VideoChatSubject | null,
): "stateless" | "not_ready" {
  return subject?.source === "hero_demo" ? "stateless" : "not_ready";
}

function logNoRetainedThread(
  operation: "GET" | "DELETE",
  userId: string,
  identity: CanonicalVideoIdentity,
  subject: VideoChatSubject | null,
): void {
  const reason = noRetainedThreadReason(subject);
  logAppEvent(
    "info",
    operation === "GET"
      ? "[chat/messages] empty list - no retained thread"
      : "[chat/messages] clear no-op - no retained thread",
    {
      errorId:
        operation === "GET"
          ? "CHAT_MESSAGES_NO_RETAINED_THREAD"
          : "CHAT_MESSAGES_CLEAR_NO_RETAINED_THREAD",
      userId,
      videoId: identity.youtubeVideoId,
      reason,
    },
  );
}

export async function GET(request: Request) {
  const parsed = parseQuery(request);
  if (!parsed.success) {
    logAppEvent("warn", "[chat/messages] invalid query (GET)", {
      errorId: "CHAT_MESSAGES_QUERY_INVALID",
      errorClass: "SchemaMismatch",
    });
    return jsonError(400, "Invalid query");
  }

  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  const subjectResult = await resolveHistorySubject(
    parsed.data.youtube_url,
    "GET",
  );
  if (!subjectResult.ok) return subjectResult.response;

  const retainedThread = subjectResult.subject?.retainedThread;
  if (!retainedThread) {
    logNoRetainedThread(
      "GET",
      auth.user.id,
      subjectResult.identity,
      subjectResult.subject,
    );
    const empty: ChatMessagesResponse = { messages: [] };
    return Response.json(empty);
  }

  try {
    const messages = await listChatMessages(
      auth.user.id,
      retainedThread.videoId,
    );
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

  const subjectResult = await resolveHistorySubject(
    parsed.data.youtube_url,
    "DELETE",
  );
  if (!subjectResult.ok) return subjectResult.response;

  const retainedThread = subjectResult.subject?.retainedThread;
  if (!retainedThread) {
    logNoRetainedThread(
      "DELETE",
      auth.user.id,
      subjectResult.identity,
      subjectResult.subject,
    );
    return new Response(null, { status: 204 });
  }

  try {
    await clearChatMessages(auth.user.id, retainedThread.videoId);
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
