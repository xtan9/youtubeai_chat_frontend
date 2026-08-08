# Stripe payment E2E

The payment E2E proves that both paid plans work through the real hosted Stripe
Checkout flow without making a real charge. It creates disposable users and
test-mode subscriptions, verifies the Stripe webhook-derived Pro entitlement,
checks the Account page and Billing Portal link, then removes the Stripe and
Supabase artifacts.

## Safety boundary

The runner fails before creating data unless all of these conditions hold:

- `PAYMENT_E2E_ENABLED` is exactly `1`.
- Stripe uses an `sk_test_...` secret key.
- the application origin differs from production and is not
  `youtubeai.chat` or `www.youtubeai.chat`.
- the Supabase project origin differs from production.
- monthly and yearly use distinct Stripe `price_...` IDs.

The card number is Stripe's successful test card, `4242 4242 4242 4242`, with
a future expiry and any CVC. Stripe test mode does not move money.

## One-time staging setup

Use a stable staging deployment backed by a separate Supabase project. Apply
the repository migrations to that project. Configure the deployment with:

| Deployment variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Stable staging application origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging publishable key |
| `SUPABASE_SECRET_KEY` | Staging secret key, server-side only |
| `STRIPE_SECRET_KEY` | Stripe test-mode `sk_test_...` key |
| `STRIPE_PRICE_MONTHLY` | Test-mode monthly recurring price |
| `STRIPE_PRICE_YEARLY` | Test-mode yearly recurring price |
| `STRIPE_WEBHOOK_SECRET` | Secret for the staging webhook endpoint |
| `ANON_COOKIE_SECRET` | A separate 32+ character staging secret |

In Stripe test mode, register
`https://<staging-host>/api/webhooks/stripe` and subscribe it to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The Billing Portal must also be configured in Stripe test mode. Do not reuse
production products, prices, webhook secrets, or customer portal settings.

## GitHub Actions configuration

Add these repository variables:

- `PAYMENT_E2E_BASE_URL`
- `PAYMENT_E2E_STRIPE_PRICE_MONTHLY`
- `PAYMENT_E2E_STRIPE_PRICE_YEARLY`

Add these repository secrets:

- `PAYMENT_E2E_SUPABASE_URL`
- `PAYMENT_E2E_SUPABASE_SECRET_KEY`
- `PAYMENT_E2E_STRIPE_SECRET_KEY`

The workflow also reads the existing production `PROD_URL` variable and
`SUPABASE_URL` secret only to prove that the test targets are different. Those
production values are never sent to the browser and are never mutated.

The `payment-e2e` workflow runs every Monday and Thursday at 16:37 UTC and can
also be dispatched manually. It runs one monthly journey and one yearly journey
with retries disabled. Failure traces, screenshots, and video are retained for
14 days.

## Local execution

Set the same `PAYMENT_E2E_*` variables plus `PRODUCTION_BASE_URL` and
`PRODUCTION_SUPABASE_URL`, then run:

```bash
pnpm smoke:payment
```

The preflight is intentionally part of that command. Never bypass it to point
the spec at production. If teardown fails, the test fails and reports the
orphan risk; remove the randomized `payment-e2e-...@example.com` user and its
metadata-linked Stripe test customer before re-running.
