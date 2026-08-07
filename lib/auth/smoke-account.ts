import type { User } from "@supabase/supabase-js";

/**
 * Trusted, service-managed Auth metadata used to classify synthetic smoke
 * identities. Never derive this classification from user_metadata: users can
 * edit that field themselves.
 */
export const SMOKE_ACCOUNT_METADATA_KEY = "is_smoke_account" as const;
export const SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY =
  "smoke_entitlement" as const;

export function isSmokeAccount(
  user:
    | (Pick<User, "app_metadata"> & Partial<Pick<User, "user_metadata">>)
    | null
    | undefined,
): boolean {
  return user?.app_metadata?.[SMOKE_ACCOUNT_METADATA_KEY] === true;
}

/**
 * Internal entitlement for synthetic production checks. Both trusted Auth
 * application-metadata fields are required so a normal account can never
 * become Pro through user-editable metadata. This is deliberately separate
 * from user_subscriptions, whose tier remains owned exclusively by Stripe
 * webhooks.
 */
export function hasSmokeProEntitlement(
  user:
    | (Pick<User, "app_metadata"> & Partial<Pick<User, "user_metadata">>)
    | null
    | undefined,
): boolean {
  return (
    isSmokeAccount(user) &&
    user?.app_metadata?.[SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY] === "pro"
  );
}
