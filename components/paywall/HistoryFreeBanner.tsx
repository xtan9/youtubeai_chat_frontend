"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("home");
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
      {t("historyLimit", {count: Math.min(used, limit), limit})} —{" "}
      {atCap ? t("historyReplaced") : null}
      <Link
        href={action.href}
        className="text-accent-brand hover:underline"
        onClick={captureClick}
      >
        {t("upgrade")}
      </Link>
    </p>
  );
}
