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
  // we pin to the spec-required "2025-08-27.basil" which determines webhook
  // payload shape. Cast through `never` to satisfy the literal-union check
  // without silently upgrading to the SDK default.
  _client = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });
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
