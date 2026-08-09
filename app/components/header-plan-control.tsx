"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  SubscriptionDiscoveryAuthenticationState,
  SubscriptionDiscoveryPresentationState,
} from "@/lib/analytics/subscription-discovery";
import { buildAttributedPricingHref } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import type { SubscriptionPresentation } from "@/lib/services/subscription-presentation";
import { cn } from "@/lib/utils";

export type HeaderPlanIdentity =
  | { readonly state: "auth_loading" }
  | { readonly state: "auth_failure" }
  | { readonly state: "logged_out" }
  | { readonly state: "anonymous_session" }
  | {
      readonly state: "registered";
      readonly subscriptionPresentation: SubscriptionPresentation;
    };

export type HeaderPlanControlModel =
  | { readonly state: "loading" }
  | {
      readonly state: "resolved";
      readonly label:
        | "Pricing"
        | "Upgrade to Pro"
        | "Pro Plan"
        | "Billing issue"
        | "Plans";
      readonly href: string;
      readonly presentationState: SubscriptionDiscoveryPresentationState;
      readonly authenticationState: SubscriptionDiscoveryAuthenticationState;
      readonly analyticsEnabled: boolean;
      readonly tone:
        | "navigation"
        | "upgrade"
        | "status"
        | "attention"
        | "neutral";
    };

const PRICING_HREF = buildAttributedPricingHref("global_header");

function plansFallback(
  authenticationState: SubscriptionDiscoveryAuthenticationState,
  analyticsEnabled: boolean,
): HeaderPlanControlModel {
  return {
    state: "resolved",
    label: "Plans",
    href: PRICING_HREF,
    presentationState: "plans",
    authenticationState,
    analyticsEnabled,
    tone: "neutral",
  };
}

export function resolveHeaderPlanControl(
  identity: HeaderPlanIdentity,
): HeaderPlanControlModel {
  switch (identity.state) {
    case "auth_loading":
      return { state: "loading" };
    case "auth_failure":
      return plansFallback("logged_out", false);
    case "logged_out":
    case "anonymous_session":
      return {
        state: "resolved",
        label: "Pricing",
        href: PRICING_HREF,
        presentationState: "pricing",
        authenticationState: identity.state,
        analyticsEnabled: true,
        tone: "navigation",
      };
    case "registered":
      break;
  }

  switch (identity.subscriptionPresentation.state) {
    case "loading":
      return { state: "loading" };
    case "lookup_failure":
    case "anonymous":
      return plansFallback("registered", true);
    case "free":
      return {
        state: "resolved",
        label: "Upgrade to Pro",
        href: PRICING_HREF,
        presentationState: "upgrade_to_pro",
        authenticationState: "registered",
        analyticsEnabled: true,
        tone: "upgrade",
      };
    case "active_pro":
    case "pro_pending_cancellation":
      return {
        state: "resolved",
        label: "Pro Plan",
        href: "/account/billing",
        presentationState: "pro_plan",
        authenticationState: "registered",
        analyticsEnabled: true,
        tone: "status",
      };
    case "billing_issue":
      return {
        state: "resolved",
        label: "Billing issue",
        href: "/account/billing",
        presentationState: "billing_issue",
        authenticationState: "registered",
        analyticsEnabled: true,
        tone: "attention",
      };
  }
}

type ResolvedHeaderPlanControl = Extract<
  HeaderPlanControlModel,
  { state: "resolved" }
>;

const toneClasses: Record<ResolvedHeaderPlanControl["tone"], string> = {
  navigation:
    "text-text-secondary shadow-none hover:bg-state-hover hover:text-text-primary",
  upgrade:
    "bg-gradient-brand-primary text-text-inverse hover:bg-gradient-brand-primary-hover",
  status:
    "border border-border-subtle bg-surface-sunken text-text-primary shadow-none hover:bg-state-hover",
  attention:
    "border-accent-warning/60 bg-accent-warning/10 text-text-primary shadow-none hover:bg-accent-warning/20",
  neutral:
    "border-border-default bg-surface-base text-text-primary shadow-none hover:bg-state-hover",
};

function ResolvedPlanControl({
  model,
}: {
  readonly model: ResolvedHeaderPlanControl;
}) {
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface: "global_header",
    presentationState: model.presentationState,
    authenticationState: model.authenticationState,
    enabled: model.analyticsEnabled,
  });
  const variant =
    model.tone === "navigation"
      ? "ghost"
      : model.tone === "upgrade"
        ? "default"
        : model.tone === "status"
          ? "secondary"
          : "outline";

  return (
    <div className="w-28 shrink-0">
      <Button
        asChild
        size="sm"
        variant={variant}
        className={cn("w-full rounded-full", toneClasses[model.tone])}
      >
        <Link href={model.href} onClick={captureClick}>
          {model.label}
        </Link>
      </Button>
    </div>
  );
}

function LoadingPlanControl() {
  return (
    <div
      role="status"
      aria-label="Loading plan status"
      aria-busy="true"
      className="w-28 shrink-0"
    >
      <Skeleton className="h-8 w-full rounded-full" />
    </div>
  );
}

function PlanControlFromModel({
  model,
}: {
  readonly model: HeaderPlanControlModel;
}) {
  return model.state === "loading" ? (
    <LoadingPlanControl />
  ) : (
    <ResolvedPlanControl model={model} />
  );
}

function RegisteredPlanControl() {
  const { subscriptionPresentation } = useEntitlements();
  return (
    <PlanControlFromModel
      model={resolveHeaderPlanControl({
        state: "registered",
        subscriptionPresentation,
      })}
    />
  );
}

export function HeaderPlanControl({
  authError,
  isAuthLoading,
  user,
}: {
  readonly authError: boolean;
  readonly isAuthLoading: boolean;
  readonly user: { readonly is_anonymous?: boolean } | null;
}) {
  if (isAuthLoading) {
    return (
      <PlanControlFromModel
        model={resolveHeaderPlanControl({ state: "auth_loading" })}
      />
    );
  }

  if (authError) {
    return (
      <PlanControlFromModel
        model={resolveHeaderPlanControl({ state: "auth_failure" })}
      />
    );
  }

  if (!user) {
    return (
      <PlanControlFromModel
        model={resolveHeaderPlanControl({ state: "logged_out" })}
      />
    );
  }

  if (user.is_anonymous) {
    return (
      <PlanControlFromModel
        model={resolveHeaderPlanControl({ state: "anonymous_session" })}
      />
    );
  }

  return <RegisteredPlanControl />;
}
