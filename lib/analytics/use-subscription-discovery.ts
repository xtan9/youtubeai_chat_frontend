"use client";

import { useCallback, useEffect, useRef } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY,
  type SubscriptionDiscoveryAuthenticationState,
  type SubscriptionDiscoveryDeviceClass,
  type SubscriptionDiscoveryPresentationState,
  type SubscriptionDiscoverySourceSurface,
} from "@/lib/analytics/subscription-discovery";

type SubscriptionDiscoveryInteraction = {
  readonly sourceSurface: SubscriptionDiscoverySourceSurface;
  readonly presentationState: SubscriptionDiscoveryPresentationState;
  readonly authenticationState: SubscriptionDiscoveryAuthenticationState;
  readonly enabled?: boolean;
};

function getDeviceClass(): SubscriptionDiscoveryDeviceClass {
  return typeof window !== "undefined" &&
    window.matchMedia(SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY).matches
    ? "mobile"
    : "desktop";
}

/**
 * Reports a governed Subscription-discovery surface at the interaction
 * boundary. Views fire once per mounted, truthfully resolved surface; clicks
 * read the responsive presentation again so the event matches what was
 * visible when the Learner activated the control.
 */
export function useSubscriptionDiscovery({
  sourceSurface,
  presentationState,
  authenticationState,
  enabled = true,
}: SubscriptionDiscoveryInteraction) {
  const viewedRef = useRef(false);

  useEffect(() => {
    if (!enabled || viewedRef.current) return;
    viewedRef.current = true;
    captureAnalyticsEvent("subscription_discovery_viewed", {
      source_surface: sourceSurface,
      presentation_state: presentationState,
      authentication_state: authenticationState,
      device_class: getDeviceClass(),
    });
  }, [
    authenticationState,
    enabled,
    presentationState,
    sourceSurface,
  ]);

  const captureClick = useCallback(() => {
    if (!enabled) return;
    captureAnalyticsEvent("subscription_discovery_clicked", {
      source_surface: sourceSurface,
      presentation_state: presentationState,
      authentication_state: authenticationState,
      device_class: getDeviceClass(),
    });
  }, [
    authenticationState,
    enabled,
    presentationState,
    sourceSurface,
  ]);

  return { captureClick };
}
