export type SubscriptionPlan = "monthly" | "yearly";

export type ResolvedSubscriptionPresentation =
  | { readonly state: "anonymous" }
  | { readonly state: "free" }
  | {
      readonly state: "active_pro";
      readonly plan: SubscriptionPlan | null;
      readonly renewsAt: string | null;
    }
  | {
      readonly state: "pro_pending_cancellation";
      readonly plan: SubscriptionPlan | null;
      readonly accessEndsAt: string | null;
    }
  | {
      readonly state: "billing_issue";
      readonly plan: SubscriptionPlan | null;
    };

export type SubscriptionPresentation =
  | ResolvedSubscriptionPresentation
  | { readonly state: "loading" }
  | { readonly state: "lookup_failure" };

type RegisteredSubscriptionSnapshot = {
  readonly tier: "free" | "pro";
  readonly plan: SubscriptionPlan | null;
  readonly status: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
};

// These relationships still have a customer-recoverable next step in Stripe.
// Terminal or access-expired relationships intentionally fall through to Free.
const RECOVERABLE_BILLING_STATUSES = new Set([
  "incomplete",
  "past_due",
  "paused",
  "unpaid",
]);

/**
 * Interprets raw Stripe relationship state once, at the entitlement seam.
 * Product surfaces consume the returned product vocabulary and never branch on
 * Stripe status strings or cancellation flags themselves.
 */
export function normalizeSubscriptionPresentation(
  snapshot: RegisteredSubscriptionSnapshot,
): Exclude<ResolvedSubscriptionPresentation, { state: "anonymous" }> {
  if (
    snapshot.status &&
    RECOVERABLE_BILLING_STATUSES.has(snapshot.status)
  ) {
    return { state: "billing_issue", plan: snapshot.plan };
  }

  if (snapshot.tier === "pro") {
    if (snapshot.cancelAtPeriodEnd) {
      return {
        state: "pro_pending_cancellation",
        plan: snapshot.plan,
        accessEndsAt: snapshot.currentPeriodEnd,
      };
    }

    return {
      state: "active_pro",
      plan: snapshot.plan,
      renewsAt: snapshot.currentPeriodEnd,
    };
  }

  return { state: "free" };
}
