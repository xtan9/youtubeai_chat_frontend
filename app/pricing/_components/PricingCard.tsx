"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

type Plan = "monthly" | "yearly";

export function PricingProCard({ plan }: { plan: Plan }) {
  const router = useRouter();
  const {
    data: ent,
    isError: hasEntitlementsError,
    isFetching: isFetchingEntitlements,
    isPending: isPendingEntitlements,
    refetch: refetchEntitlements,
  } = useEntitlements();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (hasEntitlementsError) {
      await refetchEntitlements();
      return;
    }
    if (!ent) return;
    if (ent.tier === "anon") {
      router.push(
        "/auth/sign-up?redirect_to=" +
          encodeURIComponent("/pricing?intent=upgrade"),
      );
      return;
    }
    if (ent.tier === "pro") {
      router.push("/account");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        console.error("[pricing] checkout failed", { status: res.status });
        setError("Couldn't start checkout. Please try again.");
        setPending(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        console.error("[pricing] checkout response missing url");
        setError("Couldn't start checkout. Please try again.");
        setPending(false);
        return;
      }
      captureAnalyticsEvent("checkout_started", {
        account_type: "free",
        source_surface: "pricing",
        plan,
        billing_interval: plan,
      });
      window.location.assign(body.url);
    } catch (err) {
      console.error("[pricing] checkout threw", err);
      setError("Couldn't start checkout. Please try again.");
      setPending(false);
    }
  };

  const price = plan === "yearly" ? "$4.99/mo equivalent" : "$6.99/mo";
  const billed =
    plan === "yearly" ? "Billed annually at $59.88" : "Billed monthly";
  const isPro = ent?.tier === "pro";
  const isRetryingEntitlements = hasEntitlementsError && isFetchingEntitlements;
  const isResolvingEntitlements = isPendingEntitlements || isRetryingEntitlements;
  const isCurrentPlan = isPro && ent.subscription?.plan === plan;
  const cta = hasEntitlementsError
    ? isRetryingEntitlements
      ? `Retrying ${plan} pricing`
      : `Retry ${plan} pricing`
    : isPendingEntitlements
    ? `Loading ${plan} pricing`
    : isCurrentPlan
      ? "Current plan"
      : isPro
        ? "Manage subscription"
        : pending
          ? "Redirecting…"
          : `Choose ${plan}`;
  const isYearly = plan === "yearly";

  return (
    <section
      className={`flex h-full flex-col rounded-2xl border bg-surface-raised p-6 ${
        isYearly ? "border-accent-brand" : "border-border-subtle"
      }`}
      data-pricing-card={`pro-${plan}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h4 text-text-primary">
          Pro {isYearly ? "Yearly" : "Monthly"}
        </h2>
        {isYearly ? (
          <span className="shrink-0 rounded-full bg-accent-brand px-2.5 py-1 text-caption text-text-inverse">
            Save 28%
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-h2 text-text-primary">{price}</p>
      <p className="text-caption text-text-muted">{billed}</p>
      <ul className="mt-4 flex-1 space-y-2 text-body-md text-text-secondary">
        <li>Unlimited summaries</li>
        <li>Unlimited chat per video</li>
        <li>Unlimited history</li>
        <li>Unlimited Projects within technical and abuse limits</li>
        <li>Cancel anytime</li>
      </ul>
      <Button
        className="mt-6 w-full"
        onClick={onClick}
        disabled={isResolvingEntitlements || pending || isCurrentPlan}
      >
        {cta}
      </Button>
      {error ? (
        <p className="text-caption text-accent-danger mt-2" role="alert">
          {error}
        </p>
      ) : null}
      {hasEntitlementsError ? (
        <p className="text-caption text-accent-danger mt-2" role="alert">
          Couldn&apos;t load your account status. Retry before choosing a plan.
        </p>
      ) : null}
    </section>
  );
}

export function PricingFreeCard() {
  return (
    <section
      className="h-full rounded-2xl border border-border-subtle bg-surface-raised p-6"
      data-pricing-card="free"
    >
      <h2 className="text-h4 text-text-primary">Free</h2>
      <p className="mt-1 text-h2 text-text-primary">$0</p>
      <p className="text-caption text-text-muted">forever</p>
      <ul className="mt-4 space-y-2 text-body-md text-text-secondary">
        <li>10 summaries per month</li>
        <li>5 Video Chat messages per Video</li>
        <li>10-item History</li>
        <li>1 durable Project</li>
      </ul>
    </section>
  );
}
