import Stripe from "stripe";

let _client: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      console.error("[stripe] STRIPE_SECRET_KEY missing", {
        errorId: "STRIPE_KEY_MISSING",
      });
    }
    return null;
  }
  // SDK v22 ships with apiVersion "2026-04-22.dahlia" as LatestApiVersion;
  // we pin to "2025-05-28.basil" — the basil-family snapshot the Dashboard
  // webhook endpoint is configured for. In the basil family,
  // `current_period_end` and `current_period_start` live on
  // `Subscription.items.data[].` (NOT on the Subscription itself) — read
  // them via `readCurrentPeriodEnd()` below, never via `sub.current_period_end`
  // which is `null` in basil payloads and silently produces tier="free" for
  // every paying user.
  // The Dashboard webhook config and this SDK version must agree on the
  // family or the payload shape our handlers expect will drift. Cast
  // through `never` to satisfy the literal-union check without silently
  // upgrading to the SDK default.
  _client = new Stripe(key, { apiVersion: "2025-05-28.basil" as never });
  return _client;
}

export type Plan = "monthly" | "yearly";

export function priceIdForPlan(plan: Plan): string | null {
  if (plan === "monthly") return process.env.STRIPE_PRICE_MONTHLY ?? null;
  if (plan === "yearly") return process.env.STRIPE_PRICE_YEARLY ?? null;
  return null;
}

const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Compute the user-facing tier from Stripe subscription state.
 * Source-of-truth function — used by the webhook to write
 * `user_subscriptions.tier`. Mirrors the spec's tier-derivation rule.
 */
export function deriveTier(
  status: string | null | undefined,
  currentPeriodEndIso: string | null | undefined
): "free" | "pro" {
  if (!status || !currentPeriodEndIso) return "free";
  const periodEnd = Date.parse(currentPeriodEndIso);
  if (!Number.isFinite(periodEnd)) return "free";
  const now = Date.now();

  if (status === "active" || status === "trialing") {
    return periodEnd > now ? "pro" : "free";
  }
  if (status === "past_due") {
    return periodEnd > now - PAST_DUE_GRACE_MS ? "pro" : "free";
  }
  return "free";
}

// Convenience: webhook payloads stamp `current_period_end` as a unix
// seconds number. Convert before passing to deriveTier so callers
// don't have to remember.
export function periodEndToIso(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Read the subscription's current period end (unix seconds), accounting
 * for Stripe's basil-family schema move. In the basil API
 * (`2025-05-28.basil`+), `current_period_end` lives on each
 * `subscription_item`, not on the subscription itself. Reading
 * `sub.current_period_end` on a basil payload returns `null` and produces
 * tier="free" for every paying user.
 *
 * We read items first; fall back to the (now-deprecated) top-level field
 * for safety against pre-basil events still in flight or fixtures from
 * earlier API versions.
 */
export function readCurrentPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const itemEnd = item?.current_period_end;
  if (typeof itemEnd === "number" && Number.isFinite(itemEnd)) return itemEnd;
  const topEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof topEnd === "number" && Number.isFinite(topEnd)) return topEnd;
  return null;
}
