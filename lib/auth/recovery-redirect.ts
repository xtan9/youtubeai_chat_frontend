// Builds the redirectTo passed to supabase.auth.resetPasswordForEmail so
// the link in the recovery email lands users on the update-password form.
//
// Two reasons the URL has to be exactly this shape:
//
// 1. Supabase Auth's redirect-URL allowlist is exact-match per entry (with
//    optional `/**` wildcard). For this project the apex origin
//    https://youtubeai.chat carries the wildcard, so any path under it is
//    accepted. The www origin only has a couple of exact entries (none of
//    which cover /auth/update-password). Passing the live www origin gets
//    silently rejected and Supabase falls back to the Site URL
//    (https://youtubeai.chat, no path) — that's why pre-fix users landed on
//    the home page after clicking the recovery link. Stripping `www.` here
//    keeps the URL inside the allowlisted apex.
//
// 2. The recovery email goes through Supabase's legacy verify endpoint and
//    arrives at the redirect target with the access token in a URL fragment
//    (#access_token=...&type=recovery), not a `?code=` query. Verified
//    empirically against `auth.flow_state` (snapshot during the PR #45 fix:
//    every recovery flow_state row had code_challenge stored but none had
//    auth_code_issued_at set — Supabase has not exchanged a PKCE code for
//    recovery in this project). To re-verify if this comment ages:
//      SELECT count(*) FILTER (WHERE auth_code_issued_at IS NOT NULL)
//      FROM auth.flow_state
//      WHERE authentication_method = 'recovery';
//    The result should remain 0 unless a custom recovery email template
//    using {{ .TokenHash }} is introduced. Routing through /auth/callback
//    would therefore be wrong: the handler looks for ?code=, finds none,
//    and 307s to /auth/auth-code-error (which is a 404 in app/auth/ —
//    confirmed via curl against prod). We point straight at
//    /auth/update-password instead. The page is statically prerendered;
//    `@supabase/ssr`'s createBrowserClient defaults to detectSessionInUrl
//    so the browser SDK parses the fragment on first load, establishes the
//    session, fires PASSWORD_RECOVERY, and the form on /auth/update-password
//    renders against that session. (UserProvider observes the resulting
//    session via onAuthStateChange — it does not parse the URL itself.)
//
// The allowlist itself is configured in the Supabase Auth dashboard
// (Auth → URL Configuration), outside this repo. Two independent triggers
// for retiring or rewriting this helper:
//   (a) the www origin gains a `/**` wildcard — apex canonicalization
//       becomes redundant (harmless, but the helper's first reason
//       disappears).
//   (b) Supabase Auth is reconfigured to use PKCE for recovery — typically
//       by adding a custom email template that uses {{ .TokenHash }} and
//       routes through app/auth/confirm/route.ts (which already exists for
//       sign-up confirmations). At that point routing through /auth/confirm
//       (or /auth/callback for ?code=) becomes the right answer.
// The fix lives in code rather than only in the dashboard so the canonical
// contract ships with the frontend and isn't silently regressed by a config
// edit on a quiet afternoon.
export function buildRecoveryRedirectUrl(origin: string): string {
  const canonicalOrigin = origin.replace(/^(https?:\/\/)www\./i, "$1");
  return `${canonicalOrigin}/auth/update-password`;
}

export type RecoveryTokens = {
  accessToken: string;
  refreshToken: string;
};

// Parses the URL hash that the legacy verify endpoint redirects with on
// password recovery: `#access_token=...&refresh_token=...&type=recovery&...`.
// Returns null when the hash is empty, missing tokens, or not a recovery
// fragment, so callers can no-op on every other navigation. We extract the
// tokens manually (and feed them to supabase.auth.setSession on the page)
// because @supabase/ssr's createBrowserClient defaults to flowType=pkce,
// which only auto-detects `?code=` query params — implicit-grant hashes
// pass through untouched and the user would otherwise sit on the
// update-password form without a session.
export function parseRecoveryFragment(
  hash: string
): RecoveryTokens | null {
  if (!hash || hash[0] !== "#") return null;
  const params = new URLSearchParams(hash.slice(1));
  if (params.get("type") !== "recovery") return null;
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}
