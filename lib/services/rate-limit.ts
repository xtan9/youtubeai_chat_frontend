import { getServiceRoleClient } from "@/lib/supabase/service-role";

export const RATE_LIMITS = {
  anonymous: 10,
  authenticated: 30,
} as const;

// Postgres error codes that indicate a broken deploy, not a transient blip.
// Keeping these distinct lets us page/alert on them even when the rest of the
// surface is fail-open.
const DEPLOY_DEFECT_CODES = new Set([
  "42883", // undefined_function - migration didn't run
  "42501", // insufficient_privilege - grant revoked
]);

export type UserTier = keyof typeof RATE_LIMITS;

// Discriminated on `reason` so callers can tell "user is genuinely within
// quota" from "we let this through because Supabase is down." Observability
// wants that distinction — a spike in `fail_open` is an outage, not traffic.
export type RateLimitResult =
  | {
      readonly allowed: true;
      readonly remaining: number;
      readonly reason: "within_limit" | "fail_open";
    }
  | {
      readonly allowed: false;
      readonly remaining: 0;
      readonly reason: "exceeded";
    };

export function getWindowStart(date: Date): Date {
  const floored = new Date(date);
  floored.setSeconds(0, 0);
  return floored;
}

/**
 * Atomically increments per-user request count in the current minute window.
 * Backed by `increment_rate_limit` (INSERT ... ON CONFLICT ... RETURNING), so
 * concurrent requests can't both read the same count and double-increment.
 *
 * Fail-open policy: we return `{allowed: true, reason: "fail_open"}` on
 * infrastructure errors because 500-ing a user over a rate-limit lookup is
 * worse UX than briefly allowing an extra request. But every fail-open path
 * logs AND tags the result so callers/dashboards can alert on the rate of
 * fail-open responses — a silent bypass would turn a misconfigured deploy
 * into unbounded cost with no signal.
 */
export async function checkRateLimit(
  userId: string,
  isAnonymous: boolean
): Promise<RateLimitResult> {
  const limit = isAnonymous ? RATE_LIMITS.anonymous : RATE_LIMITS.authenticated;
  const supabase = getServiceRoleClient();

  if (!supabase) {
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[rate-limit] service-role creds missing in production (fail-open — abuse wall disabled)",
        { errorId: "RATE_LIMIT_FAIL_OPEN_NO_CREDS", hasUrl, hasKey }
      );
    } else {
      console.warn("[rate-limit] service-role creds missing (fail-open)", {
        errorId: "RATE_LIMIT_FAIL_OPEN_NO_CREDS",
        hasUrl,
        hasKey,
      });
    }
    return { allowed: true, remaining: limit, reason: "fail_open" };
  }

  const windowStart = getWindowStart(new Date()).toISOString();

  try {
    const { data, error } = await supabase.rpc("increment_rate_limit", {
      p_user_id: userId,
      p_window_start: windowStart,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      if (code && DEPLOY_DEFECT_CODES.has(code)) {
        console.error(
          "[rate-limit] RPC returned deploy-defect code (fail-open — migration or grant is broken)",
          {
            errorId: "RATE_LIMIT_FAIL_OPEN_DEPLOY_DEFECT",
            userId,
            code,
            error,
          }
        );
      } else {
        console.error("[rate-limit] RPC error (fail-open)", {
          errorId: "RATE_LIMIT_FAIL_OPEN_RPC",
          userId,
          isAnonymous,
          error,
        });
      }
      return { allowed: true, remaining: limit, reason: "fail_open" };
    }

    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[rate-limit] RPC returned non-numeric count (fail-open)", {
        errorId: "RATE_LIMIT_FAIL_OPEN_BAD_DATA",
        userId,
        data,
      });
      return { allowed: true, remaining: limit, reason: "fail_open" };
    }

    if (count > limit) {
      return { allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[rate-limit] unexpected error (fail-open)", {
      errorId: "RATE_LIMIT_FAIL_OPEN_UNEXPECTED",
      userId,
      isAnonymous,
      err,
    });
    return { allowed: true, remaining: limit, reason: "fail_open" };
  }
}
