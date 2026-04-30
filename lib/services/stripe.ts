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
  // webhook endpoint is configured for. The Dashboard webhook config and
  // this SDK version must agree or payload shapes drift between the source
  // of events and the handlers parsing them. See `readCurrentPeriodEnd()`
  // for the basil schema move that motivates this pin. Cast through
  // `never` to satisfy the literal-union check without silently upgrading
  // to the SDK default.
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
  if (!Number.isFinite(periodEnd)) {
    // A non-finite Date.parse on a value our own `periodEndToIso` produced
    // is a code defect, not a data condition — caller passed a malformed
    // ISO string. Log so it shows up in alerts; falling through to "free"
    // matches the existing fail-closed posture.
    console.error("[stripe] deriveTier got unparseable periodEndIso", {
      errorId: "STRIPE_PERIOD_END_PARSE_FAIL",
      status,
      currentPeriodEndIso,
    });
    return "free";
  }
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

// Localizes the basil-vs-dahlia schema cast to one named seam. SDK v22's
// `Stripe.Subscription` reflects the dahlia type shape, but our pinned
// runtime apiVersion (`2025-05-28.basil`) returns payloads where
// `current_period_end` lives on `Subscription.items.data[]` instead of
// on the Subscription itself. Reading via this type instead of inline
// `as unknown as { current_period_end?: number }` keeps the boundary
// greppable and lets the helper body read fields normally.
type BasilSubscription = Stripe.Subscription & { current_period_end?: number };
type BasilSubscriptionItem = Stripe.SubscriptionItem & { current_period_end?: number };

/**
 * Read the subscription's current period end (unix seconds), accounting
 * for Stripe's basil-family schema move. In the basil API
 * (`2025-05-28.basil`+), `current_period_end` lives on each
 * `subscription_item`, not on the subscription itself; reading the
 * top-level field on a basil payload returns `null` and downstream
 * `deriveTier(status, null)` short-circuits to `"free"`.
 *
 * Reads items first; falls back to the top-level field for fixtures
 * or events delivered under an older pinned apiVersion. Logs a structured
 * `STRIPE_PERIOD_END_MISSING` errorId when neither location is present —
 * that branch indicates schema drift, not a free user, so callers can
 * alert on it without having to pattern-match the resulting tier="free"
 * write in production logs.
 */
export function readCurrentPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = (sub as BasilSubscription).items?.data?.[0] as BasilSubscriptionItem | undefined;
  const itemEnd = item?.current_period_end;
  if (typeof itemEnd === "number" && Number.isFinite(itemEnd)) return itemEnd;
  const topEnd = (sub as BasilSubscription).current_period_end;
  if (typeof topEnd === "number" && Number.isFinite(topEnd)) return topEnd;
  console.error("[stripe] period_end missing in both items[0] and top-level", {
    errorId: "STRIPE_PERIOD_END_MISSING",
    subId: sub.id,
    status: sub.status,
    hasItems: !!sub.items?.data?.length,
  });
  return null;
}
