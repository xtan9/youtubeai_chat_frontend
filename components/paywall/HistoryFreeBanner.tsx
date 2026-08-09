"use client";

import Link from "next/link";
import { getContextualLimitAction } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";

export function HistoryFreeBanner({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const atCap = used >= limit;
  const action = getContextualLimitAction({
    tier: "free",
    sourceSurface: "history_limit",
    returnTo: "/history",
  });
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface: "history_limit",
    presentationState: action.presentationState,
    authenticationState: action.authenticationState,
  });

  return (
    <p
      className="text-body-sm text-text-secondary"
      data-paywall-variant="history-free-banner"
    >
      Showing {Math.min(used, limit)} of {limit} —{" "}
      {atCap ? "older summaries auto-replaced. " : null}
      <Link
        href={action.href}
        className="text-accent-brand hover:underline"
        onClick={captureClick}
      >
        {action.label}
      </Link>
    </p>
  );
}
