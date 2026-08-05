# Production smoke session-policy runbook

This runbook maintains the two synthetic identities used by the hourly
production smoke workflow. It is deliberately credential-free: passwords,
service keys, recovery links, screenshots containing account data, and raw
Auth log payloads must never be committed, pasted into issues, or uploaded as
artifacts.

## Smoke Account invariant

Maintain exactly two dedicated accounts for this workflow:

- `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD`: one administrator Smoke Account.
- `TEST_NON_ADMIN_EMAIL` / `TEST_NON_ADMIN_PASSWORD`: one non-administrator
  Smoke Account.

Both accounts must have the trusted service-managed Auth application metadata
marker `app_metadata.is_smoke_account = true`. The administrator account must
remain in the production administrator allowlist; the non-administrator must
remain outside it. The marker is not user-editable metadata and does not grant
authorization, entitlements, or quota exceptions.

When provisioning or rotating an account:

1. Create or update it through the Supabase Auth administration surface using
   a maintainer session; do not put a password in source or a command line
   captured by shell history.
2. Set the trusted application marker and verify the resulting Auth user has
   the expected administrator status.
3. Update the four protected GitHub Actions secrets without displaying their
   values. Keep the secret descriptions explicit: dedicated synthetic Smoke
   Account only; personal, employee, customer, or other human accounts are
   forbidden.
4. Run the production smoke workflow manually once. Confirm the redacted
   session-policy evidence artifact reports all cases passed and password
   restoration completed.
5. Do not delete or rotate the other account in the same maintenance window;
   the next hourly run needs both identities available.

If either marker check fails, stop the workflow and repair the account before
retrying. Never weaken the marker guard to make a run pass.

## Workflow order and cadence

`.github/workflows/production-smoke.yml` keeps the hourly schedule at
`0 * * * *` and also supports `workflow_dispatch`. A run proceeds in this
order:

1. API smoke against the configured production URL.
2. Browser smoke cases that do not make a live Summary request, mutate a
   password, or revoke sessions.
3. The live Summary browser journeys in a dedicated no-retry phase. These
   journeys still exercise the production Summary, authorization, and quota
   paths, but any public terminal failure state ends the wait immediately.
4. One serial `e2e-auth-session-policy.spec.ts` journey against the deployed
   app and real Supabase Auth. It proves browser restart, repeated refresh,
   concurrent contexts, local Sign Out, Account Recovery, and Sign Out
   Everywhere in that order.

The session-policy journey runs in a downstream job with its own ten-minute
budget. It starts only after the browser-smoke job has stopped and the API job
has succeeded, including when a live Summary journey reports a real production
failure. This keeps account mutations from racing authenticated browser checks
without allowing a slow Summary provider or terminal Summary failure to starve
the session-policy evidence.

The journey verifies the trusted Smoke Account marker immediately before each
Auth password or logout mutation. Recovery uses the administrator account,
restores its original password in teardown, and global/local session checks
use the non-administrator account. The global action is the final mutation.

The `production-session-policy-evidence` artifact is a redacted manifest only;
it contains case names, marker-check booleans, cleanup state, URL, and no
credential or token. Keep it for the retention period and do not add raw
Playwright traces to a success evidence package.

## Manual production evidence

After a deployment that includes session-policy changes:

1. Record the GitHub Actions production-smoke run ID and its UTC start/end
   window. Run it from Actions with the normal `workflow_dispatch` control;
   do not invoke the test from a laptop with copied secrets.
2. In Supabase Dashboard, open the project Auth logs for that UTC window.
   Inspect password-update and logout mutations and compare their user IDs
   with the two Auth users whose trusted marker is set. Record only the run
   ID, UTC window, mutation categories, and a redacted pass/fail statement in
   the issue or release notes. Do not paste emails, passwords, tokens, or raw
   log rows.
3. Before the manual run, leave a human browser signed in to a normal
   authenticated page. After the manual run, reload that page and confirm it
   remains authenticated. Repeat the check after the next scheduled hourly
   run. A failure is an incident: stop further destructive smoke runs and
   investigate session revocation scope.

## Analytics and administrative reporting evidence

Smoke Accounts exercise the real product, authorization, and quota paths but
must not enter business measurements. For the manual run and the next hourly
run, record a redacted before/after check that:

- business analytics acquisition, activation, engagement, retention,
  conversion, and active-user totals do not increase from synthetic activity;
- the administrative real-user total excludes both Smoke Accounts; and
- administrative business-activity reports exclude their smoke activity while
  operational account lists, if viewed, label the accounts as synthetic.

Use the existing canonical analytics/reporting views and the administrator
report pages; do not infer business totals from Auth user counts. The
application-level tests for the analytics and report boundaries are required
CI evidence, while the before/after production check is operational evidence.
Record only aggregate counts and the run ID, never account credentials or raw
event payloads.

## Failure handling

A live Summary quota, authentication, rate-limit, request, network, processing,
or protocol state is a real production-smoke failure. The live Summary phase
must report it promptly, without retrying the full journey. Do not reset usage,
upgrade a Smoke Account, or add a quota exception merely to make the smoke run
green; any entitlement change requires a separate product or billing decision.

If a password restore, marker verification, or cleanup step fails, treat the
Smoke Account as not ready. Do not start the next hourly run until a maintainer
has verified the current password, trusted marker, administrator status, and
absence of unintended sessions through the protected Supabase/Auth surfaces.

If the production deployment or manual workflow is protected or unavailable,
leave the repository gates and workflow wiring intact and report the exact
missing deployment, Actions, or Supabase permission. Never claim production
evidence from a local or skipped Playwright run.
