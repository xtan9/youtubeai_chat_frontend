import { getServiceRoleClient } from "@/lib/supabase/service-role";

export const FREE_LIMITS = {
  summariesPerMonth: 10,
  chatMessagesPerVideo: 5,
  historyItems: 10,
} as const;

export const ANON_LIMITS = {
  summariesLifetime: 1,
} as const;

// SQLSTATEs that mean "code shipped before its migration ran" rather than
// "the dependency itself is sick". 42883 = undefined_function (RPC missing),
// 42501 = insufficient_privilege (GRANT not applied yet). Tagged separately
// so the on-call dashboard can split deploy ordering bugs from real outages.
const DEPLOY_DEFECT_CODES = new Set(["42883", "42501"]);

export type EntitlementResult =
  | { readonly tier: "anon" | "free"; readonly allowed: true; readonly remaining: number; readonly reason: "within_limit" | "fail_open" }
  | { readonly tier: "anon" | "free"; readonly allowed: false; readonly remaining: 0; readonly reason: "exceeded" }
  | { readonly tier: "pro"; readonly allowed: true; readonly remaining: number; readonly reason: "unlimited" };

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

type CheckSummaryArgs =
  | { userId: string; isAnon: false }
  | { anonId: string; isAnon: true };

export async function checkSummaryEntitlement(
  args: CheckSummaryArgs
): Promise<EntitlementResult> {
  if (args.isAnon) {
    return checkAnonSummaryEntitlement(args.anonId);
  }
  return checkSignedInSummaryEntitlement(args.userId);
}

async function checkSignedInSummaryEntitlement(
  userId: string
): Promise<EntitlementResult> {
  const tier = await getUserTier(userId);
  if (tier === "pro") {
    return { tier: "pro", allowed: true, remaining: Number.POSITIVE_INFINITY, reason: "unlimited" };
  }

  const limit = FREE_LIMITS.summariesPerMonth;
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for summary check", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }

  const yearMonth = getYearMonthUtc();

  try {
    const { data, error } = await supabase.rpc("increment_monthly_summary", {
      p_user_id: userId,
      p_year_month: yearMonth,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      const tag = code && DEPLOY_DEFECT_CODES.has(code)
        ? "ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT"
        : "ENTITLEMENT_FAIL_OPEN_RPC";
      console.error("[entitlements] summary RPC error (fail-open)", {
        errorId: tag, userId, code, error,
      });
      return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
    }
    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[entitlements] summary RPC bad data (fail-open)", {
        errorId: "ENTITLEMENT_FAIL_OPEN_BAD_DATA", userId, data,
      });
      return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
    }
    if (count > limit) {
      return { tier: "free", allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      tier: "free",
      allowed: true,
      remaining: Math.max(0, limit - count),
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[entitlements] summary check threw (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_UNEXPECTED", userId, err,
    });
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }
}

async function checkAnonSummaryEntitlement(
  anonId: string
): Promise<EntitlementResult> {
  const limit = ANON_LIMITS.summariesLifetime;
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for anon check", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
  }

  try {
    const { data, error } = await supabase.rpc("increment_anon_summary_quota", {
      p_anon_id: anonId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      const tag = code && DEPLOY_DEFECT_CODES.has(code)
        ? "ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT"
        : "ENTITLEMENT_FAIL_OPEN_RPC";
      console.error("[entitlements] anon RPC error (fail-open)", {
        errorId: tag, anonId, code, error,
      });
      return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
    }
    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[entitlements] anon RPC bad data (fail-open)", {
        errorId: "ENTITLEMENT_FAIL_OPEN_BAD_DATA", anonId, data,
      });
      return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
    }
    if (count > limit) {
      return { tier: "anon", allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      tier: "anon",
      allowed: true,
      remaining: Math.max(0, limit - count),
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[entitlements] anon check threw (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_UNEXPECTED", anonId, err,
    });
    return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
  }
}

/**
 * Per-video chat cap. We query existing chat_messages rather than a
 * dedicated counter: row volume is bounded for free, and pro skips this
 * branch entirely. The (user_id, video_id, created_at) index makes this
 * an indexed range scan.
 *
 * NOTE on column choice: chat_messages.video_id (the videos.id UUID) is
 * the FK to videos. We count by video_id, not summary_id — chat is per-video
 * regardless of which summary language was generated, and chat_messages has
 * no summary_id column.
 *
 * NOTE on counting: this counts EXISTING messages — call this BEFORE writing
 * the new user message. count === 5 means "5 already exist, this would be
 * the 6th", which is the cap-hit case for free (limit is 5 user messages
 * per video; assistant messages are filtered out via .eq("role", "user")).
 */
export async function checkChatEntitlement(
  userId: string,
  videoId: string
): Promise<EntitlementResult> {
  const tier = await getUserTier(userId);
  if (tier === "pro") {
    return { tier: "pro", allowed: true, remaining: Number.POSITIVE_INFINITY, reason: "unlimited" };
  }

  const limit = FREE_LIMITS.chatMessagesPerVideo;
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for chat check", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }

  try {
    const { count, error } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("video_id", videoId)
      .eq("user_id", userId)
      .eq("role", "user");
    if (error) {
      const code = (error as { code?: string }).code;
      const tag = code && DEPLOY_DEFECT_CODES.has(code)
        ? "ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT"
        : "ENTITLEMENT_FAIL_OPEN_CHAT_COUNT";
      console.error("[entitlements] chat count error (fail-open)", {
        errorId: tag, userId, videoId, code,
      });
      return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
    }
    const used = count ?? 0;
    if (used >= limit) {
      return { tier: "free", allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      tier: "free",
      allowed: true,
      remaining: limit - used,
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[entitlements] chat check threw (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_UNEXPECTED", userId, videoId, err,
    });
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }
}
