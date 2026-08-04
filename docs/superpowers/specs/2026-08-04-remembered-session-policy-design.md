# Remembered session policy — design

**Status:** approved
**Date:** 2026-08-04
**Scope:** Keep Learners signed in across browser restarts and across devices until they deliberately end a session or a security event revokes it. Isolate production smoke tests from human accounts.

## Problem

Learners are being signed out even though the product does not need a short session lifetime. Investigation found that this is not normal access-token expiry:

- Supabase sessions are configured without a fixed `not_after` lifetime, and multiple sessions can coexist.
- The browser client uses Supabase's normal persisted-session and refresh-token behavior.
- The hourly production smoke workflow signs into the same account used by a person, exercises the UI's ordinary **Sign out** action, and the app currently calls `supabase.auth.signOut()` without a scope.
- Supabase treats an unscoped sign-out as global. Production Auth audit data showed recurring headless-browser logins and global logout events alongside the person's browser session.

The hourly smoke test therefore revokes the human browser's refresh token. The browser appears signed in until its current access token needs refreshing, then loses the session. The roughly one-hour access-token lifetime controls token rotation; it is not intended to be a one-hour Learner session.

## Goals

1. A Remembered Session survives access-token refreshes and browser restarts.
2. Signing in on another browser or device does not end existing Remembered Sessions.
3. Ordinary **Sign out** affects only the browser profile where it was selected.
4. Learners can deliberately **Sign out everywhere**.
5. Account Recovery preserves the recovery browser's new session and terminates older sessions.
6. Automated production checks never use a human account and never contaminate business analytics or real-user totals.

## Non-goals

- No inactivity timeout or fixed maximum session lifetime.
- No single-session-per-account restriction.
- No change to the normal Supabase JWT lifetime solely to make sessions feel longer.
- No fresh email OTP or other Identity Confirmation before billing or other account actions in this phase. A valid Remembered Session may open Stripe Customer Portal.
- No custom session store or replacement for Supabase Auth.

## Product policy

### Session persistence

A Learner may have independent Remembered Sessions in several browser profiles or devices. Each persists through browser restarts. Supabase rotates access and refresh tokens beneath this product concept; successful rotation must not be presented as a new login or logout.

A Remembered Session ends only through:

- Sign Out in that browser profile;
- Sign Out Everywhere for the account;
- completion of Account Recovery, for sessions that existed before recovery;
- administrative revocation; or
- invalidation required by the identity provider or Supabase Auth.

Hosted Auth settings must leave inactivity timeout, fixed session timebox, and single-session enforcement disabled. These settings should be checked during implementation and documented as an operational invariant.

### Termination matrix

| Event | Initiating browser | Other browser profiles and devices |
| --- | --- | --- |
| Browser closes or restarts | Remains signed in | Unchanged |
| Access token expires normally | Refreshes without user interruption | Unchanged |
| Sign in on a new browser | New Remembered Session begins | Existing sessions remain signed in |
| Sign Out | Current Remembered Session ends | Unchanged |
| Sign Out Everywhere | Current Remembered Session ends | All other refresh tokens are revoked |
| Account Recovery completes | Recovery session remains signed in | Every pre-existing refresh token is revoked |
| Administrative revocation | Ends according to the selected administrative scope | Ends according to the selected administrative scope |

Supabase revokes refresh tokens, not already-issued access tokens. Consequently, another browser affected by Sign Out Everywhere or Account Recovery can retain access until its current short-lived access token expires. The UI and tests must account for this platform behavior; immediate cross-device invalidation would require a separate server-side revocation design and is outside this phase.

## User experience

### Sign Out

Every existing ordinary **Sign out** control means “sign out of this browser.” This includes the header, account page, and admin top bar. The action should use local Supabase sign-out scope, clear the current browser's application identity, and route to the signed-out destination.

### Sign Out Everywhere

The account page gets a distinct **Sign out everywhere** action, visually and verbally separate from ordinary Sign Out. The action uses global Supabase sign-out scope and returns the initiating browser to the signed-out state. Copy should explain that other devices can remain active briefly until their current access tokens expire.

### Account Recovery

After a Learner follows the password-recovery link and successfully establishes a new password:

1. preserve the recovery browser's new Remembered Session;
2. revoke all other sessions using the Supabase “others” sign-out scope;
3. confirm that the password was changed and other devices were signed out.

If revoking the other sessions fails, recovery must not claim that all other devices were signed out. The password change may still succeed, but the UI must report the partial security failure and offer Sign Out Everywhere again.

## Smoke Account boundary

Production smoke tests require two dedicated identities:

- an admin Smoke Account for authenticated and admin flows;
- a non-admin Smoke Account for authorization-boundary checks.

