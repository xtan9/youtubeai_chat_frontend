"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getContextualLimitAction } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";

type Reason = "hit-cap" | "feature-locked";

const COPY: Record<Reason, string> = {
  "hit-cap":
    "Try unlimited free — sign up to get 10 free summaries per month and our AI chat.",
  "feature-locked":
    "Sign up to keep using the app — get 10 free summaries each month.",
};

export function AnonSignupWall({
  reason = "hit-cap",
  returnTo = "/",
}: {
  readonly reason?: Reason;
  readonly returnTo?: string;
}) {
  const action = getContextualLimitAction({
    tier: "anon",
    sourceSurface: "summary_limit",
    returnTo,
  });
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface: "summary_limit",
    presentationState: action.presentationState,
    authenticationState: action.authenticationState,
  });

  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-6 text-center"
      data-paywall-variant={`anon-${reason}`}
    >
      <p className="text-body-md text-text-primary">{COPY[reason]}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button asChild>
          <Link href={action.href} onClick={captureClick}>
            {action.label}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/auth/login?redirect_to=/">I have an account</Link>
        </Button>
      </div>
    </section>
  );
}
