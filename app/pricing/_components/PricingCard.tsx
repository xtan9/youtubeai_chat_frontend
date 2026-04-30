"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

type Plan = "monthly" | "yearly";

export function PricingProCard({ plan }: { plan: Plan }) {
  const router = useRouter();
  const { data: ent } = useEntitlements();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (!ent || ent.tier === "anon") {
      router.push("/auth/sign-up?redirect_to=/pricing?intent=upgrade");
      return;
    }
    if (ent.tier === "pro") return; // already pro
    setPending(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        console.error("[pricing] checkout failed", { status: res.status });
        setPending(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        console.error("[pricing] checkout response missing url");
        setPending(false);
        return;
      }
      window.location.assign(body.url);
    } catch (err) {
      console.error("[pricing] checkout threw", err);
      setPending(false);
    }
  };

  const price = plan === "yearly" ? "$4.99/mo" : "$6.99/mo";
  const billed = plan === "yearly" ? "billed $59.88 yearly" : "billed monthly";
  const isPro = ent?.tier === "pro";
  const cta = isPro ? "Current plan" : pending ? "Redirecting…" : "Upgrade";

  return (
    <section
      className="rounded-2xl border border-accent-brand bg-surface-raised p-6"
      data-pricing-card="pro"
    >
      <h3 className="text-h4 text-text-primary">Pro</h3>
      <p className="mt-1 text-h2 text-text-primary">{price}</p>
      <p className="text-caption text-text-muted">{billed}</p>
      <ul className="mt-4 space-y-2 text-body-md text-text-secondary">
        <li>Unlimited summaries</li>
        <li>Unlimited chat per video</li>
        <li>Unlimited history</li>
        <li>Cancel anytime</li>
      </ul>
      <Button
        className="mt-6 w-full"
        onClick={onClick}
        disabled={pending || isPro}
      >
        {cta}
      </Button>
    </section>
  );
}

export function PricingFreeCard() {
  return (
    <section
      className="rounded-2xl border border-border-subtle bg-surface-raised p-6"
      data-pricing-card="free"
    >
      <h3 className="text-h4 text-text-primary">Free</h3>
      <p className="mt-1 text-h2 text-text-primary">$0</p>
      <p className="text-caption text-text-muted">forever</p>
      <ul className="mt-4 space-y-2 text-body-md text-text-secondary">
        <li>10 summaries per month</li>
        <li>5 chat messages per video</li>
        <li>10-item history</li>
      </ul>
    </section>
  );
}
