import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ANON_LIMITS,
  FREE_LIMITS,
  getUserTier,
  getYearMonthUtc,
} from "@/lib/services/entitlements";
import { ANON_COOKIE_NAME, verifyAnonId } from "@/lib/services/anon-cookie";

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  // ─── Anonymous branch (not signed in to Supabase at all) ──
  if (!user) {
    const jar = await cookies();
    const cookieVal = jar.get(ANON_COOKIE_NAME)?.value ?? null;
    const anonId = cookieVal ? verifyAnonId(cookieVal) : null;
    let used = 0;
    if (anonId) {
      const sr = getServiceRoleClient();
      if (sr) {
        const { data } = await sr
          .from("anon_summary_quota")
          .select("count")
          .eq("anon_id", anonId)
          .maybeSingle();
        used = data?.count ?? 0;
      }
    }
    return Response.json({
      tier: "anon",
      caps: {
        summariesUsed: used,
        summariesLimit: ANON_LIMITS.summariesLifetime,
      },
    });
  }

  // ─── Signed-in branch ───────────────────────────────────────
  const userId = user.id;
  const isAnonAuth = user.is_anonymous ?? false;

  const tier = await getUserTier(userId);
  const sr = getServiceRoleClient();

  // Pro
  if (tier === "pro" && sr) {
    const { data: sub } = await sr
      .from("user_subscriptions")
      .select("plan, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    return Response.json({
      tier: "pro",
      caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
      subscription: sub ?? null,
    });
  }

  // Free (or fallback when service-role missing) — best-effort current values
  let summariesUsed = 0;
  let historyUsed = 0;
  if (sr) {
    const ym = getYearMonthUtc();
    const [usageRes, histRes] = await Promise.all([
      sr.from("monthly_summary_usage")
        .select("count")
        .eq("user_id", userId)
        .eq("year_month", ym)
        .maybeSingle(),
      sr.from("user_video_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);
    summariesUsed = usageRes.data?.count ?? 0;
    historyUsed = histRes.count ?? 0;
  }

  return Response.json({
    tier: isAnonAuth ? "anon" : "free",
    caps: {
      summariesUsed,
      summariesLimit: isAnonAuth
        ? ANON_LIMITS.summariesLifetime
        : FREE_LIMITS.summariesPerMonth,
      historyUsed,
      historyLimit: FREE_LIMITS.historyItems,
    },
  });
}
