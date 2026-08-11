import "server-only";

import { logAppEvent } from "@/lib/observability";
import { cleanupInactiveAnonymousDemoConversations } from "@/lib/services/video-chat-history";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    cronSecret.length < 16 ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json({ outcome: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupInactiveAnonymousDemoConversations(500);
    logAppEvent(
      "info",
      "[hero-demo-conversations] retention cleanup complete",
      { count: result.deletedConversations },
    );
    return Response.json(result);
  } catch (error) {
    logAppEvent(
      "error",
      "[hero-demo-conversations] retention cleanup failed",
      {
        errorId: "HERO_DEMO_RETENTION_CLEANUP_FAILED",
        errorName: error instanceof Error ? error.name : typeof error,
      },
    );
    return Response.json({ deletedConversations: 0 }, { status: 503 });
  }
}
