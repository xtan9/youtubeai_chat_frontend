import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export type EntitlementsData = {
  tier: "anon" | "free" | "pro";
  caps: {
    summariesUsed: number;
    summariesLimit: number; // -1 = unlimited
    historyUsed?: number;
    historyLimit?: number; // -1 = unlimited
  };
  subscription?: {
    plan?: "monthly" | "yearly" | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean | null;
  } | null;
};

async function fetchEntitlements(): Promise<EntitlementsData> {
  const res = await fetch("/api/me/entitlements", { cache: "no-store" });
  if (!res.ok) throw new Error(`entitlements ${res.status}`);
  return (await res.json()) as EntitlementsData;
}

/**
 * Reads the user's current tier and caps from /api/me/entitlements.
 * Single source of truth for paywall UI gating. Refetches on window
 * focus so a user who upgrades in another tab sees the update without
 * a full reload. Stale time is short (30s) so cap changes after a
 * summary submit propagate quickly without spamming the endpoint.
 *
 * Invalidate via `queryClient.invalidateQueries({ queryKey: ["entitlements"] })`
 * after a mutation that changes tier or caps (e.g. /billing/success → tier=pro).
 */
export function useEntitlements() {
  const query = useQuery({
    queryKey: ["entitlements"],
    queryFn: fetchEntitlements,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (query.error) {
      console.error("[useEntitlements] fetch failed (paywall surfaces will silently degrade)", {
        errorId: "USE_ENTITLEMENTS_FETCH_FAIL",
        err: query.error,
      });
    }
  }, [query.error]);

  return query;
}
