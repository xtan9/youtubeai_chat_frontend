"use client";

import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY } from "@/lib/analytics/subscription-discovery";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import type { SubscriptionPresentation } from "@/lib/services/subscription-presentation";
import { ManageSubscriptionButton } from "@/components/paywall/ManageSubscriptionButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type DiscoveryPresentationState =
  | "upgrade_to_pro"
  | "pro_plan"
  | "billing_issue";

function deviceClass(): "mobile" | "desktop" {
  return typeof window.matchMedia === "function" &&
    window.matchMedia(SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY).matches
    ? "mobile"
    : "desktop";
}

function capturePlanBillingDiscovery(
  event: "subscription_discovery_viewed" | "subscription_discovery_clicked",
  presentationState: DiscoveryPresentationState,
) {
  captureAnalyticsEvent(event, {
    source_surface: "plan_and_billing",
    presentation_state: presentationState,
    authentication_state: "registered",
    device_class: deviceClass(),
  });
}

function analyticsState(
  presentation: SubscriptionPresentation,
): DiscoveryPresentationState | null {
  switch (presentation.state) {
    case "free":
      return "upgrade_to_pro";
    case "active_pro":
    case "pro_pending_cancellation":
      return "pro_plan";
    case "billing_issue":
      return "billing_issue";
    default:
      return null;
  }
}

function formatBillingDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function billingCadence(plan: "monthly" | "yearly" | null): string | null {
  if (plan === "monthly") return "Billed monthly";
  if (plan === "yearly") return "Billed yearly";
  return null;
}

function joinedMissingMetadata(fields: readonly string[]): string {
  if (fields.length === 1) return `${fields[0]} is temporarily unavailable.`;
  return `${fields[0]} and ${fields[1]} are temporarily unavailable.`;
}

function UsageMeter({
  label,
  limit,
  used,
}: {
  label: string;
  limit: number;
  used: number;
}) {
  const progress = Math.min(100, Math.max(0, (used / limit) * 100));
  const valueText = `${label}: ${used} of ${limit} used`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body-sm font-medium text-text-primary">
          {label}
        </span>
        <span className="text-body-sm tabular-nums text-text-secondary">
          {used} of {limit} used
        </span>
      </div>
      <Progress
        value={progress}
        aria-label={valueText}
        aria-valuetext={valueText}
      />
    </div>
  );
}

function PlanCard({
  badge,
  children,
  description,
  title,
}: {
  badge: ReactNode;
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card className="overflow-hidden border-border-subtle">
      <CardHeader className="border-b border-border-subtle bg-gradient-brand-soft">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-h4 text-text-primary">{title}</h2>
          {badge}
        </div>
        <p className="max-w-prose text-body-sm text-text-secondary">
          {description}
        </p>
      </CardHeader>
      {children}
    </Card>
  );
}

function StripeOwnershipNote() {
  return (
    <p className="max-w-prose text-body-sm text-text-muted">
      Payment methods, invoices, cancellation, resumption, and plan changes
      open in Stripe.
    </p>
  );
}

