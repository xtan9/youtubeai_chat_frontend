import { PostHog } from "posthog-node";
import {
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsEventProperties,
} from "./events";

const POSTHOG_HOST = "https://us.i.posthog.com";

export async function captureSubscriptionActivated(
  distinctId: string,
  properties: AnalyticsEventProperties["subscription_activated"],
): Promise<void> {
  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (process.env.NODE_ENV !== "production" || !projectToken) {
    return;
  }

  const client = new PostHog(projectToken, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });

  try {
    await client.captureImmediate({
      distinctId,
      event: "subscription_activated",
      properties: {
        analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
        ...properties,
      },
    });
  } catch (err) {
    console.error("[analytics] server capture failed", {
      errorId: "ANALYTICS_SERVER_CAPTURE_FAILED",
      event: "subscription_activated",
      err,
    });
  } finally {
    try {
      await client.shutdown();
    } catch (err) {
      console.error("[analytics] server shutdown failed", {
        errorId: "ANALYTICS_SERVER_SHUTDOWN_FAILED",
        event: "subscription_activated",
        err,
      });
    }
  }
}
