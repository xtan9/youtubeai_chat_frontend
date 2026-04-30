import { getServiceRoleClient } from "@/lib/supabase/service-role";

export const FREE_LIMITS = {
  summariesPerMonth: 10,
  chatMessagesPerVideo: 5,
  historyItems: 10,
} as const;

export const ANON_LIMITS = {
  summariesLifetime: 1,
} as const;

const DEPLOY_DEFECT_CODES = new Set(["42883", "42501"]);

export type Tier = "anon" | "free" | "pro";

export type EntitlementResult =
  | { tier: "anon" | "free"; allowed: true; remaining: number; reason: "within_limit" | "fail_open" }
  | { tier: "anon" | "free"; allowed: false; remaining: 0; reason: "exceeded" }
  | { tier: "pro"; allowed: true; remaining: number; reason: "unlimited" };

export function getYearMonthUtc(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Reads `user_subscriptions.tier` directly. Fail-open to 'free' on infra
 * errors — preferable to 500-ing a legitimate request, and the worst case
 * is a paying user briefly hitting free caps until the read recovers.
 */
export async function getUserTier(userId: string): Promise<"free" | "pro"> {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for getUserTier", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return "free";
  }
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[entitlements] getUserTier error (fail-open to free)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_TIER_READ",
      userId,
      code: (error as { code?: string }).code,
    });
    return "free";
  }
  if (!data) return "free";
  return data.tier === "pro" ? "pro" : "free";
}
