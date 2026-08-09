"use client";

import type { ReactNode } from "react";
import { useIsCheckoutReturnPending } from "@/lib/billing/activation-pending";

/**
 * Route-level purchase-action guard. Future global plan controls belong in
 * `children`, so a Stripe return renders a non-action status from the first
 * client render instead of flashing an Upgrade path before confirmation.
 */
export function CheckoutActivationGuard({
  children = null,
}: {
  children?: ReactNode;
}) {
  const isCheckoutReturn = useIsCheckoutReturnPending();

  if (!isCheckoutReturn) return children;

  return (
    <span
      role="status"
      aria-live="polite"
      className="whitespace-nowrap text-body-sm font-medium text-accent-brand"
    >
      Activating Pro
    </span>
  );
}
