"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import {
  SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY,
  SubscriptionCheckoutFailureCategorySchema,
  type SubscriptionCheckoutFailureCategory,
  type SubscriptionDiscoveryAuthenticationState,
  type SubscriptionDiscoveryDeviceClass,
  type SubscriptionDiscoveryPresentationState,
} from "@/lib/analytics/subscription-discovery";
import {
  buildPricingSignupHref,
  type PricingNavigationContext,
} from "@/lib/analytics/subscription-discovery-navigation";
import { useUser } from "@/lib/contexts/user-context";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import type { SubscriptionPresentation } from "@/lib/services/subscription-presentation";
import {
  PricingFreeCard,
  PricingProCard,
  type PricingCardFailure,
  type PricingPlan,
} from "./PricingCard";

export type PricingContext = PricingNavigationContext;

type CheckoutFailure = {
  readonly plan: PricingPlan;
  readonly category: SubscriptionCheckoutFailureCategory;
  readonly deviceClass: SubscriptionDiscoveryDeviceClass;
  readonly httpStatus?: number;
};

function analyticsPresentationState(
  presentation: SubscriptionPresentation,
): SubscriptionDiscoveryPresentationState | null {
  switch (presentation.state) {
    case "anonymous":
      return "pricing";
    case "free":
      return "upgrade_to_pro";
    case "active_pro":
    case "pro_pending_cancellation":
      return "pro_plan";
    case "billing_issue":
      return "billing_issue";
    case "lookup_failure":
      return "plans";
    case "loading":
      return null;
  }
}

function analyticsAuthenticationState({
  presentation,
  user,
  isUserLoading,
}: {
  readonly presentation: SubscriptionPresentation;
  readonly user: { readonly is_anonymous?: boolean } | null;
  readonly isUserLoading: boolean;
}): SubscriptionDiscoveryAuthenticationState | null {
  if (presentation.state === "loading") return null;
  if (
    presentation.state === "free" ||
    presentation.state === "active_pro" ||
    presentation.state === "pro_pending_cancellation" ||
    presentation.state === "billing_issue"
  ) {
    return "registered";
  }
  if (isUserLoading) return null;
  if (presentation.state === "lookup_failure" && user && user.is_anonymous !== true) {
    return "registered";
  }
  return user?.is_anonymous ? "anonymous_session" : "logged_out";
}

function currentDeviceClass(): SubscriptionDiscoveryDeviceClass {
  return typeof window.matchMedia === "function" &&
    window.matchMedia(SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY).matches
    ? "mobile"
    : "desktop";
}

function createCheckoutAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pricing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function checkoutFailureCategory(
  status: number,
  code: unknown,
): SubscriptionCheckoutFailureCategory {
  const parsedCode = SubscriptionCheckoutFailureCategorySchema.safeParse(code);
  if (parsedCode.success) return parsedCode.data;
  if (status === 401) return "authentication_required";
  if (status === 409) return "subscription_ineligible";
  if (status === 503) return "service_unavailable";
  return "unknown";
}

function isStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

function failureCopy(failure: CheckoutFailure): {
  readonly title: string;
  readonly description: string;
} {
  switch (failure.category) {
    case "authentication_required":
      return {
        title: "Your account session changed",
        description: "Refresh your account status before continuing to checkout.",
      };
    case "subscription_ineligible":
      return {
        title: "You already have a Subscription",
        description:
          "Open Plan & Billing to manage or repair your existing Subscription.",
      };
    case "plan_unavailable":
      return {
        title: "This billing option is unavailable",
        description: "Try again later or choose the other billing cadence.",
      };
    case "service_unavailable":
      return {
        title: "Checkout is temporarily unavailable",
        description: "Your plan has not changed. Please try again.",
      };
    case "invalid_response":
      return {
        title: "Checkout couldn't start safely",
        description: "No charge was made. Please try again.",
      };
    case "network_error":
      return {
        title: "Checkout couldn't connect",
        description: "Check your connection, then try again.",
      };
    case "unknown":
      return {
        title: "Checkout couldn't start",
        description: "No charge was made. Please try again.",
      };
  }
}