Neither identity may be a founder, employee, customer, or other human's browsing account. Credentials remain in the existing protected CI secrets and must not appear in source, logs, screenshots, artifacts, or documentation.

Each Smoke Account is marked in trusted, service-managed identity data, such as `app_metadata.is_smoke_account = true`. User-editable metadata must not establish this classification. The marker has these consequences:

- the account still follows real authentication, product, authorization, and quota paths;
- the account is excluded from business analytics funnels, retention, conversion, and active-user metrics;
- the account is excluded from real-user totals in administrative and business reporting;
- operational smoke-test telemetry may retain a separate synthetic/test dimension;
- tests must not grant the account exceptions that would hide quota or authorization regressions.

The hourly workflow may keep its schedule. Tests should create isolated browser contexts and use local sign-out when a test needs to verify logout. Global cleanup is allowed only for a dedicated Smoke Account and must run after all parallel work using that identity has finished; it must never share credentials with a human session.

## Implementation direction

### Application sign-out behavior

Update the existing ordinary sign-out calls in:

- `app/components/header.tsx`;
- `app/account/AccountView.tsx`;
- `app/admin/_components/topbar.tsx`.

They should call `supabase.auth.signOut({ scope: "local" })`. Add the separate global action on the account page rather than overloading the existing label or behavior.

### Account Recovery

After the recovery flow successfully updates the password, call `supabase.auth.signOut({ scope: "others" })`. Preserve the current recovery session and provide distinct handling for password-update failure and other-session-revocation failure.

### Production smoke workflow

Replace `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` with credentials for a marked admin Smoke Account. Replace `TEST_NON_ADMIN_EMAIL` and `TEST_NON_ADMIN_PASSWORD` with credentials for a marked non-admin Smoke Account. The secret names can remain stable if rotating their values is operationally simpler, but their descriptions must say that personal accounts are forbidden.

The `login → logout round-trip` smoke test remains valuable once ordinary logout is local and the credentials are synthetic. It must verify the current context becomes unauthenticated without relying on or modifying a human session.

### Analytics and reporting

Use the trusted Smoke Account marker as the common exclusion predicate. Authenticated product-event capture should either suppress business events for Smoke Accounts or attach a durable synthetic marker that every canonical business query excludes. Real-user totals must apply the same predicate at their authoritative data source. Automatic anonymous events that occur before identity resolution must not be allowed to re-enter authenticated business funnels after the Smoke Account is identified.

This exclusion is a reporting rule, not an authorization role. It must not provide product access or weaken quotas.

## Acceptance criteria

### Session behavior

- A signed-in browser remains signed in after a browser restart.
- A session remains usable across at least two access-token refresh cycles without user interaction.
- Two independent browser contexts for the same Learner can remain signed in concurrently.
- Ordinary Sign Out in one context does not prevent the other context from refreshing its session.
- Sign Out Everywhere removes the initiating browser's session and prevents other contexts from refreshing after their current access tokens expire.
- Successful Account Recovery preserves the recovery context and prevents every older context from refreshing.
- The billing-portal action works with a valid Remembered Session and performs no added OTP challenge.

### Smoke isolation

- Scheduled production smoke runs use only the marked admin and non-admin Smoke Accounts.
- No CI secret used by production smoke belongs to a human account.
- The login/logout smoke verifies local logout.
- Smoke Accounts remain subject to the product flows, authorization checks, and quotas under test.
- Canonical business analytics and real-user totals exclude both Smoke Accounts.

### Regression coverage

- Unit tests assert local scope at all ordinary sign-out entry points.
- Unit tests cover the separate global action and its failure state.
- Recovery tests cover preserving the current session, revoking other sessions, and reporting partial failure.
- Playwright coverage uses two browser contexts to distinguish local sign-out from cross-device revocation.
- Smoke helper tests reject missing credentials and document that supplied credentials must be dedicated synthetic accounts.

## Rollout and verification

1. Provision and mark the two Smoke Accounts, then rotate the four GitHub Actions secrets away from all human identities.
2. Deploy local Sign Out, Sign Out Everywhere, and Account Recovery behavior with regression tests.
3. Verify hosted Supabase Auth has no inactivity timeout, fixed timebox, or single-session enforcement.
4. Run production smoke manually and confirm Auth audit events belong only to the marked Smoke Accounts.
5. Confirm a human browser remains signed in through the next scheduled hourly run and through normal token refresh.
6. Confirm analytics and administrative totals exclude the Smoke Accounts.

The credential rotation is the immediate incident containment step. It should happen before waiting for the application deployment because it stops the hourly workflow from revoking the human session.

## Deferred decision

Fresh Identity Confirmation for sensitive account actions was considered and deliberately deferred to keep this phase simple. If account risk or abuse later justifies it, it should be designed as a separate policy with explicit protected actions, proof methods, and freshness duration rather than added piecemeal.
