"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getContextualLimitAction } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";

export function HistoryAnonEmpty() {
  const action = getContextualLimitAction({
    tier: "anon",
    sourceSurface: "history_limit",
    returnTo: "/history",
  });
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface: "history_limit",
    presentationState: action.presentationState,
    authenticationState: action.authenticationState,
  });

  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-12 text-center"
      data-paywall-variant="history-anon"
    >
      <h2 className="text-h3 text-text-primary">
        Save and revisit your summaries.
      </h2>
      <p className="mt-2 text-body-md text-text-secondary">
        Sign up to keep a history of every video you&apos;ve summarized.
      </p>
      <Button asChild className="mt-4">
        <Link href={action.href} onClick={captureClick}>
          {action.label}
        </Link>
      </Button>
    </section>
  );
}
