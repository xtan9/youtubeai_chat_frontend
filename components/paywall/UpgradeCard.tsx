"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

type Variant = "summary-cap" | "chat-cap" | "history-cap";

const PRO_BENEFITS: Record<Variant, string[]> = {
  "summary-cap": [
    "Unlimited summaries — no monthly cap",
    "Unlimited AI Chat — ask follow-ups across every video",
    "Permanent history — never auto-replaced",
  ],
  "chat-cap": [
    "Unlimited AI Chat across every video",
    "Unlimited summaries — no monthly cap",
    "Permanent history — never auto-replaced",
  ],
  "history-cap": [
    "Permanent history — never auto-replaced",
    "Unlimited summaries — no monthly cap",
    "Unlimited AI Chat across every video",
  ],
};

const FALLBACK_HEADLINE: Record<Variant, { title: string; sub: string }> = {
  "summary-cap": {
    title: "You've reached your free summary limit this month",
    sub: "Unlock Pro to keep going.",
  },
  "chat-cap": {
    title: "You've used your free chats on this video",
    sub: "Pro unlocks chat across every video, every time.",
  },
  "history-cap": {
    title: "Your free history is full",
    sub: "Older summaries are auto-replaced. Pro keeps everything forever.",
  },
};

const MINUTES_SAVED_PER_VIDEO = 15;

function formatTimeSaved(videosCount: number): string {
  const totalMinutes = videosCount * MINUTES_SAVED_PER_VIDEO;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
}

function formatNextResetDate(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function UpgradeCard({ variant }: { variant: Variant }) {
  const posthog = usePostHog();
  const { data: ent } = useEntitlements();

  const summariesUsed = ent?.caps.summariesUsed ?? 0;
  const showCelebration = variant === "summary-cap" && summariesUsed >= 2;

  const headline = useMemo(() => {
    if (variant === "summary-cap" && showCelebration) {
      return {
        title: `You summarized ${summariesUsed} ${summariesUsed === 1 ? "video" : "videos"} this month`,
        sub: `≈ ${formatTimeSaved(summariesUsed)} of YouTube saved`,
      };
    }
    return FALLBACK_HEADLINE[variant];
  }, [variant, showCelebration, summariesUsed]);

  const resetDate = variant === "summary-cap" ? formatNextResetDate() : null;

  useEffect(() => {
    posthog?.capture("paywall_cap_hit_viewed", {
      variant,
      tier: ent?.tier ?? null,
      summaries_used: ent?.caps.summariesUsed ?? null,
      summaries_limit: ent?.caps.summariesLimit ?? null,
    });
  }, [posthog, variant, ent?.tier, ent?.caps.summariesUsed, ent?.caps.summariesLimit]);

  const handleCtaClick = (cta: "primary" | "secondary") => {
    posthog?.capture("paywall_cap_cta_clicked", {
      variant,
      cta,
      tier: ent?.tier ?? null,
    });
  };

  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-8 text-center"
      data-paywall-variant={variant}
    >
      {showCelebration ? (
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand"
          aria-hidden="true"
        >
          <Sparkles className="h-6 w-6" />
        </div>
      ) : null}

      <h2 className="mt-4 text-h3 text-text-primary">{headline.title}</h2>
      <p className="mt-2 text-body-md text-text-secondary">{headline.sub}</p>

      <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
        {PRO_BENEFITS[variant].map((benefit) => (
          <li
            key={benefit}
            className="flex items-start gap-2 text-body-md text-text-primary"
          >
            <Check
              className="mt-1 h-4 w-4 shrink-0 text-accent-success"
              aria-hidden="true"
            />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild onClick={() => handleCtaClick("primary")}>
          <Link href="/pricing">Unlock Pro — $4.99/mo</Link>
        </Button>
        <Button asChild variant="outline" onClick={() => handleCtaClick("secondary")}>
          <Link href="/pricing">See plans</Link>
        </Button>
      </div>

      <p className="mt-4 text-caption text-text-muted">
        {resetDate ? <>Free tier resets {resetDate} · </> : null}
        Cancel anytime
      </p>
    </section>
  );
}
