"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import {
  getContextualLimitAction,
  type ContextualLimitSourceSurface,
  type ContextualLimitTier,
} from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";

type Variant = "summary-cap" | "chat-cap" | "history-cap";

const SOURCE_SURFACE: Record<Variant, ContextualLimitSourceSurface> = {
  "summary-cap": "summary_limit",
  "chat-cap": "video_chat_limit",
  "history-cap": "history_limit",
};

const DEFAULT_RETURN_DESTINATION: Record<Variant, string> = {
  "summary-cap": "/summary",
  "chat-cap": "/summary",
  "history-cap": "/history",
};

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
    sub: "Upgrade to Pro to keep going.",
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
const CELEBRATION_MIN_VIDEOS = 2;

function formatTimeSaved(videosCount: number): string {
  const totalMinutes = videosCount * MINUTES_SAVED_PER_VIDEO;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
}

// Compute reset date in local time so the printed "June 1" matches the
// user's wall clock. The cap rolls over on the 1st of the next calendar
// month — we want consistent local-day formatting, not a UTC timestamp
// that gets re-localized and shifts a day for non-UTC users.
function formatNextResetDate(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function UpgradeCard({
  variant,
  tier,
  returnTo = DEFAULT_RETURN_DESTINATION[variant],
}: {
  readonly variant: Variant;
  readonly tier?: ContextualLimitTier;
  readonly returnTo?: string;
}) {
  const { data: ent, isError } = useEntitlements();
  const resolvedTier: ContextualLimitTier | undefined =
    tier ?? (ent?.tier === "anon" || ent?.tier === "free" ? ent.tier : undefined);
  const sourceSurface = SOURCE_SURFACE[variant];
  const action = resolvedTier
    ? getContextualLimitAction({
        tier: resolvedTier,
        sourceSurface,
        returnTo,
      })
    : null;
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface,
    presentationState: action?.presentationState ?? "upgrade_to_pro",
    authenticationState: action?.authenticationState ?? "registered",
    enabled: action !== null,
  });

  // Cap displayed count at the limit so a transient race that leaves
  // `summariesUsed` above `summariesLimit` doesn't surface as
  // "You summarized 47 videos this month" with a 10-cap.
  const rawUsed = ent?.caps.summariesUsed ?? 0;
  const limit = ent?.caps.summariesLimit ?? 0;
  const summariesUsed = limit > 0 ? Math.min(rawUsed, limit) : rawUsed;

  // Celebration only on the summary-cap path with usable entitlements
  // data and at least the minimum video count. On entitlements failure
  // (`isError`), fall back to the neutral headline rather than printing
  // "You summarized 0 videos" or pretending a confident number.
  const showCelebration =
    variant === "summary-cap" &&
    !isError &&
    !!ent &&
    summariesUsed >= CELEBRATION_MIN_VIDEOS;

  const headline = useMemo(() => {
    if (showCelebration) {
      return {
        title: `You summarized ${summariesUsed} ${summariesUsed === 1 ? "video" : "videos"} this month`,
        sub: `≈ ${formatTimeSaved(summariesUsed)} of YouTube saved`,
      };
    }
    return FALLBACK_HEADLINE[variant];
  }, [variant, showCelebration, summariesUsed]);

  const resetDate = variant === "summary-cap" ? formatNextResetDate() : null;

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
              data-testid="upgrade-card-bullet-check"
            />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>

      {action ? (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild onClick={captureClick}>
            <Link href={action.href}>{action.label}</Link>
          </Button>
          {resolvedTier === "free" ? (
            <Button asChild variant="outline" onClick={captureClick}>
              <Link href={action.href}>See plans</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 text-caption text-text-muted">
        {resetDate ? <>Free tier resets {resetDate} · </> : null}
        Cancel anytime
      </p>
    </section>
  );
}
