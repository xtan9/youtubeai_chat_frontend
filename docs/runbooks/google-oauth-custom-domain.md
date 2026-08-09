# Branded Google OAuth custom-domain rollout

This runbook covers the production-only work for issue #273. The repository
can preserve the application callback and browser sessions, but it cannot
activate a Supabase custom domain, edit DNS, change Google Auth Platform
branding, or rotate production secrets. Those steps require an authorized
maintainer for each external system.

## Current state and scope

The verified production Supabase project is:

```text
Project ref:       fzfgyeltcvnwmluqlwhn
Legacy API origin: https://fzfgyeltcvnwmluqlwhn.supabase.co
Target API origin: https://auth.youtubeai.chat
Application host:  https://youtubeai.chat
App callback:      https://youtubeai.chat/auth/callback
```

The target host is not active until the Supabase custom-domain and DNS work is
complete. At the time this runbook was written, `auth.youtubeai.chat` returned
NXDOMAIN and no repository or agent action had changed the external provider.

The application callback is already host-agnostic. Login and sign-up send the
browser to the app's `/auth/callback`, where the server exchanges the PKCE
code and returns the user to the app. The Supabase URL is read from
`NEXT_PUBLIC_SUPABASE_URL` by the browser, server, and proxy clients.

## Repository prerequisite

Supabase JS derives its default Auth storage key from the first hostname
segment. Changing the URL from `fzfgyeltcvnwmluqlwhn.supabase.co` to
`auth.youtubeai.chat` would otherwise change the cookie name from
`sb-fzfgyeltcvnwmluqlwhn-auth-token` to `sb-auth-auth-token`.

`lib/supabase/auth-cookie.ts` pins the current key and allows an explicit
`NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME` override for another Supabase project.
The browser client, server client, and Next proxy all pass that same name to
`@supabase/ssr`. Keep the value stable during both rollout and rollback.

Focused regression coverage is in
`lib/supabase/__tests__/auth-cookie-compatibility.test.ts`.

## External ownership and prerequisites

| Gate | Required authority | Evidence to record |
| --- | --- | --- |
| Supabase billing | Organization owner/admin; paid plan plus Custom Domain add-on | Add-on enabled for the YouTube Summary FE project |
| DNS | DNS zone maintainer for `youtubeai.chat` | CNAME and Supabase validation TXT records resolve publicly |
| Supabase domain | Supabase project Owner/Admin | Domain is verified, certificate is issued, and activation succeeded |
| Google branding | Google Cloud project editor/owner and Search Console verifier | YouTubeAI branding is verified and published |
| Production deploy | Vercel project maintainer | Production `NEXT_PUBLIC_SUPABASE_URL` and cookie name are set without exposing values |
| Smoke credentials | GitHub Actions/Supabase maintainer | Redacted production smoke evidence; never commit credentials or tokens |

Do not activate the custom domain until the old Google callback remains
configured and the new callback has been added. Supabase's default project
domain remains available for API requests after activation, but Supabase Auth
immediately advertises the custom host for OAuth. Keep the old callback as a
rollback configuration and verify it before activation; do not assume that
the old OAuth callback is a proven post-activation fallback.

## Rollout sequence

### 1. Prepare the repository deployment

1. Merge the repository change and deploy it while
   `NEXT_PUBLIC_SUPABASE_URL` still points at the legacy Supabase origin.
2. Set `NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME` explicitly in Vercel
   Production to `sb-fzfgyeltcvnwmluqlwhn-auth-token` (the code default is the
   same value). Set the same value in Preview environments that exercise the
   production project.
3. From a clean browser context, verify email/password login, logout, and
   password recovery still work. Confirm the browser cookie prefix is the
   pinned name; do not record its value or any token.

### 2. Configure Google Auth Platform branding

In the Google Cloud project's **Google Auth Platform → Branding** page:

1. Set the app name to **YouTubeAI** and upload the approved YouTubeAI logo.
2. Use these public app links (or the approved canonical equivalents):
   - Homepage: `https://youtubeai.chat`
   - Privacy policy: `https://youtubeai.chat/privacy`
   - Terms of service: `https://youtubeai.chat/terms`
3. Add and verify `youtubeai.chat` as an authorized domain in Google Search
   Console before adding origins or links. Include `www.youtubeai.chat` only
   if the production app intentionally serves it as a separate origin.
4. Submit branding verification and publish the verified branding. Google may
   require re-verification after changing the name, logo, links, redirect URIs,
   or origins.

In the existing Google OAuth web client, preserve the current redirect URI and
add the branded callback alongside it:

```text
https://fzfgyeltcvnwmluqlwhn.supabase.co/auth/v1/callback
https://auth.youtubeai.chat/auth/v1/callback
```

Do not replace or delete the legacy URI during rollout. Keep the existing
authorized JavaScript origins and add only the origins required by the
production app. Do not put the Google client secret in this repository.

### 3. Provision and verify the Supabase custom domain

Supabase documents custom domains as a paid add-on on a paid plan. The
following commands are examples; run them only with a maintainer's
authenticated Supabase CLI session, and discover flags with `--help` first:

