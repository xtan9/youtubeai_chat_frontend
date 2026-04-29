import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCachedSummary, getCachedTranscript } from "@/lib/services/summarize-cache";
import {
  generateSuggestedFollowups,
  readSuggestedFollowups,
  writeSuggestedFollowups,
  type SuggestedFollowups,
} from "@/lib/services/suggested-followups";
import {
  ChatMessagesQuerySchema,
  type ChatSuggestionsResponse,
} from "@/lib/api-contracts/chat";

const AUTH_CLIENT_STATUSES = new Set([400, 401, 403]);
// Tight cap on the LLM call so an upstream stall doesn't block the
// chat tab's empty state for minutes — the client will fall back to
// the static suggestion list instead.
const FOLLOWUPS_TIMEOUT_MS = 12_000;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function authenticate(): Promise<
  | { ok: true; user: User }
  | { ok: false; response: Response }
> {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_STATUSES.has(error.status ?? -1)) {
      console.error("[chat/suggestions] auth failed", {
        errorId: "CHAT_SUGGESTIONS_AUTH_FAILED",
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
    console.error("[chat/suggestions] auth threw", {
      errorId: "CHAT_SUGGESTIONS_AUTH_THREW",
      err,
    });
    return {
      ok: false,
      response: jsonError(503, "Auth service temporarily unavailable."),
    };
  }
}

function emptyResponse(): Response {
  const body: ChatSuggestionsResponse = { suggestions: [] };
  return Response.json(body);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = ChatMessagesQuerySchema.safeParse(params);
  if (!parsed.success) {
    console.warn("[chat/suggestions] invalid query", {
      errorId: "CHAT_SUGGESTIONS_QUERY_INVALID",
      issues: parsed.error.issues,
    });
    return jsonError(400, `Invalid query: ${parsed.error.message}`);
  }

  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  // No transcript yet → no summary → can't generate. The chat tab
  // doesn't render its empty state in this case anyway (it's locked
  // behind the summary), but return a 200/[] so the client query
  // doesn't trip an error banner if it fires before the lock catches.
  const transcript = await getCachedTranscript(parsed.data.youtube_url);
  if (!transcript) return emptyResponse();

  // Native-summary scoping mirrors /api/chat/stream — chat is gated
  // on the user-native summary existing, and we cache the follow-ups
  // on that row, so a translated-only state correctly returns [].
  const cachedSummary = await getCachedSummary(parsed.data.youtube_url, null);
  if (!cachedSummary) return emptyResponse();

  const videoId = transcript.videoId;

  // Cache hit fast-path. A read failure throws (we want infra issues
  // visible) but a missing/null column simply resolves to null.
  let cached: SuggestedFollowups | null = null;
  try {
    cached = await readSuggestedFollowups(videoId);
  } catch (err) {
    console.error("[chat/suggestions] cache read failed", {
      errorId: "CHAT_SUGGESTIONS_READ_FAILED",
      videoId,
      err,
    });
    // Don't 503 — fall through to regeneration. Transient infra blips
    // shouldn't block the chat empty state, and the regenerate path
    // is itself a fallback to "[]".
  }
  if (cached) {
    const body: ChatSuggestionsResponse = { suggestions: [...cached] };
    return Response.json(body);
  }

  // Cache miss — generate inline. The route returns whatever resolves
  // first; if generation throws (LLM down, schema drift, timeout), we
  // log and respond with [] so the client falls back to the static
  // suggestion list. No retry here — the empty state is non-critical.
  let generated: SuggestedFollowups;
  try {
    generated = await generateSuggestedFollowups({
      summary: cachedSummary.summary,
      timeoutMs: FOLLOWUPS_TIMEOUT_MS,
    });
  } catch (err) {
    console.error("[chat/suggestions] generation failed", {
      errorId: "CHAT_SUGGESTIONS_GENERATE_FAILED",
      videoId,
      err,
    });
    return emptyResponse();
  }

  // Persist best-effort. A write failure shouldn't block the response
  // — the user gets their suggestions; the next visit will regenerate.
  try {
    await writeSuggestedFollowups(videoId, generated);
  } catch (err) {
    console.error("[chat/suggestions] cache write failed", {
      errorId: "CHAT_SUGGESTIONS_WRITE_FAILED",
      videoId,
      err,
    });
  }

  const body: ChatSuggestionsResponse = { suggestions: [...generated] };
  return Response.json(body);
}
