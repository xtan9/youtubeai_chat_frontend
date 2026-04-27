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
//    (#access_token=...&type=recovery), not a `?code=` query — verified
//    against this project's `auth.flow_state` rows: 13 recovery flows have
//    code_challenge stored but zero have auth_code_issued_at set, meaning
//    the verify path has never issued a PKCE auth code for recovery here.
//    Routing through /auth/callback would therefore be wrong: the handler
//    looks for ?code=, finds none, and 307s to /auth/auth-code-error (a
//    404). We point straight at /auth/update-password instead — the page is
//    statically prerendered, the browser supabase client in UserProvider
//    picks up the fragment on mount, fires PASSWORD_RECOVERY, and the form
//    is right there with an active session.
//
// The allowlist itself is configured in the Supabase Auth dashboard
// (Auth → URL Configuration), outside this repo. If that config changes —
// e.g. the www origin gains a `/**` wildcard, or recovery starts using PKCE
// (which would require a custom email template using {{ .TokenHash }} that
// routes through /auth/confirm) — this helper should be retired or
// rewritten. The fix lives in code rather than only in the dashboard so the
// canonical contract ships with the frontend and isn't silently regressed
// by a config edit on a quiet afternoon.
export function buildRecoveryRedirectUrl(origin: string): string {
  const canonicalOrigin = origin.replace(/^(https?:\/\/)www\./i, "$1");
  return `${canonicalOrigin}/auth/update-password`;
}
