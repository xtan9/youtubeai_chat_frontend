# Stripe payment E2E

The payment E2E proves that both paid plans work through the real hosted Stripe
Checkout flow without making a real charge. GitHub Actions runs the application
and a disposable Supabase stack locally, while Stripe Checkout and webhooks use
an isolated Stripe Sandbox. The suite creates disposable users and one-use
50%-off promotion codes, verifies the promotion and webhook-derived Pro
entitlement, checks the Account page and Billing Portal link, then removes all
test artifacts.

## Safety boundary

The runner fails before creating data unless all of these conditions hold:

- `PAYMENT_E2E_ENABLED` is exactly `1`.
- Stripe uses an `sk_test_...` Sandbox secret key.
- Stripe resolves that key to the explicitly configured Sandbox account ID.
- the configured monthly and yearly prices are active and recur every month and
  year respectively.
- the application runs at `http://127.0.0.1:3000`, never a production host.
- Supabase runs in disposable Docker containers on the GitHub runner, and its
  origin must differ from production.
- monthly and yearly use distinct Stripe `price_...` IDs.

The card number is Stripe's successful test card, `4242 4242 4242 4242`, with
a future expiry and any CVC. Stripe test mode does not move money.
Each journey creates its coupon and promotion code through the same Sandbox
used by Checkout. This specifically guards against configuring a code in one
Stripe environment while Checkout runs in another.

## One-time Stripe Sandbox setup

Create or select an isolated Stripe Sandbox. In that Sandbox:

- create monthly and yearly recurring prices that match the production plan
  cadence;
- configure the Billing Portal;
- copy the Sandbox `sk_test_...` secret key.

Do not register a public webhook endpoint. The workflow starts Stripe CLI
`listen` and forwards only the required signed Sandbox events to the local app.
Do not reuse live products, prices, or keys.

## GitHub Actions configuration

Add these repository variables from the selected Sandbox:

- `PAYMENT_E2E_STRIPE_PRICE_MONTHLY`
- `PAYMENT_E2E_STRIPE_PRICE_YEARLY`
- `PAYMENT_E2E_STRIPE_ACCOUNT_ID`

Add this repository secret:

- `PAYMENT_E2E_STRIPE_SECRET_KEY`

The workflow also reads the existing production `PROD_URL` variable and
`SUPABASE_URL` secret only to prove that the test targets are different. Those
production values are never sent to the browser and are never mutated.

No hosted Supabase staging project is required. `supabase start` creates the
local Auth, API, and Postgres services, applies every repository migration, and
exports short-lived local keys to subsequent steps. The workflow tears down the
containers without a backup on every outcome.

The `payment-e2e` workflow runs every Monday and Thursday at 16:37 UTC and can
also be dispatched manually. It runs one monthly promo-code journey and one
yearly promo-code journey with retries disabled. Failure traces, screenshots,
and video are retained for 14 days.

## Local execution

Local execution requires Docker, Supabase CLI, Stripe CLI, and the same Stripe
Sandbox settings. Start Supabase, forward Sandbox webhooks to
`http://127.0.0.1:3000/api/webhooks/stripe`, export the local Supabase values
shown by `supabase status -o env`, start the app, then run:

```bash
pnpm smoke:payment
```

The preflight is intentionally part of that command. Never bypass it or point
the spec at production. If teardown fails, the test fails and reports the
orphan risk; remove the randomized `payment-e2e-...@example.com` user and its
metadata-linked Stripe Sandbox customer before re-running.