```powershell
supabase domains create --project-ref fzfgyeltcvnwmluqlwhn --custom-hostname auth.youtubeai.chat
supabase domains reverify --project-ref fzfgyeltcvnwmluqlwhn
```

1. Add the returned CNAME target for `auth.youtubeai.chat` pointing to
   `fzfgyeltcvnwmluqlwhn.supabase.co.` with a low TTL.
2. Add every returned validation TXT record, normally under
   `_acme-challenge.auth.youtubeai.chat`. Trim surrounding whitespace only;
   never alter the token contents.
3. Reverify until DNS ownership and the TLS certificate are ready. Check the
   public CNAME/TXT records from more than one resolver and make an HTTPS
   request to the Auth settings endpoint without logging keys or response
   bodies.
4. Before activation, confirm both Google callbacks above are present and the
   application deployment from step 1 is healthy.
5. Activate only after the checks pass:

```powershell
supabase domains activate --project-ref fzfgyeltcvnwmluqlwhn
```

Supabase Auth starts advertising the custom callback as soon as activation
completes. The legacy project host remains available for API requests, but
OAuth integrations must already contain both callback URIs. The presence of
the old URI in Google Cloud is necessary for migration and rollback, not proof
that Google OAuth will continue to use it after activation.

### 4. Switch the production application origin

After the branded Auth endpoint responds successfully, update Vercel
Production's `NEXT_PUBLIC_SUPABASE_URL` to:

```text
https://auth.youtubeai.chat
```

Keep `NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME` at the pinned value and do not
rotate `NEXT_PUBLIC_SUPABASE_ANON_KEY` or the server-only secret key as part of
this change. Redeploy, then update the GitHub Actions `SUPABASE_URL` secret if
the production smoke helpers should exercise the branded origin; this is
optional while the legacy origin remains active but should be done before
claiming branded-flow verification.

## Verification evidence required before closing the issue

Run the repository checks first:

```powershell
corepack pnpm exec vitest run lib/supabase/__tests__/auth-cookie-compatibility.test.ts
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
```

After deployment, capture only redacted run IDs, timestamps, URLs, and
pass/fail outcomes:

1. In a clean desktop browser, start Google login and Google sign-up. The
   chooser/consent flow must show the verified YouTubeAI identity and the
   branded Supabase callback host; complete both flows and confirm the browser
   lands at the app callback and then an authenticated dashboard.
2. Repeat Google login and sign-up in a clean mobile browser context. Confirm
   a restart preserves the Remembered Session and sign-out clears it.
3. Verify email/password login and logout.
4. Verify password recovery through `/auth/forgot-password` and
   `/auth/update-password`, then sign in again with the restored password.
5. Confirm the pinned cookie name is still used after a refresh and after the
   Vercel deployment. Do not paste cookie values, access tokens, recovery
   links, or raw Auth logs into the issue.
6. Confirm the old Supabase callback remains configured while the evidence is
   collected. Only then can the issue's acceptance criteria be considered
   verified.

The existing production smoke workflow covers password login, signup, and
recovery with dedicated Smoke Accounts, but it does not prove a human Google
chooser's branding. A successful CI run is necessary evidence, not a
substitute for the desktop/mobile Google checks above.

## Rollback

If the branded flow fails, stop rollout and preserve evidence. Do not remove
the old Google callback URI. If possible, capture a successful legacy Google
login before activation; that is the known-good fallback evidence.

1. For an application-only regression, set Vercel Production
   `NEXT_PUBLIC_SUPABASE_URL` back to
   `https://fzfgyeltcvnwmluqlwhn.supabase.co` and redeploy. This restores the
   legacy API origin, but do not claim that Google OAuth is rolled back until
   the provider callback is tested.
2. If Google OAuth also needs to roll back after activation, first confirm the
   legacy URI is still configured in Google Cloud. With a Supabase Owner/Admin,
   use the supported Dashboard/CLI custom-domain deactivation or removal flow
   so Auth advertises the legacy host again, then verify a clean legacy Google
   login. Do not delete the DNS records first; keep them until the domain state
   and provider behavior are confirmed.
3. Leave `NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME` pinned to
   `sb-fzfgyeltcvnwmluqlwhn-auth-token`; changing it during rollback can strand
   sessions created by either hostname.
4. Re-run email/password and recovery checks, then the redacted production
   smoke workflow. Keep the custom domain and DNS records in place while
   investigating unless a Supabase owner explicitly approves deactivation.
5. Supabase warns that deleting an activated custom domain can affect OAuth or
   SAML integrations. Record the failing stage and provider evidence without
   exposing secrets, and do not remove the domain until the owner has approved
   that provider-impacting operation.

## External blocker status

This repository change does not claim live Google branding or a working
`auth.youtubeai.chat` endpoint. Those acceptance items remain blocked until an
authorized maintainer completes Supabase billing/custom-domain activation, DNS
verification, Google branding verification/publication, production env update,
and desktop/mobile evidence. See the official references:

- [Supabase Custom Domains](https://supabase.com/docs/guides/platform/custom-domains)
- [Supabase Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase custom-domain usage](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains)
- [Google Auth Platform branding](https://support.google.com/cloud/answer/15549049)
