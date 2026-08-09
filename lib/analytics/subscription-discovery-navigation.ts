import { normalizeAuthRedirect } from "@/lib/auth/signup-redirect";
import type {
  SubscriptionDiscoveryAuthenticationState,
  SubscriptionDiscoveryPresentationState,
  SubscriptionDiscoverySourceSurface,
} from "@/lib/analytics/subscription-discovery";
import { SubscriptionDiscoverySourceSurfaceSchema } from "@/lib/analytics/subscription-discovery";

export const SUBSCRIPTION_DISCOVERY_SOURCE_QUERY_PARAM =
  "source_surface" as const;
export const PRICING_PLAN_QUERY_PARAM = "plan" as const;
export const PRICING_INTENT_QUERY_PARAM = "intent" as const;

export type PricingPlan = "monthly" | "yearly";

export type PricingNavigationContext = {
  readonly sourceSurface: SubscriptionDiscoverySourceSurface;
  readonly selectedPlan: PricingPlan | null;
  readonly checkoutCanceled: boolean;
};

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

export function resolvePricingSourceSurface(
  value: string | null | undefined,
): SubscriptionDiscoverySourceSurface {
  const parsed = SubscriptionDiscoverySourceSurfaceSchema.safeParse(value);
  return parsed.success ? parsed.data : "direct_pricing";
}

export function resolvePricingPlanIntent(
  value: string | null | undefined,
): PricingPlan | null {
  return value === "monthly" || value === "yearly" ? value : null;
}

function firstQueryValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function resolvePricingNavigationContext(
  values: Record<string, string | string[] | undefined>,
): PricingNavigationContext {
  const intent = firstQueryValue(values[PRICING_INTENT_QUERY_PARAM]);
  return {
    sourceSurface: resolvePricingSourceSurface(
      firstQueryValue(values[SUBSCRIPTION_DISCOVERY_SOURCE_QUERY_PARAM]),
    ),
    selectedPlan:
      intent === "upgrade"
        ? resolvePricingPlanIntent(firstQueryValue(values[PRICING_PLAN_QUERY_PARAM]))
        : null,
    checkoutCanceled: firstQueryValue(values.canceled) === "1",
  };
}

export function buildPricingReturnHref({
  plan,
  sourceSurface,
  canceled = false,
}: {
  readonly plan: PricingPlan;
  readonly sourceSurface: SubscriptionDiscoverySourceSurface;
  readonly canceled?: boolean;
}): string {
  const search = new URLSearchParams({
    [PRICING_INTENT_QUERY_PARAM]: "upgrade",
    [PRICING_PLAN_QUERY_PARAM]: plan,
    [SUBSCRIPTION_DISCOVERY_SOURCE_QUERY_PARAM]: sourceSurface,
  });
  if (canceled) search.set("canceled", "1");
  return `/pricing?${search.toString()}`;
}

export function buildPricingSignupHref(args: {
  readonly plan: PricingPlan;
  readonly sourceSurface: SubscriptionDiscoverySourceSurface;
}): string {
  return buildContextualSignupHref(buildPricingReturnHref(args));
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
