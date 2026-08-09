/**
 * Keep the Supabase Auth cookie/storage key stable when the API hostname
 * changes (for example, from the project hostname to auth.youtubeai.chat).
 *
 * @supabase/supabase-js derives its default key from the first hostname
 * segment. Pinning the current project key prevents a branded-domain rollout
 * from stranding existing browser sessions and makes rollback reversible.
 */
export const DEFAULT_SUPABASE_AUTH_COOKIE_NAME =
  "sb-fzfgyeltcvnwmluqlwhn-auth-token";

export function getSupabaseAuthCookieName(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME?.trim() ||
    DEFAULT_SUPABASE_AUTH_COOKIE_NAME
  );
}

export function getSupabaseAuthCookieOptions() {
  return { name: getSupabaseAuthCookieName() };
}
