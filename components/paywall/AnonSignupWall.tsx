"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buildAuthPageHref } from "@/lib/auth/signup-redirect";
import { getContextualLimitAction } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";

type Reason = "hit-cap" | "feature-locked";

export function AnonSignupWall({
  reason = "hit-cap",
  returnTo = "/",
}: {
  readonly reason?: Reason;
  readonly returnTo?: string;
}) {
  const t = useTranslations("home");
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
      <p className="text-body-md text-text-primary">{t(reason)}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button asChild>
          <Link href={action.href} onClick={captureClick}>
            {t("signupFree")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={buildAuthPageHref("/auth/login", returnTo)}>
            {t("haveAccount")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
