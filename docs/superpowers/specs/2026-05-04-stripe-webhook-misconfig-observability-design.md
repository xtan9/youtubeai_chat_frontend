# Stripe webhook misconfig observability — design

**Status:** approved (brainstorming → /ship-it handoff)
**Date:** 2026-05-04
**Scope:** When `app/api/webhooks/stripe/route.ts` returns 503 because a required env var is missing, surface *which* component is missing in the response body so the misconfig is visible in the Stripe Dashboard's failed-event view.

## Why

On April 30, 2026, the Stripe production webhook started returning 503s to the Stripe Dashboard. Stripe sent us an alert email after 6 failed delivery attempts. Diagnosis:

- The 503 path at `route.ts:50` only fires when one of `STRIPE_WEBHOOK_SECRET`, `getStripe()`, or `getServiceRoleClient()` is null. Vercel `env ls` shows all four `STRIPE_*` env vars updated "3d ago" (≈April 30) — coincident with the first failure.
- Vercel does not auto-redeploy on env-var changes. The running deployment at the moment of the env update had stale (or missing) values for at least one of these, so subsequent webhook calls hit the 503 short-circuit until a new deploy picked up the values.
- A live probe of `https://www.youtubeai.chat/api/webhooks/stripe` with a fake `stripe-signature` header now returns `400 "Bad signature"`, confirming all env vars are present in the current production deploy. The webhook is healthy today.

The 6 already-lost events are out of scope for this change — they need a Stripe Dashboard "Resend" or a manual reconciliation pass.

The diagnostic took us several minutes of probing because the 503 response body just says `Service unavailable` with no detail. Stripe Dashboard surfaces the response body verbatim in the failed-event view; if it had said `missing STRIPE_WEBHOOK_SECRET`, we'd have known immediately. This change closes that observability gap so the next env-var rotation that causes a misconfig is debuggable in seconds, not minutes.

## Goal

Replace the static `Service unavailable` 503 body with a string that names the missing component(s):

- All present → existing behavior (no 503).
- One missing → `Service unavailable: missing STRIPE_WEBHOOK_SECRET`.
- Multiple missing → `Service unavailable: missing STRIPE_WEBHOOK_SECRET, STRIPE_API_CLIENT`.

The body lists the *component* names — `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_CLIENT`, `SUPABASE_SERVICE_ROLE` — not raw env-var names. This avoids leaking the exact env-var spelling externally and groups the Stripe API client under one logical name (it depends on `STRIPE_SECRET_KEY` but the failure mode is "Stripe SDK couldn't be constructed", not "exact var X is unset").

Status code stays 503. The Stripe-retry contract is preserved.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Surface missing components in the 503 body (not via a separate endpoint) | Stripe Dashboard shows the response body on failed events. Putting the diagnostic right where the operator sees the failure is the smallest change with the highest signal. |
| 2 | List component names, not env-var names | Each "component" maps to one operational concept (the Stripe webhook secret, the Stripe API client, the Supabase service-role client). Listing env-var names is leakier and noisier (e.g. a malformed `NEXT_PUBLIC_SUPABASE_URL` would surface as `SUPABASE_SERVICE_ROLE` failing — accurate at the right level of abstraction). |
| 3 | Keep status 503 | Stripe retries 5xx. We want retries during a misconfig window so the events aren't lost — they reprocess once env is fixed. |
| 4 | Keep the existing structured `console.error` log unchanged | Already includes `hasSecret/hasStripe/hasSr` booleans — sufficient for Vercel-side debugging. Don't double-write. |
| 5 | No new endpoint (no `/api/healthz/stripe`) | YAGNI. The 503-with-detail covers the diagnostic gap. A healthz endpoint is a separate idea worth its own brainstorm if/when needed. |
| 6 | No env-var validation at startup | Next.js serverless route handlers don't have a clean "startup" hook in this architecture. The lazy check at request time is correct; we're improving its observability, not relocating it. |

## File layout

Single-file change plus its test:

- `app/api/webhooks/stripe/route.ts` — rewrite the env-var preflight (lines 42–51).
- `app/api/webhooks/stripe/__tests__/route.test.ts` — add tests covering each missing-component permutation we care about.

No new files. No new dependencies.

## Behavior — before vs after

**Current** (`route.ts:42-51`):

```ts
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = getStripe();
const sr = getServiceRoleClient();
if (!secret || !stripe || !sr) {
  console.error("[stripe-webhook] not configured", {
    errorId: "WEBHOOK_NOT_CONFIGURED",
    hasSecret: !!secret, hasStripe: !!stripe, hasSr: !!sr,
  });
  return new Response("Service unavailable", { status: 503 });
}
```

**After:**

```ts
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = getStripe();
const sr = getServiceRoleClient();
if (!secret || !stripe || !sr) {
  const missing: string[] = [];
  if (!secret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!stripe) missing.push("STRIPE_API_CLIENT");
  if (!sr) missing.push("SUPABASE_SERVICE_ROLE");
  console.error("[stripe-webhook] not configured", {
    errorId: "WEBHOOK_NOT_CONFIGURED",
    hasSecret: !!secret, hasStripe: !!stripe, hasSr: !!sr,
    missing,
  });
  return new Response(
    `Service unavailable: missing ${missing.join(", ")}`,
    { status: 503 },
  );
}
```

The log line gains a `missing` array (handy when grepping Vercel logs) but its `errorId` and existing fields are unchanged — any existing alerting on `errorId: "WEBHOOK_NOT_CONFIGURED"` keeps working.

## Tests

Add to `app/api/webhooks/stripe/__tests__/route.test.ts`:

1. **`STRIPE_WEBHOOK_SECRET` missing** → POST returns 503 and body contains `STRIPE_WEBHOOK_SECRET`.
2. **Stripe client missing** (mock `getStripe` to return null) → 503 and body contains `STRIPE_API_CLIENT`.
3. **Service-role client missing** (mock `getServiceRoleClient` to return null) → 503 and body contains `SUPABASE_SERVICE_ROLE`.
4. **All three missing** → 503 and body contains all three component names in a single comma-separated list.

Existing tests covering the happy path and signature-failure path stay untouched.

## Verification beyond unit tests

This is a pure backend route change with no UI surface. The behavior under test (503 with named missing components) only fires when env is missing — which we cannot induce in a Playwright-style hit against deployed prod without breaking prod for real users. Unit tests with mocked `process.env` and mocked helpers are the appropriate verification level. The PR description will note this constraint.

A post-deploy sanity probe will confirm the regular path still works (a fake-signature POST to `/api/webhooks/stripe` should still return `400 "Bad signature"`, not 503) — same probe used during the original diagnostic.

## Out of scope

- The 6 already-lost Stripe events. Manual Dashboard "Resend" or one-off reconciliation script — handled separately as an operational task after this code lands.
- A `/api/healthz` or `/api/healthz/stripe` endpoint.
- Env-var validation at app startup.
- Changes to the dispatch logic, idempotency table, or any other webhook semantics.
- Stripe Dashboard / Vercel project configuration changes (cannot be made via code).

## Risk

Minimal. The change is additive on the failure path, preserves the response status code (503), preserves the structured log shape, and ships with explicit tests for each path. The only externally observable change is the response body string — a string Stripe shows back to operators in the Dashboard, never to end users.
