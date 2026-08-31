import { getValidYouTubeAccess } from "@/lib/comment-moderation/connection-service";
import { decryptYouTubeToken } from "@/lib/comment-moderation/token-crypto";
import {
  disconnectYouTube,
  getYouTubeConnection,
} from "@/lib/comment-moderation/repository";
import { requireModerationUser } from "@/lib/comment-moderation/route-auth";
import { revokeGoogleToken } from "@/lib/comment-moderation/youtube-api";

export async function POST() {
  const auth = await requireModerationUser();
  if (!auth.ok) return auth.response;
  try {
    const connection = await getYouTubeConnection(auth.userId);
    if (connection) {
      let token: string | null = null;
      try {
        token = decryptYouTubeToken(connection.encryptedAccessToken);
      } catch {
        // Corrupt local ciphertext still must not prevent deletion.
      }
      try {
        token = (
          await getValidYouTubeAccess({ userId: auth.userId, connection })
        ).accessToken;
      } catch {
        // Fall back to revoking the stored access token when refresh fails.
      }
      if (token) {
        await revokeGoogleToken(token);
      }
    }
    await disconnectYouTube(auth.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[comment-moderation] disconnect failed", {
      errorId: "YOUTUBE_DISCONNECT_FAILED",
      userId: auth.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { message: "YouTube could not be disconnected right now." },
      { status: 503 },
    );
  }
}
