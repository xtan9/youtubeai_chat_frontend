import { getServiceRoleClient } from "@/lib/supabase/service-role";

export const CHECKOUT_STATUS_RATE_LIMIT_PER_MINUTE = 45;

export type CheckoutStatusRateLimitResult =
  | { readonly allowed: true; readonly reason: "within_limit" | "fail_open" }
  | { readonly allowed: false; readonly reason: "exceeded" | "unavailable" };

function unavailableResult(): CheckoutStatusRateLimitResult {
  return process.env.NODE_ENV === "production"
    ? { allowed: false, reason: "unavailable" }
    : { allowed: true, reason: "fail_open" };
}

/**
 * Uses the existing atomic rate-limit counter with a billing-specific key.
 * This protects Stripe reads without consuming the product request quota
 * stored under the Learner's unprefixed user ID.
 */
export async function checkCheckoutStatusRateLimit(
  userId: string,
): Promise<CheckoutStatusRateLimitResult> {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[billing/checkout/status] rate limit unavailable", {
        errorId: "BILLING_CHECKOUT_STATUS_RATE_LIMIT_NO_CLIENT",
        userId,
      });
    }
    return unavailableResult();
  }

  const windowStart = new Date();
  windowStart.setSeconds(0, 0);

  try {
    const { data, error } = await supabase.rpc("increment_rate_limit", {
      p_user_id: `billing_checkout_status:${userId}`,
      p_window_start: windowStart.toISOString(),
    });
    if (error) {
      console.error("[billing/checkout/status] rate limit failed", {
        errorId: "BILLING_CHECKOUT_STATUS_RATE_LIMIT_FAILED",
        userId,
        code: (error as { code?: string }).code,
      });
      return unavailableResult();
    }

    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[billing/checkout/status] rate limit returned bad data", {
        errorId: "BILLING_CHECKOUT_STATUS_RATE_LIMIT_BAD_DATA",
        userId,
      });
      return unavailableResult();
    }

    return count > CHECKOUT_STATUS_RATE_LIMIT_PER_MINUTE
      ? { allowed: false, reason: "exceeded" }
      : { allowed: true, reason: "within_limit" };
  } catch (error) {
    console.error("[billing/checkout/status] rate limit threw", {
      errorId: "BILLING_CHECKOUT_STATUS_RATE_LIMIT_THREW",
      userId,
      error,
    });
    return unavailableResult();
  }
}
