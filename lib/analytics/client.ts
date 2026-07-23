"use client";

import posthog from "posthog-js";
import {
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from "./events";

export function captureAnalyticsEvent<EventName extends AnalyticsEventName>(
  event: EventName,
  properties: AnalyticsEventProperties[EventName],
): void {
  try {
    posthog.capture(event, {
      analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
      ...properties,
    });
  } catch (err) {
    console.error("[analytics] client capture failed", {
      errorId: "ANALYTICS_CLIENT_CAPTURE_FAILED",
      event,
      err,
    });
  }
}

export function resetAnalyticsIdentity(): void {
  try {
    posthog.reset();
  } catch (err) {
    console.error("[analytics] identity reset failed", {
      errorId: "ANALYTICS_IDENTITY_RESET_FAILED",
      err,
    });
  }
}
