"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getContextualLimitAction } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

type Variant =
  | "free-cap"
  | "anon-blocked"
  | "anonymous-trial-exhausted"
  | "anonymous-trial-unavailable";

export function ChatCapBanner({
  variant = "free-cap",
  returnTo = "/summary",
}: {
  readonly variant?: Variant;
  readonly returnTo?: string;
}) {
  const t = useTranslations("home");
  const action = getContextualLimitAction({
    tier: variant === "free-cap" ? "free" : "anon",
    sourceSurface: "video_chat_limit",
    returnTo,
  });
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface: "video_chat_limit",
    presentationState: action.presentationState,
    authenticationState: action.authenticationState,
  });
  const isAnonymousTrialUnavailable =
    variant === "anonymous-trial-unavailable";
  const isAnonymousTrialStatus = variant.startsWith("anonymous-trial-");
  const isLiveStatus = isAnonymousTrialStatus || variant === "free-cap";
  const captureAction = () => {
    captureClick();
    if (isAnonymousTrialStatus) {
      captureAnalyticsEvent("anonymous_trial_registration_selected", {
        source_surface: "hero_demo",
      });
    }
  };

  return (
    <div
      className="rounded-lg border border-border-subtle bg-surface-raised p-4 text-center"
      data-paywall-variant={`chat-${variant}`}
      role={
        isAnonymousTrialUnavailable
          ? "alert"
          : isLiveStatus
            ? "status"
            : undefined
      }
      aria-live={
        isAnonymousTrialUnavailable
          ? "assertive"
          : isLiveStatus
            ? "polite"
            : undefined
      }
    >
      <p className="text-body-md text-text-primary">{t(variant)}</p>
      <Button asChild size="sm" className="mt-2">
        <Link href={action.href} onClick={captureAction}>
          {variant.startsWith("anonymous-trial-")
            ? t("createAccount")
            : t(variant === "free-cap" ? "upgrade" : "signupFree")}
        </Link>
      </Button>
    </div>
  );
}
