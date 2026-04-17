import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Single memoized service-role Supabase client shared across server modules.
 * Returns null when env vars are missing — callers decide between fail-open
 * and hard-fail based on their domain. In dev/CI the env may be absent; in
 * production a missing key is a deploy defect the caller should log loudly.
 */
export function getServiceRoleClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key);
  return cached;
}

export function __resetServiceRoleClientForTests(): void {
  cached = null;
}
