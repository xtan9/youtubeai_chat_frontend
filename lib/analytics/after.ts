import "server-only";

import { after } from "next/server";

/**
 * Schedule analytics after the response without ever making product work
 * depend on request-lifecycle support or the analytics callback itself.
 */
export function scheduleAnalyticsAfterResponse(
  callback: () => void | Promise<void>,
): void {
  try {
    after(async () => {
      try {
        await callback();
      } catch (error) {
        console.error("[analytics] background callback failed", {
          errorId: "ANALYTICS_BACKGROUND_CALLBACK_FAILED",
          error,
        });
      }
    });
  } catch (error) {
    if (process.env.NODE_ENV === "test") return;
    console.error("[analytics] background scheduling unavailable", {
      errorId: "ANALYTICS_BACKGROUND_SCHEDULING_UNAVAILABLE",
      error,
    });
  }
}