function PricingStateNotice({
  presentation,
  context,
  isRetrying,
  onRetry,
}: {
  readonly presentation: SubscriptionPresentation;
  readonly context: PricingContext;
  readonly isRetrying: boolean;
  readonly onRetry: () => void;
}) {
  switch (presentation.state) {
    case "active_pro":
      return (
        <div
          role="status"
          className="mt-6 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-body-sm text-text-secondary"
        >
          Your Pro Plan is active. Use Plan &amp; Billing for billing changes.
        </div>
      );
    case "pro_pending_cancellation":
      return (
        <div
          role="status"
          className="mt-6 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-body-sm text-text-secondary"
        >
          Your Pro Plan remains active while cancellation is pending. Review
          the access end date in Plan &amp; Billing.
        </div>
      );
    case "billing_issue":
      return (
        <Alert className="mt-6" variant="destructive">
          <AlertTitle>Your Subscription needs attention</AlertTitle>
          <AlertDescription>
            Repair your existing Subscription in Plan &amp; Billing instead of
            starting another checkout.
          </AlertDescription>
        </Alert>
      );
    case "lookup_failure":
      return (
        <Alert className="mt-6" variant="destructive">
          <AlertTitle>Plan status unavailable</AlertTitle>
          <AlertDescription>
            <p>
              Couldn&apos;t safely determine which action applies. No checkout
              is available until your status loads.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={isRetrying}
              onClick={onRetry}
            >
              {isRetrying ? "Trying again…" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      );
    case "free":
      if (context.checkoutCanceled) {
        return (
          <div
            role="status"
            className="mt-6 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-body-sm text-text-secondary"
          >
            Checkout was canceled. No charge was made; choose a plan whenever
            you&apos;re ready.
          </div>
        );
      }
      if (context.selectedPlan) {
        return (
          <div
            role="status"
            className="mt-6 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-body-sm text-text-secondary"
          >
            You&apos;re signed in. Continue with Pro {context.selectedPlan} when
            you&apos;re ready.
          </div>
        );
      }
      return null;
    case "anonymous":
    case "loading":
      return null;
  }
}

export function PricingPlans({
  initialContext,
}: {
  readonly initialContext: PricingContext;
}) {
  const router = useRouter();
  const { user, isLoading: isUserLoading } = useUser();
  const entitlements = useEntitlements();
  // A cached entitlement response can be a valid Free snapshot while a
  // different tab has just activated Pro (or moved it into a billing issue).
  // Force one fresh read before exposing any Free checkout action so that
  // stale cache data cannot flash an incorrect CTA.
  const hadCachedEntitlements = entitlements.data !== undefined;
  const hadCachedEntitlementsRef = useRef(hadCachedEntitlements);
  const initialRefetch = entitlements.refetch;
  const refreshStarted = useRef(false);
  const [statusFresh, setStatusFresh] = useState(
    !hadCachedEntitlements || typeof initialRefetch !== "function",
  );
  useEffect(() => {
    if (!hadCachedEntitlementsRef.current || refreshStarted.current) return;
    refreshStarted.current = true;
    const refetch = entitlements.refetch;
    if (typeof refetch !== "function") {
      return;
    }
    let active = true;
    void Promise.resolve(refetch()).then((result: unknown) => {
      if (!active) return;
      const queryResult = result as { readonly data?: unknown; readonly isError?: boolean };
      // React Query resolves refetches with `isError` rather than rejecting;
      // only reveal the lookup-failure state after that definitive response.
      // A rejected/ambiguous refresh keeps cached actions neutral.
      if (queryResult.isError === true || queryResult.data !== undefined) {
        setStatusFresh(true);
      }
    });
    return () => {
      active = false;
    };
  }, [entitlements.refetch]);

  const presentation: SubscriptionPresentation = statusFresh
    ? entitlements.subscriptionPresentation
    : { state: "loading" };
  const pricingContext = initialContext;
  const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
  const [checkoutFailure, setCheckoutFailure] =
    useState<CheckoutFailure | null>(null);
  const checkoutAttemptIds = useRef<Partial<Record<PricingPlan, string>>>({});
  const viewedRef = useRef(false);
  const presentationState = analyticsPresentationState(presentation);
  const authenticationState = analyticsAuthenticationState({
    presentation,
    user,
    isUserLoading,
  });

  useEffect(() => {
    if (
      viewedRef.current ||
      !presentationState ||
      !authenticationState
    ) {
      return;
    }
    viewedRef.current = true;
    captureAnalyticsEvent("pricing_viewed", {
      source_surface: pricingContext.sourceSurface,
      presentation_state: presentationState,
      authentication_state: authenticationState,
      device_class: currentDeviceClass(),
    });
  }, [
    authenticationState,
    presentationState,
    pricingContext.sourceSurface,
  ]);

  const captureCheckoutFailure = (failure: CheckoutFailure) => {
    if (!presentationState || !authenticationState) return;
    // A 409 proves that the server found an existing Subscription, but the
    // cached client presentation may still say Free. Use the neutral Plans
    // state until entitlements refresh instead of attributing management
    // traffic to a stale upgrade_to_pro impression.
    const failurePresentationState =
      failure.category === "subscription_ineligible"
        ? "plans"
        : presentationState;
    captureAnalyticsEvent("checkout_failed", {
      account_type: "free",
      source_surface: pricingContext.sourceSurface,
      presentation_state: failurePresentationState,
      authentication_state: authenticationState,
      device_class: failure.deviceClass,
      plan: failure.plan,
      billing_interval: failure.plan,
      failure_category: failure.category,
      ...(failure.httpStatus === undefined
        ? {}
        : { http_status: failure.httpStatus }),
    });
  };

  const choosePlan = async (plan: PricingPlan) => {
    if (
      presentation.state === "loading" ||
      presentation.state === "lookup_failure" ||
      !presentationState ||
      !authenticationState
    ) {
      return;
    }

    const deviceClass = currentDeviceClass();
    const planChoicePresentationState =
      checkoutFailure?.category === "subscription_ineligible"
        ? "plans"
        : presentationState;
    const capturePlanChoice = () => {
      captureAnalyticsEvent("plan_choice_attempted", {
        source_surface: pricingContext.sourceSurface,
        presentation_state: planChoicePresentationState,
        authentication_state: authenticationState,
        device_class: deviceClass,
        plan,
        billing_interval: plan,
      });
    };

    // A trusted server-side ineligible response means this account already
    // owns a Subscription, even if the cached presentation still says Free.
    // Route every remaining card action to management instead of allowing a
    // second checkout attempt while entitlements refresh.
    if (checkoutFailure?.category === "subscription_ineligible") {
      capturePlanChoice();
      router.push("/account/billing");
      return;
    }

    if (presentation.state === "anonymous") {
      capturePlanChoice();
      router.push(
        buildPricingSignupHref({
          plan,
          sourceSurface: pricingContext.sourceSurface,
        }),
      );
      return;
    }
    if (
      presentation.state === "active_pro" ||
      presentation.state === "pro_pending_cancellation" ||
      presentation.state === "billing_issue"
    ) {
      capturePlanChoice();
      router.push("/account/billing");
      return;
    }

    if (presentation.state !== "free") return;

    const attemptId =
      checkoutAttemptIds.current[plan] ?? createCheckoutAttemptId();
    checkoutAttemptIds.current[plan] = attemptId;
    capturePlanChoice();

    setCheckoutFailure(null);
    setPendingPlan(plan);
    let response: Response;
    try {
      response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attemptId,
        },
        body: JSON.stringify({
          plan,
          source_surface: pricingContext.sourceSurface,
          device_class: deviceClass,
          attempt_id: attemptId,
        }),
      });
    } catch (error) {
      console.error("[pricing] checkout request failed", {
        errorId: "PRICING_CHECKOUT_NETWORK_ERROR",
        error,
      });
      const failure: CheckoutFailure = {
        plan,
        category: "network_error",
        deviceClass,
      };
      captureCheckoutFailure(failure);
      setCheckoutFailure(failure);
      setPendingPlan(null);
      return;
    }

    let body: { readonly url?: unknown; readonly code?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // A malformed successful response is handled as invalid below. Error
      // responses still retain their status-based category.
    }

    if (!response.ok) {
      const failure: CheckoutFailure = {
        plan,
        category: checkoutFailureCategory(response.status, body.code),
        deviceClass,
        httpStatus: response.status,
      };
      console.error("[pricing] checkout rejected", {
        errorId: "PRICING_CHECKOUT_REJECTED",
        status: response.status,
        category: failure.category,
      });
      captureCheckoutFailure(failure);
      setCheckoutFailure(failure);
      setPendingPlan(null);
      // A received 5xx can still mean Stripe accepted the request before the
      // server lost its response. Retain the key so a retry remains safely
      // idempotent. Rotate only after a definitive client-side rejection.
      if (response.status >= 400 && response.status < 500) {
        delete checkoutAttemptIds.current[plan];
      }
      return;
    }

    if (!isStripeCheckoutUrl(body.url)) {
      const failure: CheckoutFailure = {
        plan,
        category: "invalid_response",
        deviceClass,
      };
      console.error("[pricing] checkout response had no safe destination", {
        errorId: "PRICING_CHECKOUT_INVALID_RESPONSE",
      });
      captureCheckoutFailure(failure);
      setCheckoutFailure(failure);
      setPendingPlan(null);
      // A malformed 2xx response is ambiguous: the server may have created
      // the Stripe session before serializing an unsafe destination. Retain
      // the attempt key so retrying cannot create a duplicate session.
      return;
    }

    delete checkoutAttemptIds.current[plan];
    captureAnalyticsEvent("checkout_started", {
      account_type: "free",
      source_surface: pricingContext.sourceSurface,
      presentation_state: presentationState,
      authentication_state: authenticationState,
      device_class: deviceClass,
      plan,
      billing_interval: plan,
    });
    window.location.assign(body.url);
  };

  const actionLabel = (plan: PricingPlan): string => {
    if (!statusFresh) return "Loading account status";
    if (presentation.state === "loading") return `Loading ${plan} pricing`;
    if (authenticationState === null) return "Loading account status";
    if (presentation.state === "lookup_failure") return "Plan status unavailable";
    if (checkoutFailure?.category === "subscription_ineligible") {
      return "Open Plan & Billing";
    }
    if (
      presentation.state === "active_pro" ||
      presentation.state === "pro_pending_cancellation"
    ) {
      return "Open Plan & Billing";
    }
    if (presentation.state === "billing_issue") {
      return "Resolve in Plan & Billing";
    }
    if (pendingPlan === plan) return "Redirecting…";
    if (pendingPlan) return "Checkout in progress";
    if (
      presentation.state === "free" &&
      pricingContext.selectedPlan === plan
    ) {
      return `Continue with ${plan}`;
    }
    return `Choose ${plan}`;
  };

  const failureForPlan = (plan: PricingPlan): PricingCardFailure | undefined => {
    if (!checkoutFailure || checkoutFailure.plan !== plan) return undefined;
    const copy = failureCopy(checkoutFailure);
    if (checkoutFailure.category === "subscription_ineligible") {
      return {
        ...copy,
        actionLabel: "Open Plan & Billing",
        onAction: () => void choosePlan(plan),
      };
    }
    if (checkoutFailure.category === "authentication_required") {
      return {
        ...copy,
        actionLabel: "Refresh account status",
        onAction: () => void entitlements.refetch(),
      };
    }
    return {
      ...copy,
      actionLabel: `Try ${plan} again`,
      onAction: () => void choosePlan(plan),
    };
  };

  const actionsDisabled =
    presentation.state === "loading" ||
    presentation.state === "lookup_failure" ||
    authenticationState === null ||
    pendingPlan !== null;

  return (
    <>
      <PricingStateNotice
        presentation={presentation}
        context={pricingContext}
        isRetrying={entitlements.isFetching}
        onRetry={() => void entitlements.refetch()}
      />
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <PricingFreeCard />
        {(["monthly", "yearly"] as const).map((plan) => (
          <PricingProCard
            key={plan}
            plan={plan}
            actionLabel={actionLabel(plan)}
            onAction={() => void choosePlan(plan)}
            actionDisabled={actionsDisabled}
            actionPending={pendingPlan === plan}
            currentPlan={
              (presentation.state === "active_pro" ||
                presentation.state === "pro_pending_cancellation") &&
              presentation.plan === plan
            }
            selectedIntent={
              presentation.state === "free" &&
              pricingContext.selectedPlan === plan
            }
            failure={failureForPlan(plan)}
          />
        ))}
      </div>
    </>
  );
}
