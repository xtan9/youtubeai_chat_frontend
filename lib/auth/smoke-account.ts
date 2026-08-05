import type { User } from "@supabase/supabase-js";

/**
 * Trusted, service-managed Auth metadata used to classify synthetic smoke
 * identities. Never derive this classification from user_metadata: users can
 * edit that field themselves.
 */
export const SMOKE_ACCOUNT_METADATA_KEY = "is_smoke_account" as const;

export function isSmokeAccount(
  user:
    | (Pick<User, "app_metadata"> & Partial<Pick<User, "user_metadata">>)
    | null
    | undefined,
): boolean {
  return user?.app_metadata?.[SMOKE_ACCOUNT_METADATA_KEY] === true;
}
