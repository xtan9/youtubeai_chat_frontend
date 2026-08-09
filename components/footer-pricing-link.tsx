"use client";

import Link from "next/link";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { useUser } from "@/lib/contexts/user-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsCheckoutReturnPending } from "@/lib/billing/activation-pending";

export function FooterPricingLink() {
  const { user, isLoading, error } = useUser();
  const isMobile = useIsMobile();
  const isCheckoutReturn = useIsCheckoutReturnPending();
  const authenticationState = user?.is_anonymous
    ? "anonymous_session"
    : user
      ? "registered"
      : "logged_out";
  const { captureClick } = useSubscriptionDiscovery({
    sourceSurface: "public_footer",
    presentationState: "pricing",
    authenticationState,
    enabled: !isLoading && !error && !isMobile && !isCheckoutReturn,
  });

  if (isCheckoutReturn) return null;

  return (
    <Link
      href="/pricing?source_surface=public_footer"
      onClick={captureClick}
      className="text-sm text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-brand"
    >
      Pricing
    </Link>
  );
}
