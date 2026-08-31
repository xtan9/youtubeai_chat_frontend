import {
  ModerationItemUnavailableError,
  replyToModerationItem,
} from "@/lib/comment-moderation/moderation-service";
import { requireModerationUser } from "@/lib/comment-moderation/route-auth";
import { YouTubeApiError } from "@/lib/comment-moderation/youtube-api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const auth = await requireModerationUser();
  if (!auth.ok) return auth.response;
  const { itemId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
    return Response.json({ message: "Invalid moderation item." }, { status: 400 });
  }
  try {
    await replyToModerationItem({ userId: auth.userId, itemId });
    return Response.json({ status: "replied" });
  } catch (error) {
    if (error instanceof ModerationItemUnavailableError) {
      return Response.json({ message: error.message }, { status: 409 });
    }
    if (error instanceof YouTubeApiError) {
      return Response.json(
        { message: "YouTube rejected the reply. Reconnect or try again." },
        { status: error.status === 401 ? 409 : 502 },
      );
    }
    console.error("[comment-moderation] manual reply failed", {
      errorId: "COMMENT_MODERATION_REPLY_FAILED",
      userId: auth.userId,
      itemId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { message: "The reply could not be published right now." },
      { status: 502 },
    );
  }
}
