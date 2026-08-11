"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getContextualLimitAction } from "@/lib/analytics/subscription-discovery-navigation";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";

type Variant =
  | "free-cap"
  | "anon-blocked"
  | "anonymous-trial-exhausted"
  | "anonymous-trial-unavailable";

const COPY: Record<Variant, string> = {
  "free-cap": "You've used 5/5 free chat messages on this video.",
  "anon-blocked": "Sign up to chat about your videos.",
  "anonymous-trial-exhausted":
    "You've used all 5 Anonymous Trial messages.",
  "anonymous-trial-unavailable":
    "Anonymous chat is temporarily unavailable.",
};

export function ChatCapBanner({
  variant = "free-cap",
  returnTo = "/summary",
}: {
  readonly variant?: Variant;
  readonly returnTo?: string;
}) {
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
      <p className="text-body-md text-text-primary">{COPY[variant]}</p>
      <Button asChild size="sm" className="mt-2">
        <Link href={action.href} onClick={captureClick}>
          {variant.startsWith("anonymous-trial-")
            ? "Create Account"
            : action.label}
        </Link>
      </Button>
    </div>
  );
}
