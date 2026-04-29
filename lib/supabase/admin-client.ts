import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export class NotAdminError extends Error {
  constructor(reason: string) {
    super(`forbidden: ${reason}`);
    this.name = "NotAdminError";
  }
}

export class AdminClientUnavailableError extends Error {
  constructor(reason: string) {
    super(`admin client unavailable: ${reason}`);
    this.name = "AdminClientUnavailableError";
  }
}

export function parseAdminAllowlist(envValue: string | undefined): Set<string> {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(
  user: Pick<User, "email"> | null | undefined,
  allowlist: Set<string>,
): boolean {
  if (!user?.email) return false;
  return allowlist.has(user.email.toLowerCase());
}

export function requireAdmin(
  user: Pick<User, "email"> | null | undefined,
  allowlist: Set<string>,
): asserts user is Pick<User, "email"> {
  if (!user) throw new NotAdminError("not authenticated");
  if (!user.email) throw new NotAdminError("user has no email");
  if (!allowlist.has(user.email.toLowerCase())) {
    throw new NotAdminError("email not in admin allowlist");
  }
}

let cachedClient: SupabaseClient | null = null;
let cachedEnvSignature: string | null = null;

export function __resetForTests(): void {
  cachedClient = null;
  cachedEnvSignature = null;
}

function getOrCreateServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) {
    throw new AdminClientUnavailableError("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!key) {
    throw new AdminClientUnavailableError("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const sig = `${url}|${key}`;
  if (cachedClient && cachedEnvSignature === sig) {
    return cachedClient;
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedEnvSignature = sig;
  return cachedClient;
}

/**
 * The only exported way to get a service-role Supabase client.
 *
 * Throws NotAdminError if user is not in the allowlist.
 * Throws AdminClientUnavailableError if env vars are missing.
 *
 * Caller must already hold a verified user (from auth.getUser() on a
 * cookie-bound anon client) and the parsed allowlist Set.
 */
export function requireAdminClient(
  user: Pick<User, "email"> | null | undefined,
  allowlist: Set<string>,
): SupabaseClient {
  requireAdmin(user, allowlist);
  return getOrCreateServiceRoleClient();
}
