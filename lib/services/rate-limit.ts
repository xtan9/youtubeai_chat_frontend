import { createClient } from "@supabase/supabase-js";

export const RATE_LIMITS = {
  anonymous: 10,
  authenticated: 30,
} as const;

export function getWindowStart(date: Date): Date {
  const floored = new Date(date);
  floored.setSeconds(0, 0);
  return floored;
}

/**
 * Atomically increment the per-user request count in the current minute window
 * and return whether the request is allowed.
 *
 * Uses an `increment_rate_limit` Postgres RPC that does INSERT ... ON CONFLICT ...
 * RETURNING, so two concurrent requests cannot both read the same count and
 * double-increment past the limit.
 *
 * Fails open (allows the request) if:
 *   - Supabase service-role credentials are not configured (dev/CI)
 *   - The RPC call throws (we'd rather let the user through than 500)
 */
export async function checkRateLimit(
  userId: string,
  isAnonymous: boolean
): Promise<{ allowed: boolean; remaining: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const limit = isAnonymous ? RATE_LIMITS.anonymous : RATE_LIMITS.authenticated;

  if (!supabaseUrl || !serviceRoleKey) {
    return { allowed: true, remaining: limit };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const windowStart = getWindowStart(new Date()).toISOString();

  try {
    const { data, error } = await supabase.rpc("increment_rate_limit", {
      p_user_id: userId,
      p_window_start: windowStart,
    });

    if (error) {
      console.error("[rate-limit] RPC error (fail-open)", {
        userId,
        isAnonymous,
        error,
      });
      return { allowed: true, remaining: limit };
    }

    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[rate-limit] RPC returned non-numeric count (fail-open)", {
        userId,
        data,
      });
      return { allowed: true, remaining: limit };
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  } catch (err) {
    console.error("[rate-limit] unexpected error (fail-open)", {
      userId,
      isAnonymous,
      err,
    });
    return { allowed: true, remaining: limit };
  }
}
