"use client";

import posthog from "posthog-js";
import {
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from "./events";

let businessAnalyticsCaptureSuppressed = false;

/** Set by the Auth/PostHog identity boundary when the current person is synthetic. */
export function setBusinessAnalyticsCaptureSuppressed(suppressed: boolean): void {
  businessAnalyticsCaptureSuppressed = suppressed;
}

export function captureAnalyticsEvent<EventName extends AnalyticsEventName>(
  event: EventName,
  properties: AnalyticsEventProperties[EventName],
): void {
  if (businessAnalyticsCaptureSuppressed) return;

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
