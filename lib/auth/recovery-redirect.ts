// Builds the redirectTo passed to supabase.auth.resetPasswordForEmail so
// that the link in the recovery email lands users on the update-password
// form instead of dropping them on the home page.
//
// Why the canonicalization matters: Supabase Auth's redirect-URL allowlist
// is exact-match (or wildcard via the dashboard's `/**` suffix). For this
// project, the apex origin https://youtubeai.chat carries the wildcard, so
// /auth/callback?next=/auth/update-password is accepted. The www origin
// only has an exact entry for /auth/callback (no query), so any www-based
// URL with a `?next=` suffix is silently rejected and Supabase falls back
// to the Site URL — which is the apex root and has no path, so the user
// ends up logged in on "/" with no path back to the recovery form.
//
// Routing through /auth/callback (rather than directly /auth/update-password)
// is also required: the verify endpoint appends `?code=` for the PKCE flow,
// and only the existing /auth/callback route handler exchanges that code
// for a session before redirecting to `next`.
//
// The allowlist itself is configured in the Supabase Auth dashboard
// (Auth → URL Configuration), outside this repo. If that config changes —
// e.g. the www origin gains a `/**` wildcard, or the apex wildcard is
// removed — the canonicalization here becomes redundant or wrong, and this
// helper can be retired or rewritten. The fix lives in code rather than
// only in the dashboard so the canonical contract ships with the frontend
// and isn't silently regressed by a config edit on a quiet afternoon.
export function buildRecoveryRedirectUrl(origin: string): string {
  const canonicalOrigin = origin.replace(/^(https?:\/\/)www\./i, "$1");
  return `${canonicalOrigin}/auth/callback?next=/auth/update-password`;
}
