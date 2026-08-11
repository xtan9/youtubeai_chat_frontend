import { createHash } from "node:crypto";
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
import {
  validateProjectActivityEvent,
  type ProjectActivityEventName,
  type ProjectActivityEventProperties,
} from "./project-activity";
import { validateAnonymousTrialEvent } from "./anonymous-trial";

const POSTHOG_HOST = "https://us.i.posthog.com";

export type SubscriptionActivationCaptureStatus = "sent" | "skipped" | "failed";
export type ProjectActivityCaptureStatus = "sent" | "skipped" | "failed";

export async function captureAnonymousTrialConversion(
  distinctId: string,
  registrationMethod: "email" | "google",
  identity: Pick<User, "app_metadata"> & Partial<Pick<User, "user_metadata">>,
): Promise<ProjectActivityCaptureStatus> {
  if (isSmokeAccount(identity)) return "skipped";
  const properties = {
    source_surface: "hero_demo" as const,
    registration_method: registrationMethod,
  };
  if (
    !validateAnonymousTrialEvent("anonymous_trial_converted", properties)
      .success
  ) {
    return "skipped";
  }
  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (process.env.NODE_ENV !== "production" || !projectToken) return "skipped";
  const client = new PostHog(projectToken, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
  try {
    await client.captureImmediate({
      distinctId,
      event: "anonymous_trial_converted",
      properties: {
        analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
        [ANALYTICS_SUBJECT_PROPERTY]: ANALYTICS_HUMAN_SUBJECT,
        ...properties,
      },
    });
    return "sent";
  } catch (err) {
    console.error("[analytics] server capture failed", {
      errorId: "ANALYTICS_SERVER_CAPTURE_FAILED",
      event: "anonymous_trial_converted",
      err,
    });
    return "failed";
  } finally {
    await client.shutdown().catch(() => undefined);
  }
}

type SubscriptionActivationCaptureOptions = {
  /** Stable, non-identifying outbox marker used as the PostHog event UUID. */
  readonly activationMarker?: string;
};

function analyticsEventUuid(marker: string): string {
  const hex = createHash("sha256").update(marker).digest("hex").slice(0, 32).split("");
  // Keep the deterministic digest in RFC 4122 UUID shape without exposing the
  // user or subscription identifiers contained in the durable marker.
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "8", 16) % 4] ?? "8";
  return [
    hex.slice(0, 8).join(""),
    hex.slice(8, 12).join(""),
    hex.slice(12, 16).join(""),
    hex.slice(16, 20).join(""),
    hex.slice(20).join(""),
  ].join("-");
}

export async function captureSubscriptionActivated(
  distinctId: string,
  properties: AnalyticsEventProperties["subscription_activated"],
  identity?: Pick<User, "app_metadata"> &
    Partial<Pick<User, "user_metadata">>,
  options?: SubscriptionActivationCaptureOptions,
): Promise<SubscriptionActivationCaptureStatus> {
  if (identity && isSmokeAccount(identity)) {
    console.info("[analytics] suppressed synthetic business event", {
      event: "subscription_activated",
      ...SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
    });
    return "skipped";
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
    // Invalid metadata is a non-retryable producer defect; do not hold a
    // webhook delivery open forever when the sink itself was never reached.
    return "skipped";
  }

  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (process.env.NODE_ENV !== "production" || !projectToken) {
    return "skipped";
  }

  const client = new PostHog(projectToken, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });

  try {
    const event = {
      distinctId,
      event: "subscription_activated",
      properties: {
        analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
        [ANALYTICS_SUBJECT_PROPERTY]: ANALYTICS_HUMAN_SUBJECT,
        ...validation.properties,
      },
      ...(options?.activationMarker
        ? { uuid: analyticsEventUuid(options.activationMarker) }
        : {}),
    };
    await client.captureImmediate(event);
    return "sent";
  } catch (err) {
    console.error("[analytics] server capture failed", {
      errorId: "ANALYTICS_SERVER_CAPTURE_FAILED",
      event: "subscription_activated",
      err,
    });
    return "failed";
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

export async function captureProjectActivityEvent<
  EventName extends ProjectActivityEventName,
>(
  distinctId: string,
  event: EventName,
  properties: ProjectActivityEventProperties[EventName],
  syntheticSmokeAccount = false,
  eventMarker?: string,
  eventOccurredAt?: string,
): Promise<void> {
  await captureProjectActivityEventWithStatus(
    distinctId,
    event,
    properties,
    syntheticSmokeAccount,
    eventMarker,
    eventOccurredAt,
  );
}

export async function captureProjectActivityEventWithStatus<
  EventName extends ProjectActivityEventName,
>(
  distinctId: string,
  event: EventName,
  properties: ProjectActivityEventProperties[EventName],
  syntheticSmokeAccount = false,
  eventMarker?: string,
  eventOccurredAt?: string,
): Promise<ProjectActivityCaptureStatus> {
  if (syntheticSmokeAccount) {
    console.info("[analytics] suppressed synthetic business event", {
      event,
      ...SMOKE_ACCOUNT_ANALYTICS_PROPERTIES,
    });
    return "skipped";
  }

  const validation = validateProjectActivityEvent(event, properties);
  if (!validation.success) {
    console.error("[analytics] invalid Project activity event", {
      errorId: "ANALYTICS_PROJECT_ACTIVITY_INVALID",
      event,
      issueCount: validation.issueCount,
    });
    return "skipped";
  }

  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (process.env.NODE_ENV !== "production" || !projectToken) return "skipped";

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
      ...(eventMarker ? { uuid: analyticsEventUuid(eventMarker) } : {}),
      ...(eventOccurredAt ? { timestamp: new Date(eventOccurredAt) } : {}),
    });
    return "sent";
  } catch (err) {
    console.error("[analytics] server capture failed", {
      errorId: "ANALYTICS_SERVER_CAPTURE_FAILED",
      event,
      err,
    });
    return "failed";
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
