import { cookies } from "next/headers";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ANON_LIMITS,
  FREE_LIMITS,
  getYearMonthUtc,
  resolveRegisteredSubscription,
} from "@/lib/services/entitlements";
import { ANON_COOKIE_NAME, verifyAnonId } from "@/lib/services/anon-cookie";

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readAnonymousSummaryUsage(userId?: string): Promise<number> {
  const jar = await cookies();
  const cookieValue = jar.get(ANON_COOKIE_NAME)?.value ?? null;
  const anonId = cookieValue ? verifyAnonId(cookieValue) : null;
  if (!anonId) return 0;

  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[me/entitlements] service-role missing for anon read", {
        errorId: "ENTITLEMENTS_GET_FAIL_OPEN_NO_CREDS",
        ...(userId ? { userId } : {}),
      });
    }
    return 0;
  }

  const { data, error } = await supabase
    .from("anon_summary_quota")
    .select("count")
    .eq("anon_id", anonId)
    .maybeSingle();
  if (error) {
    console.error("[me/entitlements] anon_summary_quota read failed", {
      errorId: "ENTITLEMENTS_ANON_USAGE_READ_FAILED",
      ...(userId ? { userId } : {}),
      code: (error as { code?: string }).code,
    });
  }
  return data?.count ?? 0;
}

function anonymousResponse(summariesUsed: number) {
  return Response.json({
    tier: "anon",
    caps: {
      summariesUsed,
      summariesLimit: ANON_LIMITS.summariesLifetime,
    },
    subscriptionPresentation: { state: "anonymous" },
  });
}

export async function GET() {
  const principalResult = await resolveRequestPrincipal({
    source: "entitlements",
  });
  if (principalResult.kind === "unavailable") {
    return jsonError(503, "Auth service temporarily unavailable.");
  }

  if (principalResult.kind === "missing") {
    return anonymousResponse(await readAnonymousSummaryUsage());
  }

  const {
    userId,
    isAnonymous,
    smokeProEntitled,
  } = principalResult.principal;

  // Supabase anonymous users have a user ID but use the same cookie-keyed
  // lifetime allowance and presentation as visitors without a Supabase user.
  if (isAnonymous) {
    return anonymousResponse(await readAnonymousSummaryUsage(userId));
  }

  const subscriptionResult = await resolveRegisteredSubscription(
    userId,
    smokeProEntitled,
  );
  if (subscriptionResult.kind === "unavailable") {
    return jsonError(503, "Subscription details temporarily unavailable.");
  }

  const { tier, subscription, presentation } = subscriptionResult;

  if (tier === "pro") {
    return Response.json({
      tier,
      caps: {
        summariesUsed: 0,
        // `-1` is the unlimited sentinel for the wire format. JSON would
        // coerce the internal Infinity sentinel used by enforcement to null.
        summariesLimit: -1,
        historyUsed: 0,
        historyLimit: -1,
      },
      subscription,
      subscriptionPresentation: presentation,
    });
  }

  // Free access and Subscription presentation are deliberately independent:
  // a recoverable billing issue can coexist with Free caps after grace ends.
  let summariesUsed = 0;
  let historyUsed = 0;
  const supabase = getServiceRoleClient();
  if (supabase) {
    const yearMonth = getYearMonthUtc();
    const [usageResult, historyResult] = await Promise.all([
      supabase
        .from("monthly_summary_usage")
        .select("count")
        .eq("user_id", userId)
        .eq("year_month", yearMonth)
        .maybeSingle(),
      supabase
        .from("user_video_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);
    if (usageResult.error) {
      console.error("[me/entitlements] monthly_summary_usage read failed", {
        errorId: "ENTITLEMENTS_USAGE_READ_FAILED",
        userId,
        code: (usageResult.error as { code?: string }).code,
      });
    }
    if (historyResult.error) {
      console.error("[me/entitlements] user_video_history read failed", {
        errorId: "ENTITLEMENTS_HISTORY_READ_FAILED",
        userId,
        code: (historyResult.error as { code?: string }).code,
      });
    }
    summariesUsed = usageResult.data?.count ?? 0;
    historyUsed = historyResult.count ?? 0;
  } else if (process.env.NODE_ENV === "production") {
    console.error("[me/entitlements] service-role missing for usage read", {
      errorId: "ENTITLEMENTS_GET_FAIL_OPEN_NO_CREDS",
      userId,
    });
  }

  return Response.json({
    tier,
    caps: {
      summariesUsed,
      summariesLimit: FREE_LIMITS.summariesPerMonth,
      historyUsed,
      historyLimit: FREE_LIMITS.historyItems,
    },
    subscriptionPresentation: presentation,
  });
}
