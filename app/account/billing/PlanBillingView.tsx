"use client";

import {useLocale, useTranslations} from "next-intl";
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

function formatBillingDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function billingCadence(plan: "monthly" | "yearly" | null, t: ReturnType<typeof useTranslations<"pricing">>): string | null {
  if (plan === "monthly") return t("billedMonthly");
  if (plan === "yearly") return t("billedYearly");
  return null;
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
  const t = useTranslations("pricing");
  const progress = Math.min(100, Math.max(0, (used / limit) * 100));
  const usage = t("usageValue", {used, limit});
  const valueText = t("usageLabel", {label, usage});

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body-sm font-medium text-text-primary">
          {label}
        </span>
        <span className="text-body-sm tabular-nums text-text-secondary">
          {usage}
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
  const t = useTranslations("pricing");
  return (
    <p className="max-w-prose text-body-sm text-text-muted">{t("stripeNote")}</p>
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
    projectsUsed: number;
    projectsLimit: number;
  };
  onUpgrade: () => void;
}) {
  const t = useTranslations("pricing");
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
  const projectUsageAvailable =
    Number.isFinite(caps.projectsUsed) &&
    Number.isFinite(caps.projectsLimit) &&
    caps.projectsLimit > 0;

  return (
    <PlanCard
      title={t("freePlan")}
      description={t("limits")}
      badge={<Badge variant="secondary">{t("currentBadge")}</Badge>}
    >
      <CardContent className="space-y-6">
        <section aria-labelledby="free-usage-heading" className="space-y-5">
          <div>
            <h3
              id="free-usage-heading"
              className="text-h6 text-text-primary"
            >{t("usage")}</h3>
            <p className="mt-1 text-body-sm text-text-muted">{t("resets")}</p>
          </div>
          {summaryUsageAvailable ? (
            <UsageMeter
              label={t("monthlySummaries")}
              used={caps.summariesUsed}
              limit={caps.summariesLimit}
            />
          ) : (
            <p className="text-body-sm text-text-secondary">{t("summaryUnavailable")}</p>
          )}
          {historyUsageAvailable ? (
            <UsageMeter
              label={t("saved")}
              used={caps.historyUsed as number}
              limit={caps.historyLimit as number}
            />
          ) : (
            <p className="text-body-sm text-text-secondary">{t("historyUnavailable")}</p>
          )}
          {projectUsageAvailable ? (
            <div className="space-y-2">
              <UsageMeter
                label={t("projectLabel")}
                used={caps.projectsUsed}
                limit={caps.projectsLimit}
              />
              <p className="text-body-sm text-text-muted">{t("deletion")}</p>
            </div>
          ) : (
            <p className="text-body-sm text-text-secondary">{t("projectUnavailable")}</p>
          )}
        </section>
      </CardContent>
      <CardFooter className="border-t border-border-subtle">
        <Button asChild size="lg">
          <Link href="/pricing" onClick={onUpgrade}>{t("upgrade")}<ArrowRight aria-hidden="true" />
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
  const t = useTranslations("pricing");
  const cancellationPending = accessEndsAt !== undefined;
  const cadence = billingCadence(plan, t);
  const locale = useLocale();
  const relevantDate = formatBillingDate(
    cancellationPending ? (accessEndsAt ?? null) : (renewsAt ?? null), locale,
  );
  const missingMetadata = [
    cadence ? null : t("cadence"),
    relevantDate
      ? null
      : cancellationPending
        ? t("endDate")
        : t("renewalDate"),
  ].filter((field): field is string => field !== null);

  return (
    <PlanCard
      title={t("proPlan")}
      description={t("proDetails")}
      badge={
        <Badge variant={cancellationPending ? "outline" : "secondary"}>
          {cancellationPending ? t("scheduled") : t("activeBadge")}
        </Badge>
      }
    >
      <CardContent className="space-y-6">
        <p className="text-body-md text-text-secondary">{t("unlimited")}</p>
        {cadence || relevantDate ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {cadence ? (
              <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
                <dt className="text-caption font-medium uppercase tracking-wide text-text-muted">{t("cadence")}</dt>
                <dd className="mt-1 text-body-md font-semibold text-text-primary">
                  {cadence}
                </dd>
              </div>
            ) : null}
            {relevantDate ? (
              <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
                <dt className="text-caption font-medium uppercase tracking-wide text-text-muted">
                  {cancellationPending ? t("ends") : t("renewal")}
                </dt>
                <dd className="mt-1 text-body-md font-semibold text-text-primary">
                  {cancellationPending ? t("cancels") : t("renews")}{" "}
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
            <AlertTitle>{t("scheduled")}</AlertTitle>
            <AlertDescription>
              <p>
                {relevantDate
                  ? t("through", {date: relevantDate})
                  : t("remains")}
              </p>
              <p>{t("resume")}</p>
            </AlertDescription>
          </Alert>
        ) : null}

        {missingMetadata.length > 0 ? (
          <Alert role="status" aria-live="polite">
            <AlertTitle>{t("missing")}</AlertTitle>
            <AlertDescription>
              <p>{missingMetadata.length === 1 ? t("missingOne", {field: missingMetadata[0]}) : t("missingTwo", {first: missingMetadata[0], second: missingMetadata[1]})}</p>
              <p>{t("review")}</p>
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
  const t = useTranslations("pricing");
  const cadence = billingCadence(plan, t);

  return (
    <PlanCard
      title={t("billingIssue")}
      description={t("issueDetail")}
      badge={
        <Badge
          variant="outline"
          className="border-accent-warning/60 text-text-primary"
        >{t("action")}</Badge>
      }
    >
      <CardContent className="space-y-5">
        <Alert
          role="status"
          aria-live="polite"
          className="border-accent-warning/40 bg-accent-warning/10"
        >
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("repairSub")}</AlertTitle>
          <AlertDescription>
            <p>{t("update")}</p>
          </AlertDescription>
        </Alert>
        {cadence ? (
          <p className="text-body-sm text-text-secondary">{cadence}</p>
        ) : (
          <p className="text-body-sm text-text-secondary">{t("cadenceUnavailable")}</p>
        )}
        <div className="space-y-3">
          <ManageSubscriptionButton
            label={t("resolveStripe")}
            onActivate={onResolve}
          />
          <StripeOwnershipNote />
        </div>
      </CardContent>
    </PlanCard>
  );
}

function LoadingPlan() {
  const t = useTranslations("pricing");
  return (
    <Card
      role="status"
      aria-label={t("loadingBilling")}
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
      <span className="sr-only">{t("loadingBilling")}</span>
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
  const t = useTranslations("pricing");
  return (
    <Card className="border-border-subtle">
      <CardContent>
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("detailsUnavailable")}</AlertTitle>
          <AlertDescription>
            <p>{t("loadFailed")}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={isRetrying}
              onClick={onRetry}
            >
              {isRetrying ? t("trying") : t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export function PlanBillingView() {
  const t = useTranslations("pricing");
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
          <p className="text-caption font-medium uppercase tracking-wide text-text-muted">{t("settings")}</p>
          <h1 className="text-h2 text-text-primary">{t("billing")}</h1>
          <p className="text-body-lg text-text-secondary">{t("billingIntro")}</p>
        </header>
        {planContent}
      </div>
    </div>
  );
}