function FreePlan({
  caps,
  onUpgrade,
}: {
  caps: {
    summariesUsed: number;
    summariesLimit: number;
    historyUsed?: number;
    historyLimit?: number;
  };
  onUpgrade: () => void;
}) {
  const summaryUsageAvailable =
    Number.isFinite(caps.summariesUsed) &&
    Number.isFinite(caps.summariesLimit) &&
    caps.summariesLimit > 0;
  const historyUsageAvailable =
    typeof caps.historyUsed === "number" &&
    Number.isFinite(caps.historyUsed) &&
    typeof caps.historyLimit === "number" &&
    Number.isFinite(caps.historyLimit) &&
    caps.historyLimit > 0;

  return (
    <PlanCard
      title="Free Plan"
      description="Track the limits included with your registered account."
      badge={<Badge variant="secondary">Current plan</Badge>}
    >
      <CardContent className="space-y-6">
        <section aria-labelledby="free-usage-heading" className="space-y-5">
          <div>
            <h3
              id="free-usage-heading"
              className="text-h6 text-text-primary"
            >
              Usage
            </h3>
            <p className="mt-1 text-body-sm text-text-muted">
              Monthly Summary usage resets at the start of each calendar
              month.
            </p>
          </div>
          {summaryUsageAvailable ? (
            <UsageMeter
              label="Monthly summaries"
              used={caps.summariesUsed}
              limit={caps.summariesLimit}
            />
          ) : (
            <p className="text-body-sm text-text-secondary">
              Monthly Summary usage is temporarily unavailable.
            </p>
          )}
          {historyUsageAvailable ? (
            <UsageMeter
              label="Saved Videos in History"
              used={caps.historyUsed as number}
              limit={caps.historyLimit as number}
            />
          ) : (
            <p className="text-body-sm text-text-secondary">
              History usage is temporarily unavailable.
            </p>
          )}
        </section>
      </CardContent>
      <CardFooter className="border-t border-border-subtle">
        <Button asChild size="lg">
          <Link href="/pricing" onClick={onUpgrade}>
            Upgrade to Pro
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </PlanCard>
  );
}

