"use client";

import posthog from "posthog-js";
import {
  ANALYTICS_SCHEMA_VERSION,
  isAnalyticsEventName,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from "./events";
import {
  isSubscriptionDiscoveryEventName,
  validateCompatibleSubscriptionDiscoveryEvent,
} from "./subscription-discovery";
import {
  isProjectLimitEventName,
  validateProjectLimitEvent,
} from "./project-limits";
import {
  isProjectSearchEventName,
  validateProjectSearchEvent,
} from "./project-search";
import {
  isProjectVideoProcessingEventName,
  validateProjectVideoProcessingEvent,
} from "./project-video-processing";
import {
  isProjectGroundedAnswerEventName,
  validateProjectGroundedAnswerEvent,
} from "./project-grounded-answer";
import {
  isProjectArtifactEventName,
  validateProjectArtifactEvent,
} from "./project-artifacts";

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
    if (!isAnalyticsEventName(event)) {
      console.error("[analytics] invalid event name", {
        errorId: "ANALYTICS_EVENT_NAME_INVALID",
        event,
      });
      return;
    }

    let validatedProperties = properties;
    if (isSubscriptionDiscoveryEventName(event)) {
      const validation = validateCompatibleSubscriptionDiscoveryEvent(
        event,
        properties,
      );
      if (!validation.success) {
        console.error("[analytics] invalid subscription discovery event", {
          errorId: "ANALYTICS_SUBSCRIPTION_DISCOVERY_INVALID",
          event,
          issueCount: validation.issueCount,
        });
        return;
      }
      validatedProperties = validation.properties as typeof properties;
    }
    if (isProjectLimitEventName(event)) {
      const validation = validateProjectLimitEvent(event, properties);
      if (!validation.success) {
        console.error("[analytics] invalid Project limit event", {
          errorId: "ANALYTICS_PROJECT_LIMIT_INVALID",
          event,
          issueCount: validation.issueCount,
        });
        return;
      }
      validatedProperties = validation.properties as typeof properties;
    }
    if (isProjectSearchEventName(event)) {
      const validation = validateProjectSearchEvent(event, properties);
      if (!validation.success) {
        console.error("[analytics] invalid Project Search event", {
          errorId: "ANALYTICS_PROJECT_SEARCH_INVALID",
          event,
          issueCount: validation.issueCount,
        });
        return;
      }
      validatedProperties = validation.properties as typeof properties;
    }
    if (isProjectVideoProcessingEventName(event)) {
      const validation = validateProjectVideoProcessingEvent(event, properties);
      if (!validation.success) {
        console.error("[analytics] invalid Project Video processing event", {
          errorId: "ANALYTICS_PROJECT_VIDEO_PROCESSING_INVALID",
          event,
          issueCount: validation.issueCount,
        });
        return;
      }
      validatedProperties = validation.properties as typeof properties;
    }
    if (isProjectGroundedAnswerEventName(event)) {
      const validation = validateProjectGroundedAnswerEvent(event, properties);
      if (!validation.success) {
        console.error("[analytics] invalid Project Grounded Answer event", {
          errorId: "ANALYTICS_PROJECT_GROUNDED_ANSWER_INVALID",
          event,
          issueCount: validation.issueCount,
        });
        return;
      }
      validatedProperties = validation.properties as typeof properties;
    }
    if (isProjectArtifactEventName(event)) {
      const validation = validateProjectArtifactEvent(event, properties);
      if (!validation.success) {
        console.error("[analytics] invalid Project Artifact event", {
          errorId: "ANALYTICS_PROJECT_ARTIFACT_INVALID",
          event,
          issueCount: validation.issueCount,
        });
        return;
      }
      validatedProperties = validation.properties as typeof properties;
    }

    posthog.capture(event, {
      analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
      ...validatedProperties,
    });
  } catch (err) {
    console.error("[analytics] client capture failed", {
      errorId: "ANALYTICS_CLIENT_CAPTURE_FAILED",
      event,
      err,
    });
  }
}
