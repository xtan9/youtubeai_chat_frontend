import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Service-role Supabase client for non-admin pipeline writes (cache,
// rate limits). Returns null when env is missing so each caller picks
// its own fail policy.
//
// Admin paths (anything that exposes service-role-scoped data to a
// logged-in admin user) MUST go through `lib/supabase/admin-client.ts`
// instead — that module gates the client behind `requireAdminClient`
// so a non-admin can't reach service-role queries by construction. This
// file's exit is ungated and exists for app-internal pipeline code paths
// unrelated to user identity.
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
