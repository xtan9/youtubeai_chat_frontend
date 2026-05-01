# Paywall smoke test — 100% off coupon

End-to-end smoke test for the Stripe-backed paywall (`/pricing` → checkout
→ webhook → `tier=pro` → `/account` → Stripe portal). Costs nothing
because the coupon makes the charge $0.00.

The admin-comped Pro account on file (e.g. `steventanxd@gmail.com`) cannot
exercise the Stripe portal because its `stripe_customer_id` is synthetic
(`cus_admin_*`). Use this runbook with a friend's account to verify the
real flow.

## Prerequisites

- A Stripe Dashboard account with access to coupons and promotion codes
  (https://dashboard.stripe.com/coupons).
- A test user that is **email-verified and not anonymous**. Anonymous
  Supabase users are rejected by `/api/billing/checkout`. Sign up via
  Google or complete the email-confirmation step first.
- Checkout already accepts promotion codes: `app/api/billing/checkout/route.ts`
  sets `allow_promotion_codes: true`. No code change required.

## 1. Create the coupon

Stripe Dashboard → **Products → Coupons → + New**
(https://dashboard.stripe.com/coupons).

- **Type:** Percentage discount
- **Percent off:** `100`
- **Duration:**
  - **Once** for the **monthly** plan — one $0 invoice, simplest cleanup.
  - **Forever** for the **yearly** plan — otherwise the renewal 12 months
    later charges full price if the friend forgets to cancel.
- **ID:** something memorable like `smoke_100`.
- **Name (internal):** "Smoke test 100% off".

## 2. Create a promotion code

Same coupon page → **+ Add promotion code**
(or https://dashboard.stripe.com/promotion-codes).

- **Code:** easy to type, e.g. `SMOKE100`.
- **Restrictions (recommended):** tick **Limit redemptions to 1** and set
  an **expires at** of ~24h. Belt and braces in case the code leaks.

## 3. Run the flow

Friend signs in at https://www.youtubeai.chat, then:

1. Go to `/pricing`.
2. Click Subscribe on Monthly (easier to clean up) or Yearly.
3. On Stripe Checkout, click **Add promotion code** → enter `SMOKE100`.
4. Total drops to **$0.00**.
5. Enter a real card. Stripe requires one even for $0 subscriptions; no
   charge is made.
6. Click **Subscribe**.

## 4. Verify the flow worked

- **Stripe Dashboard → Customers** — the friend's customer exists with
  subscription `active` and a $0.00 invoice.
- **Supabase `user_subscriptions`** — friend's row has `tier='pro'`,
  a real `stripe_customer_id` (NOT `cus_admin_*`), and a real
  `stripe_subscription_id`.
- **Friend's `/account` page** — shows **Pro plan**, the correct billing
  cadence, real renewal date, and a working **Manage subscription**
  button.
- **Manage subscription click** — Stripe Customer Portal opens (this is
  the bit the admin-comped Steven account cannot test).

## 5. Clean up

Pick one:

- **Friend cancels from portal.** Click Manage subscription on
  `/account` → Cancel subscription. Subscription stays Pro until
  `current_period_end`, then webhook flips them to Free. Most realistic.
- **Cancel immediately from dashboard.** Stripe Dashboard → Customers →
  friend's customer → Subscriptions → Cancel immediately. Webhook fires
  same way.

Then disable or delete the promo code so it can't be reused.

## Gotchas

- **Anonymous Supabase users.** `/api/billing/checkout` returns 401 for
  `is_anonymous=true`. Make sure the friend signed up properly.
- **Yearly + Once duration.** A 100% off "Once" coupon on the yearly
  plan only discounts the first invoice — the next renewal in 12 months
  charges full price. Use Forever, or cancel before the year is up.
- **Webhook lag.** After Subscribe, the friend may briefly land on
  `/billing/success` while the webhook still flips `tier`. The page
  polls `/api/me/entitlements` until `tier='pro'`.
- **Real card required.** Stripe Checkout will not accept the test card
  `4242 4242 4242 4242` in production mode. The friend must use a real
  card; nothing is charged.

## Free alternatives

- **Stripe test mode** — swap `STRIPE_SECRET_KEY` /
  `STRIPE_PUBLISHABLE_KEY` / price IDs for the test-mode equivalents
  on a preview deploy or local, use card `4242 4242 4242 4242`. Cleanest
  if you want to iterate on the flow without touching production state.
- **Trial period** — set `subscription_data: { trial_period_days: 3 }`
  in `app/api/billing/checkout/route.ts`. Friend enters a real card,
  is charged $0 today, has 3 days as Pro, cancels before day 3.
  Requires a code change.
