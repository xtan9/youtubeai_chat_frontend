import {
  resolveRequestPrincipal,
  type RequestPrincipal,
} from "@/lib/auth/request-principal";
import {
  generateSuggestedFollowups,
  type SuggestedFollowups,
} from "@/lib/services/suggested-followups";
import {
  resolveVideoChatSubject,
  type VideoGrounding,
  type VideoGroundingResolution,
} from "@/lib/services/video-chat-subject";
import {
  ChatMessagesQuerySchema,
  type ChatSuggestionsResponse,
} from "@/lib/api-contracts/chat";
import { logAppEvent, videoIdForLog } from "@/lib/observability";

// Tight cap on the LLM call so an upstream stall does not block the chat
// tab's empty state for minutes. The client falls back to static suggestions.
const FOLLOWUPS_TIMEOUT_MS = 12_000;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function authenticate(): Promise<
  | { ok: true; principal: RequestPrincipal }
  | { ok: false; response: Response }
> {
  const result = await resolveRequestPrincipal({ source: "chat_suggestions" });
  if (result.kind === "unavailable") {
    return {
      ok: false,
      response: jsonError(503, "Auth service temporarily unavailable."),
    };
  }
  if (result.kind === "missing") {
    return { ok: false, response: jsonError(401, "Unauthorized") };
  }
  return { ok: true, principal: result.principal };
}

function emptyResponse(): Response {
  const body: ChatSuggestionsResponse = { suggestions: [] };
  return Response.json(body);
}

function logSubjectNotReady(videoId: string): void {
  logAppEvent("info", "[chat/suggestions] subject not ready", {
    errorId: "CHAT_SUGGESTIONS_SUBJECT_NOT_READY",
    videoId,
    reason: "not_ready",
  });
}

function logSubjectUnavailable(videoId: string, errorName?: string): void {
  logAppEvent("error", "[chat/suggestions] subject unavailable", {
    errorId: "CHAT_SUGGESTIONS_SUBJECT_UNAVAILABLE",
    videoId,
    errorName: errorName ?? null,
    errorClass: "SubjectResolution",
  });
}

function logGroundingNotReady(videoId: string): void {
  logAppEvent("info", "[chat/suggestions] Grounding not ready", {
    errorId: "CHAT_SUGGESTIONS_GROUNDING_NOT_READY",
    videoId,
    reason: "not_ready",
  });
}

function logGroundingUnavailable(videoId: string, errorName?: string): void {
  logAppEvent("error", "[chat/suggestions] Grounding unavailable", {
    errorId: "CHAT_SUGGESTIONS_GROUNDING_UNAVAILABLE",
    videoId,
    errorName: errorName ?? null,
    errorClass: "GroundingResolution",
  });
}

function hasCoherentSuggestionGrounding(
  grounding: VideoGrounding,
  videoId: string,
): boolean {
  return (
    grounding.transcript.videoId === videoId &&
    grounding.summary.videoId === videoId
  );
}

function handleGroundingOutcome(
  outcome: VideoGroundingResolution,
  targetVideoId: string,
  logVideoId: string,
): VideoGrounding | null {
  if (outcome.status === "ready") {
    if (!hasCoherentSuggestionGrounding(outcome.grounding, targetVideoId)) {
      logGroundingUnavailable(logVideoId, "SchemaMismatch");
      return null;
    }
    return outcome.grounding;
  }
  if (outcome.status === "not_ready") {
    logGroundingNotReady(logVideoId);
    return null;
  }
  logGroundingUnavailable(logVideoId);
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = ChatMessagesQuerySchema.safeParse(params);
  if (!parsed.success) {
    logAppEvent("warn", "[chat/suggestions] invalid query", {
      errorId: "CHAT_SUGGESTIONS_QUERY_INVALID",
      errorClass: "SchemaMismatch",
    });
    return jsonError(400, "Invalid query");
  }

  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  let resolution;
  try {
    resolution = await resolveVideoChatSubject(parsed.data.youtube_url);
  } catch (err) {
    logSubjectUnavailable(
      videoIdForLog(parsed.data.youtube_url),
      err instanceof Error ? err.name : typeof err,
    );
    return emptyResponse();
  }

  if (resolution.status === "invalid") {
    logAppEvent("warn", "[chat/suggestions] invalid subject", {
      errorId: "CHAT_SUGGESTIONS_SUBJECT_INVALID",
      errorClass: "InvalidVideoUrl",
    });
    return jsonError(400, "Invalid query");
  }
  if (resolution.status === "not_ready") {
    logSubjectNotReady(resolution.identity.youtubeVideoId);
    return emptyResponse();
  }
  if (resolution.status === "unavailable") {
    logSubjectUnavailable(resolution.identity.youtubeVideoId);
    return emptyResponse();
  }

  const { subject } = resolution;
  const suggestionCache = subject.suggestionCache;
  if (!suggestionCache) {
    logAppEvent("info", "[chat/suggestions] stateless subject", {
      errorId: "CHAT_SUGGESTIONS_STATELESS",
      videoId: subject.identity.youtubeVideoId,
      reason: "stateless",
    });
    return emptyResponse();
  }

  if (!subject.grounding) {
    logGroundingNotReady(subject.identity.youtubeVideoId);
    return emptyResponse();
  }

  let grounding: VideoGrounding | null;
  try {
    grounding = handleGroundingOutcome(
      await subject.grounding.load(),
      suggestionCache.videoId,
      subject.identity.youtubeVideoId,
    );
  } catch (err) {
    logGroundingUnavailable(
      subject.identity.youtubeVideoId,
      err instanceof Error ? err.name : typeof err,
    );
    return emptyResponse();
  }
  if (!grounding) return emptyResponse();

  // Cache hits avoid the LLM. Cache reads may fail transiently; that is a
  // generation miss, not a reason to make this non-critical endpoint fail.
  let cached: SuggestedFollowups | null = null;
  try {
    cached = await suggestionCache.read();
  } catch (err) {
    logAppEvent("error", "[chat/suggestions] cache read failed", {
      errorId: "CHAT_SUGGESTIONS_READ_FAILED",
      videoId: suggestionCache.videoId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
  if (cached) {
    const body: ChatSuggestionsResponse = { suggestions: [...cached] };
    return Response.json(body);
  }

  let generated: SuggestedFollowups;
  try {
    generated = await generateSuggestedFollowups({
      summary: grounding.summary.summary,
      timeoutMs: FOLLOWUPS_TIMEOUT_MS,
    });
  } catch (err) {
    logAppEvent("error", "[chat/suggestions] generation failed", {
      errorId: "CHAT_SUGGESTIONS_GENERATE_FAILED",
      videoId: suggestionCache.videoId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return emptyResponse();
  }

  // Persist best-effort. A write failure should not block the response.
  try {
    await suggestionCache.write(generated);
  } catch (err) {
    logAppEvent("error", "[chat/suggestions] cache write failed", {
      errorId: "CHAT_SUGGESTIONS_WRITE_FAILED",
      videoId: suggestionCache.videoId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }

  const body: ChatSuggestionsResponse = { suggestions: [...generated] };
  return Response.json(body);
}
