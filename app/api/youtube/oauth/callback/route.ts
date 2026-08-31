import { connectYouTubeAccount } from "@/lib/comment-moderation/connection-service";
import { verifyYouTubeOAuthState } from "@/lib/comment-moderation/oauth-state";
import { requireModerationUser } from "@/lib/comment-moderation/route-auth";

function moderationRedirect(origin: string, key: string, value: string) {
  const url = new URL("/moderation", origin);
  url.searchParams.set(key, value);
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const auth = await requireModerationUser();
  if (!auth.ok) return moderationRedirect(url.origin, "youtube", "signed-out");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (
    !code ||
    !state ||
    !verifyYouTubeOAuthState(state, auth.userId)
  ) {
    return moderationRedirect(url.origin, "youtube", "invalid-callback");
  }
  try {
    await connectYouTubeAccount({
      userId: auth.userId,
      code,
      origin: url.origin,
    });
    return moderationRedirect(url.origin, "youtube", "connected");
  } catch (error) {
    console.error("[comment-moderation] YouTube OAuth callback failed", {
      errorId: "YOUTUBE_OAUTH_CALLBACK_FAILED",
      userId: auth.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return moderationRedirect(url.origin, "youtube", "connection-failed");
  }
}
