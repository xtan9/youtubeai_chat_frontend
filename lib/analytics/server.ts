import { PostHog } from "posthog-node";
import type { User } from "@supabase/supabase-js";
import { isSmokeAccount } from "@/lib/auth/smoke-account";
import {
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsEventProperties,
} from "./events";
import {
  ANALYTICS_HUMAN_SUBJECT,
  ANALYTICS_SUBJECT_PROPERTY,
  SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
} from "./identity";
import { validateCompatibleSubscriptionDiscoveryEvent } from "./subscription-discovery";
import {
  validateProjectVideoProcessingEvent,
  type ProjectVideoProcessingEventName,
  type ProjectVideoProcessingEventProperties,
} from "./project-video-processing";

const POSTHOG_HOST = "https://us.i.posthog.com";

export async function captureSubscriptionActivated(
  distinctId: string,
  properties: AnalyticsEventProperties["subscription_activated"],
  identity?: Pick<User, "app_metadata"> &
    Partial<Pick<User, "user_metadata">>,
): Promise<void> {
  if (identity && isSmokeAccount(identity)) {
    console.info("[analytics] suppressed synthetic business event", {
      event: "subscription_activated",
      ...SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
    });
    return;
  }

  const validation = validateCompatibleSubscriptionDiscoveryEvent(
    "subscription_activated",
    properties,
  );
  if (!validation.success) {
    console.error("[analytics] invalid subscription discovery event", {
      errorId: "ANALYTICS_SUBSCRIPTION_DISCOVERY_INVALID",
      event: "subscription_activated",
      issueCount: validation.issueCount,
    });
    return;
  }

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
        [ANALYTICS_SUBJECT_PROPERTY]: ANALYTICS_HUMAN_SUBJECT,
        ...validation.properties,
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

export async function captureProjectVideoProcessingEvent<
  EventName extends ProjectVideoProcessingEventName,
>(
  distinctId: string,
  event: EventName,
  properties: ProjectVideoProcessingEventProperties[EventName],
  syntheticSmokeAccount = false,
): Promise<void> {
  if (syntheticSmokeAccount) {
    console.info("[analytics] suppressed synthetic business event", {
      event,
      ...SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
    });
    return;
  }

  const validation = validateProjectVideoProcessingEvent(event, properties);
  if (!validation.success) {
    console.error("[analytics] invalid Project Video processing event", {
      errorId: "ANALYTICS_PROJECT_VIDEO_PROCESSING_INVALID",
      event,
      issueCount: validation.issueCount,
    });
    return;
  }

  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (process.env.NODE_ENV !== "production" || !projectToken) return;

  const client = new PostHog(projectToken, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });

  try {
    await client.captureImmediate({
      distinctId,
      event,
      properties: {
        analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
        [ANALYTICS_SUBJECT_PROPERTY]: ANALYTICS_HUMAN_SUBJECT,
        ...validation.properties,
      },
    });
  } catch (err) {
    console.error("[analytics] server capture failed", {
      errorId: "ANALYTICS_SERVER_CAPTURE_FAILED",
      event,
      err,
    });
  } finally {
    try {
      await client.shutdown();
    } catch (err) {
      console.error("[analytics] server shutdown failed", {
        errorId: "ANALYTICS_SERVER_SHUTDOWN_FAILED",
        event,
        err,
      });
    }
  }
}
