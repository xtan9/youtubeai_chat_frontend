import {
  InvalidModerationRequestError,
  scanYouTubeComments,
} from "@/lib/comment-moderation/moderation-service";
import { scanRequestSchema } from "@/lib/comment-moderation/contracts";
import { YouTubeConnectionRequiredError } from "@/lib/comment-moderation/connection-service";
import { requireModerationUser } from "@/lib/comment-moderation/route-auth";
import { YouTubeApiError } from "@/lib/comment-moderation/youtube-api";

export async function POST(request: Request) {
  const auth = await requireModerationUser();
  if (!auth.ok) return auth.response;
  const parsed = scanRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      {
        message:
          parsed.error.issues[0]?.message ?? "Check the scan details.",
      },
      { status: 400 },
    );
  }
  try {
    const result = await scanYouTubeComments({
      userId: auth.userId,
      source: parsed.data.source,
      videoUrl: parsed.data.videoUrl,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof InvalidModerationRequestError) {
      return Response.json({ message: error.message }, { status: 400 });
    }
    if (
      error instanceof YouTubeConnectionRequiredError ||
      (error instanceof YouTubeApiError && error.status === 401)
    ) {
      return Response.json(
        { message: "Reconnect YouTube to continue.", reconnect: true },
        { status: 409 },
      );
    }
    console.error("[comment-moderation] scan failed", {
      errorId: "COMMENT_MODERATION_SCAN_FAILED",
      userId: auth.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { message: "Comments could not be scanned right now." },
      { status: 502 },
    );
  }
}
