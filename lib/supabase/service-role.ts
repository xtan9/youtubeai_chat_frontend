import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Single memoized service-role Supabase client shared across server modules.
// Returns null when env vars are missing so each caller can choose its own
// fail-open vs hard-fail policy.
export function getServiceRoleClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  cached = createClient(url, key);
  return cached;
}

export function __resetServiceRoleClientForTests(): void {
  cached = null;
}
