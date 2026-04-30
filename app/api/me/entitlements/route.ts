import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ANON_LIMITS,
  FREE_LIMITS,
  getUserTier,
  getYearMonthUtc,
} from "@/lib/services/entitlements";
import { ANON_COOKIE_NAME, verifyAnonId } from "@/lib/services/anon-cookie";

const AUTH_CLIENT_ERROR_STATUSES = new Set([400, 401, 403]);

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET() {
  const supabase = await createClient();

  // Mirror the auth-vs-infra error classification used by /api/summarize/stream
  // and /api/chat/stream — 4xx from Supabase auth means the request is
  // unauthenticated; everything else means the auth service is sick and
  // we should 503.
  let user: User | null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_ERROR_STATUSES.has(error.status ?? -1)) {
      console.error("[me/entitlements] auth failed", {
        errorId: "ENTITLEMENTS_AUTH_INFRA_FAILED",
        status: error.status ?? null,
        message: error.message,
      });
      return jsonError(503, "Auth service temporarily unavailable.");
    }
    user = data.user;
  } catch (err) {
    console.error("[me/entitlements] auth threw", {
      errorId: "ENTITLEMENTS_AUTH_THREW",
      err,
    });
    return jsonError(503, "Auth service temporarily unavailable.");
  }

  // ─── No Supabase user at all (cookie-only anon) ─────────────────
  if (!user) {
    const jar = await cookies();
    const cookieVal = jar.get(ANON_COOKIE_NAME)?.value ?? null;
    const anonId = cookieVal ? verifyAnonId(cookieVal) : null;
    let used = 0;
    if (anonId) {
      const sr = getServiceRoleClient();
      if (sr) {
        const { data, error } = await sr
          .from("anon_summary_quota")
          .select("count")
          .eq("anon_id", anonId)
          .maybeSingle();
        if (error) {
          console.error("[me/entitlements] anon_summary_quota read failed", {
            errorId: "ENTITLEMENTS_ANON_USAGE_READ_FAILED",
            code: (error as { code?: string }).code,
          });
        }
        used = data?.count ?? 0;
      } else if (process.env.NODE_ENV === "production") {
        console.error("[me/entitlements] service-role missing for anon read", {
          errorId: "ENTITLEMENTS_GET_FAIL_OPEN_NO_CREDS",
        });
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

  // ─── Signed-in branch ──────────────────────────────────────────
  const userId = user.id;
  const isAnonAuth = user.is_anonymous ?? false;
  const sr = getServiceRoleClient();

  if (!sr && process.env.NODE_ENV === "production") {
    console.error("[me/entitlements] service-role missing for signed-in read", {
      errorId: "ENTITLEMENTS_GET_FAIL_OPEN_NO_CREDS",
      userId,
    });
  }

  const tier = await getUserTier(userId);

  // Pro: even if service-role is briefly missing, return tier:"pro" with
  // unlimited caps. We won't be able to fetch subscription metadata, but
  // demoting a paying user to Free in the response would render the
  // upgrade banner to them — far worse than a missing renewal date.
  if (tier === "pro") {
    let subscription: {
      plan?: "monthly" | "yearly" | null;
      current_period_end?: string | null;
      cancel_at_period_end?: boolean | null;
    } | null = null;
    if (sr) {
      const { data, error } = await sr
        .from("user_subscriptions")
        .select("plan, current_period_end, cancel_at_period_end")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.error("[me/entitlements] user_subscriptions read failed", {
          errorId: "ENTITLEMENTS_SUB_READ_FAILED",
          userId,
          code: (error as { code?: string }).code,
        });
      }
      subscription = data ?? null;
    }
    return Response.json({
      tier: "pro",
      caps: {
        summariesUsed: 0,
        // `-1` is the unlimited sentinel for the wire format. The internal
        // EntitlementResult uses Number.POSITIVE_INFINITY for `remaining` (clean
        // for arithmetic), but JSON.stringify coerces Infinity to null and would
        // force every UI consumer to special-case null vs. number. The translation
        // happens here at the API boundary.
        summariesLimit: -1,
        historyUsed: 0,
        historyLimit: -1,
      },
      subscription,
    });
  }

  // Supabase-anonymous users (is_anonymous=true) — these have a Supabase
  // user.id but should be tracked under the cookie-keyed anon counter,
  // not the per-user monthly counter. Mirror the gating model used by
  // /api/summarize/stream so the UI shows accurate caps.
  if (isAnonAuth) {
    const jar = await cookies();
    const cookieVal = jar.get(ANON_COOKIE_NAME)?.value ?? null;
    const anonId = cookieVal ? verifyAnonId(cookieVal) : null;
    let used = 0;
    if (anonId && sr) {
      const { data, error } = await sr
        .from("anon_summary_quota")
        .select("count")
        .eq("anon_id", anonId)
        .maybeSingle();
      if (error) {
        console.error("[me/entitlements] anon_summary_quota read failed (supabase anon)", {
          errorId: "ENTITLEMENTS_ANON_USAGE_READ_FAILED",
          userId,
          code: (error as { code?: string }).code,
        });
      }
      used = data?.count ?? 0;
    }
    return Response.json({
      tier: "anon",
      caps: {
        summariesUsed: used,
        summariesLimit: ANON_LIMITS.summariesLifetime,
      },
    });
  }

  // Free signed-in user — best-effort current values. If service-role is
  // missing, we report zeros (logged above) instead of inventing numbers.
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
    if (usageRes.error) {
      console.error("[me/entitlements] monthly_summary_usage read failed", {
        errorId: "ENTITLEMENTS_USAGE_READ_FAILED",
        userId,
        code: (usageRes.error as { code?: string }).code,
      });
    }
    if (histRes.error) {
      console.error("[me/entitlements] user_video_history read failed", {
        errorId: "ENTITLEMENTS_HISTORY_READ_FAILED",
        userId,
        code: (histRes.error as { code?: string }).code,
      });
    }
    summariesUsed = usageRes.data?.count ?? 0;
    historyUsed = histRes.count ?? 0;
  }

  return Response.json({
    tier: "free",
    caps: {
      summariesUsed,
      summariesLimit: FREE_LIMITS.summariesPerMonth,
      historyUsed,
      historyLimit: FREE_LIMITS.historyItems,
    },
  });
}
