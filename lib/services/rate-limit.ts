import { createClient } from "@supabase/supabase-js";

export const RATE_LIMITS = {
  anonymous: 10,
  authenticated: 30,
} as const;

/**
 * Floor a date to the start of its minute (the rate limit window).
 */
export function getWindowStart(date: Date): Date {
  const floored = new Date(date);
  floored.setSeconds(0, 0);
  return floored;
}

/**
 * Check if a user has exceeded their rate limit.
 * Atomically increments the counter and returns whether the request is allowed.
 * Uses a service-role Supabase client to bypass RLS.
 * Fails open (allows request) if service-role key is not configured.
 */
export async function checkRateLimit(
  userId: string,
  isAnonymous: boolean
): Promise<{ allowed: boolean; remaining: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { allowed: true, remaining: 999 };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const limit = isAnonymous ? RATE_LIMITS.anonymous : RATE_LIMITS.authenticated;
  const windowStart = getWindowStart(new Date()).toISOString();

  try {
    // Read current count for this window
    const { data: existing } = await supabase
      .from("rate_limits")
      .select("request_count")
      .eq("user_id", userId)
      .eq("window_start", windowStart)
      .maybeSingle();

    if (existing) {
      // Row exists — check if already at limit, otherwise increment
      if (existing.request_count >= limit) {
        return { allowed: false, remaining: 0 };
      }
      const newCount = existing.request_count + 1;
      await supabase
        .from("rate_limits")
        .update({ request_count: newCount })
        .eq("user_id", userId)
        .eq("window_start", windowStart);
      return {
        allowed: true,
        remaining: Math.max(0, limit - newCount),
      };
    }

    // No row yet — insert with count=1
    await supabase.from("rate_limits").insert({
      user_id: userId,
      window_start: windowStart,
      request_count: 1,
    });
    return { allowed: true, remaining: limit - 1 };
  } catch (err) {
    console.error("Rate limit check failed:", err);
    // Fail open on any error
    return { allowed: true, remaining: 999 };
  }
}
