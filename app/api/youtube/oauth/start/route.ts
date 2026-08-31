import { createYouTubeOAuthState } from "@/lib/comment-moderation/oauth-state";
import { requireModerationUser } from "@/lib/comment-moderation/route-auth";
import { buildYouTubeAuthorizationUrl } from "@/lib/comment-moderation/youtube-api";

export async function GET(request: Request) {
  const auth = await requireModerationUser();
  if (!auth.ok) return auth.response;
  const origin = new URL(request.url).origin;
  const state = createYouTubeOAuthState(auth.userId);
  return Response.redirect(
    buildYouTubeAuthorizationUrl({ state, origin }),
    302,
  );
}
