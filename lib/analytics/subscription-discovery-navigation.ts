import { normalizeAuthRedirect } from "@/lib/auth/signup-redirect";
import type {
  SubscriptionDiscoveryAuthenticationState,
  SubscriptionDiscoveryPresentationState,
  SubscriptionDiscoverySourceSurface,
} from "@/lib/analytics/subscription-discovery";

export const SUBSCRIPTION_DISCOVERY_SOURCE_QUERY_PARAM =
  "source_surface" as const;

export type ContextualLimitTier = "anon" | "free";

export type ContextualLimitSourceSurface = Extract<
  SubscriptionDiscoverySourceSurface,
  "summary_limit" | "video_chat_limit" | "history_limit"
>;

export type ContextualLimitAction = {
  readonly href: string;
  readonly label: "Sign up free" | "Upgrade to Pro";
  readonly authenticationState: SubscriptionDiscoveryAuthenticationState;
  readonly presentationState: SubscriptionDiscoveryPresentationState;
};

export function buildAttributedPricingHref(
  sourceSurface: SubscriptionDiscoverySourceSurface,
): string {
  const search = new URLSearchParams({
    [SUBSCRIPTION_DISCOVERY_SOURCE_QUERY_PARAM]: sourceSurface,
  });
  return `/pricing?${search.toString()}`;
}

export function buildContextualSignupHref(returnTo: string): string {
  const search = new URLSearchParams({
    redirect_to: normalizeAuthRedirect(returnTo),
  });
  return `/auth/sign-up?${search.toString()}`;
}

export function getContextualLimitAction({
  tier,
  sourceSurface,
  returnTo,
}: {
  readonly tier: ContextualLimitTier;
  readonly sourceSurface: ContextualLimitSourceSurface;
  readonly returnTo: string;
}): ContextualLimitAction {
  if (tier === "anon") {
    return {
      href: buildContextualSignupHref(returnTo),
      label: "Sign up free",
      authenticationState: "anonymous_session",
      presentationState: "pricing",
    };
  }

  return {
    href: buildAttributedPricingHref(sourceSurface),
    label: "Upgrade to Pro",
    authenticationState: "registered",
    presentationState: "upgrade_to_pro",
  };
}