function ProPlan({
  accessEndsAt,
  onManage,
  plan,
  renewsAt,
}: {
  accessEndsAt?: string | null;
  onManage: () => void;
  plan: "monthly" | "yearly" | null;
  renewsAt?: string | null;
}) {
  const cancellationPending = accessEndsAt !== undefined;
  const cadence = billingCadence(plan);
  const relevantDate = formatBillingDate(
    cancellationPending ? (accessEndsAt ?? null) : (renewsAt ?? null),
  );
  const missingMetadata = [
    cadence ? null : "Billing cadence",
    relevantDate
      ? null
      : cancellationPending
        ? "access-end date"
        : "renewal date",
  ].filter((field): field is string => field !== null);

  return (
    <PlanCard
      title="Pro Plan"
      description="Your paid access and billing details in one place."
      badge={
        <Badge variant={cancellationPending ? "outline" : "secondary"}>
          {cancellationPending ? "Cancellation scheduled" : "Active"}
        </Badge>
      }
    >
      <CardContent className="space-y-6">
        {cadence || relevantDate ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {cadence ? (
              <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
                <dt className="text-caption font-medium uppercase tracking-wide text-text-muted">
                  Billing cadence
                </dt>
                <dd className="mt-1 text-body-md font-semibold text-text-primary">
                  {cadence}
                </dd>
              </div>
            ) : null}
            {relevantDate ? (
              <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
                <dt className="text-caption font-medium uppercase tracking-wide text-text-muted">
                  {cancellationPending ? "Access ends" : "Next renewal"}
                </dt>
                <dd className="mt-1 text-body-md font-semibold text-text-primary">
                  {cancellationPending ? "Cancels on" : "Renews on"}{" "}
                  {relevantDate}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {cancellationPending ? (
          <Alert
            role="status"
            aria-live="polite"
            className="border-accent-warning/40 bg-accent-warning/10"
          >
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Cancellation scheduled</AlertTitle>
            <AlertDescription>
              <p>
                {relevantDate
                  ? `You keep Pro access through ${relevantDate}.`
                  : "You remain on the Pro Plan while your paid access is active."}
              </p>
              <p>You can resume your Subscription in Stripe.</p>
            </AlertDescription>
          </Alert>
        ) : null}

        {missingMetadata.length > 0 ? (
          <Alert role="status" aria-live="polite">
            <AlertTitle>Some billing details are unavailable</AlertTitle>
            <AlertDescription>
              <p>{joinedMissingMetadata(missingMetadata)}</p>
              <p>Open Stripe to review the latest Subscription details.</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <ManageSubscriptionButton onActivate={onManage} />
          <StripeOwnershipNote />
        </div>
      </CardContent>
    </PlanCard>
  );
}

function BillingIssue({
  onResolve,
  plan,
}: {
  onResolve: () => void;
  plan: "monthly" | "yearly" | null;
}) {
  const cadence = billingCadence(plan);

  return (
    <PlanCard
      title="Billing issue"
      description="Your Subscription needs attention before billing can continue normally."
      badge={
        <Badge
          variant="outline"
          className="border-accent-warning/60 text-text-primary"
        >
          Action needed
        </Badge>
      }
    >
      <CardContent className="space-y-5">
        <Alert
          role="status"
          aria-live="polite"
          className="border-accent-warning/40 bg-accent-warning/10"
        >
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Repair your Subscription</AlertTitle>
          <AlertDescription>
            <p>
              Update your payment details securely in Stripe. You do not need
              to purchase another Subscription.
            </p>
          </AlertDescription>
        </Alert>
        {cadence ? (
          <p className="text-body-sm text-text-secondary">{cadence}</p>
        ) : (
          <p className="text-body-sm text-text-secondary">
            Billing cadence is temporarily unavailable.
          </p>
        )}
        <div className="space-y-3">
          <ManageSubscriptionButton
            label="Resolve billing issue in Stripe"
            onActivate={onResolve}
          />
          <StripeOwnershipNote />
        </div>
      </CardContent>
    </PlanCard>
  );
}

function LoadingPlan() {
  return (
    <Card
      role="status"
      aria-label="Loading Plan & Billing"
      aria-busy="true"
      className="border-border-subtle"
    >
      <CardHeader>
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </CardHeader>
      <CardContent className="space-y-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
      <span className="sr-only">Loading Plan & Billing</span>
    </Card>
  );
}

function LookupFailure({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <Card className="border-border-subtle">
      <CardContent>
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Plan details unavailable</AlertTitle>
          <AlertDescription>
            <p>
              Couldn&apos;t load your Plan and Billing details. Your plan has
              not been changed.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={isRetrying}
              onClick={onRetry}
            >
              {isRetrying ? "Trying again…" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export function PlanBillingView() {
  const entitlements = useEntitlements();
  const viewedRef = useRef(false);
  const presentation = entitlements.subscriptionPresentation;
  const discoveryState = analyticsState(presentation);

  useEffect(() => {
    if (viewedRef.current || !discoveryState) return;
    viewedRef.current = true;
    capturePlanBillingDiscovery(
      "subscription_discovery_viewed",
      discoveryState,
    );
  }, [discoveryState]);

  const captureClick = (state: DiscoveryPresentationState) => {
    capturePlanBillingDiscovery("subscription_discovery_clicked", state);
  };

  let planContent: ReactNode;
  switch (presentation.state) {
    case "loading":
      planContent = <LoadingPlan />;
      break;
    case "free":
      planContent = entitlements.data?.caps ? (
        <FreePlan
          caps={entitlements.data.caps}
          onUpgrade={() => captureClick("upgrade_to_pro")}
        />
      ) : (
        <LookupFailure
          isRetrying={entitlements.isFetching}
          onRetry={() => void entitlements.refetch()}
        />
      );
      break;
    case "active_pro":
      planContent = (
        <ProPlan
          plan={presentation.plan}
          renewsAt={presentation.renewsAt}
          onManage={() => captureClick("pro_plan")}
        />
      );
      break;
    case "pro_pending_cancellation":
      planContent = (
        <ProPlan
          plan={presentation.plan}
          accessEndsAt={presentation.accessEndsAt}
          onManage={() => captureClick("pro_plan")}
        />
      );
      break;
    case "billing_issue":
      planContent = (
        <BillingIssue
          plan={presentation.plan}
          onResolve={() => captureClick("billing_issue")}
        />
      );
      break;
    case "anonymous":
    case "lookup_failure":
      planContent = (
        <LookupFailure
          isRetrying={entitlements.isFetching}
          onRetry={() => void entitlements.refetch()}
        />
      );
      break;
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 sm:px-6 md:py-12">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="max-w-2xl space-y-3">
          <p className="text-caption font-medium uppercase tracking-wide text-text-muted">
            Account settings
          </p>
          <h1 className="text-h2 text-text-primary">Plan &amp; Billing</h1>
          <p className="text-body-lg text-text-secondary">
            Understand your current plan and usage, then open Stripe when you
            need to manage billing.
          </p>
        </header>
        {planContent}
      </div>
    </div>
  );
}
