# Paywall — design

**Status:** approved (brainstorming → writing-plans handoff)
**Date:** 2026-04-29
**Scope:** Add a freemium subscription paywall over the existing app. Free users keep using the product with caps. Paid users (Pro) get unlimited summaries, chat, and history. Payments via Stripe.

## Why

The app today gives every visitor unlimited use of features that cost real money to serve (Whisper transcription on caption-less videos, Claude summarization, per-message LLM chat with cached transcript context). There is no monetization. We need a paywall before usage growth turns into unbounded cost, and to validate willingness-to-pay early.

## Goal

A working freemium subscription with:

1. **Tiered access** enforced server-side on every metered action (summarize, chat send), with a clear free tier and a single Pro tier.
2. **Stripe Checkout + Customer Portal** for purchase, cancel, and self-service plan management.
3. **Webhook-driven entitlement state** in Supabase as the single source of truth.
4. **Paywall surfaces** in the UI that nudge upgrade at the right moments without breaking the existing UX.

Out of scope for v1: long-video tier, premium model selector, exports (markdown/PDF), team plans, B2B invoicing, credit packs, reverse trials, automatic refunds, multi-currency display, regional pricing.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Freemium subscription, not credits/PAYG | Predictable revenue; aligns with category norms (Eightify, NoteGPT). Simpler to build. |
| 2 | Pricing: **$4.99/mo billed yearly** ($59.88/yr) and **$6.99/mo monthly** | Undercuts Eightify (~$10) and NoteGPT (~$9). Lower price → better conversion at our brand stage. Easier to raise later than lower. |
| 3 | Free tier: 10 summaries/month, 5 chat per video, 10 history items (FIFO eviction) | Caps the unbounded-cost feature (chat) while still letting users feel the product. Matches NoteGPT-class generosity. |
| 4 | Anonymous tier: ~1 lifetime summary per browser (cookie). No history. No chat. **Soft gate:** clearing cookies resets the count; this is a nudge, not a security control. | Keeps the homepage demo for SEO/landing. Forces signup quickly so we can email-nurture. Same fail-open philosophy as `rate-limit.ts`. |
| 5 | Pro v1 = unlimited summaries + unlimited chat + unlimited history. Nothing else. | Smallest viable paid tier. Long-video, premium model, exports are explicit phase-2 candidates. |
| 6 | **Stripe** as payment provider (not Paddle/LemonSqueezy) | User preference: most popular, best-documented, most flexible. Tradeoff acknowledged: we're merchant of record for tax. |
| 7 | No free trial of Pro (Stripe-managed paid trial nor reverse trial) | Free tier already serves as ongoing trial. Adding a trial mechanism is engineering cost without a clear conversion lift in our shape. |
| 8 | Cancel = `cancel_at_period_end`. No prorated refunds. | Standard SaaS expectation. Stripe handles natively. Manual refunds via Dashboard if needed. |
| 9 | 3-day grace period on `past_due` before downgrading | Matches Stripe's default retry cadence; prevents single failed renewal from bouncing paying users. |
| 10 | Webhook is the **only** writer of `user_subscriptions.tier`. Frontend never trusts checkout-redirect state. | Removes an entire class of race-condition bugs. |
| 11 | Anon counter does **not** migrate to a new account on signup | Prevents quota-merge gaming. Anon is a demo, not an account. |
| 12 | Per-minute rate limit (existing) stays. Entitlement check is a new, independent layer. | Two different concerns: rate limit = abuse wall; entitlement = business wall. Don't conflate. |

## Architecture

### Two new layers, three new endpoints

```
                              ┌──────────────────────────────┐
   /api/summarize/stream ─►   │  checkRateLimit (existing)   │
   /api/chat/stream     ─►    │  checkEntitlement (NEW)      │  ─► run LLM
                              └──────────────────────────────┘

   /api/billing/checkout      Creates Stripe Checkout Session, returns URL
   /api/billing/portal        Creates Stripe Billing Portal Session, returns URL
   /api/webhooks/stripe       Stripe → us. Source of truth for tier state.
   /api/me/entitlements       GET — returns current tier + caps for the UI
```

The entitlement service lives at `lib/services/entitlements.ts` and mirrors the shape of `lib/services/rate-limit.ts` — same fail-open philosophy, same observability story.

### Tier derivation (single function)

```
tier = 'pro' if status in ('active', 'trialing') AND current_period_end > now()
        OR  if status == 'past_due' AND current_period_end > now() - 3 days
       else 'free'
```

Recomputed on every webhook event and stored denormalized on `user_subscriptions.tier` for fast reads. The request path never has to compute tier — it just reads the column.

### Source of truth

| State | Owner | Read by |
|---|---|---|
| Subscription tier / status / period end | Stripe webhook → `user_subscriptions` | Entitlement service, UI |
| Monthly summary count | `monthly_summary_usage` (RPC-incremented) | Entitlement service |
| Per-video chat count | Existing `chat_messages` (counted, not denormalized) | Entitlement service, chat UI |
| Per-user history count | Existing `user_video_history` (counted; FIFO eviction in app) | Entitlement service, history UI |
| Anon lifetime count | `anon_summary_quota` keyed on cookie UUID | Entitlement service |

## Database

### New tables

**`user_subscriptions`** — one row per user, created lazily on first checkout. Webhook is the only writer.

```
user_id                uuid          PK, FK auth.users(id)
stripe_customer_id     text          UNIQUE NOT NULL
stripe_subscription_id text          UNIQUE        -- null while user is free
tier                   text          NOT NULL DEFAULT 'free'   -- 'free' | 'pro'
plan                   text                        -- 'monthly' | 'yearly' | null
status                 text                        -- stripe sub status verbatim
current_period_end     timestamptz                 -- pro entitlement expires here
cancel_at_period_end   boolean       NOT NULL DEFAULT false
updated_at             timestamptz   NOT NULL DEFAULT now()
```

RLS: user can `SELECT` their own row. Service role writes.

**`monthly_summary_usage`** — per-user monthly counter; mirrors `rate_limits` shape.

```
user_id    uuid  NOT NULL
year_month text  NOT NULL          -- e.g. '2026-04', computed in UTC
count      int   NOT NULL DEFAULT 0
PRIMARY KEY (user_id, year_month)
```

RPC: `increment_monthly_summary(p_user_id, p_year_month)` returning the new count. Same `INSERT ... ON CONFLICT ... RETURNING` pattern as `increment_rate_limit`. RLS: user can `SELECT` their own rows; service role increments. **Reset boundary is UTC midnight on the 1st of each month.** A user near the date line may see reset shifted from their local clock; acceptable for v1.

**`anon_summary_quota`** — lifetime counter for anonymous browsers.

```
anon_id      uuid         PK     -- from signed cookie
count        int          NOT NULL DEFAULT 0
created_at   timestamptz  NOT NULL DEFAULT now()
last_used_at timestamptz  NOT NULL DEFAULT now()
```

No FK. Periodic GC: delete rows where `last_used_at < now() - interval '90 days'`. Fail-open if missing.

**`stripe_webhook_events`** — idempotency guard.

```
event_id    text         PK
received_at timestamptz  NOT NULL DEFAULT now()
```

`INSERT ... ON CONFLICT DO NOTHING`; conflict means already processed → return 200 immediately.

### No new tables for chat/history caps

- **Per-video chat count** is derived: `SELECT count(*) FROM chat_messages WHERE summary_id = $1 AND user_id = $2 AND role = 'user'`. Indexed on `(summary_id, user_id)` already.
- **History count + FIFO eviction** uses existing `user_video_history`. On insert: if user is `tier='free'` and existing row count is `>= 10`, delete the oldest by `accessed_at` in the same transaction.

### Migrations

All applied via the `Database Migration` GitHub Action only.

```
20260429xxxxxx_user_subscriptions.sql
20260429xxxxxx_monthly_summary_usage.sql        -- table + RPC + grants
20260429xxxxxx_anon_summary_quota.sql
20260429xxxxxx_stripe_webhook_events.sql
```

`migration-upgrade-test` job validates against the legacy fixture in CI.

## Entitlement service

`lib/services/entitlements.ts`. Same fail-open philosophy as `rate-limit.ts`.

```ts
type Entitlement =
  | { tier: 'anon'; allowed: boolean; remaining: number; reason: 'within_limit' | 'exceeded' | 'fail_open' }
  | { tier: 'free'; allowed: boolean; remaining: number; reason: 'within_limit' | 'exceeded' | 'fail_open' }
  | { tier: 'pro';  allowed: true;    remaining: number; reason: 'unlimited' };

checkSummaryEntitlement(userIdOrAnonId, isAnon): Promise<Entitlement>
checkChatEntitlement(userId, summaryId): Promise<Entitlement>
getUserTier(userId): Promise<'free' | 'pro'>            // cheap read of user_subscriptions.tier
```

Failure modes (all logged with stable `errorId`):
- Service-role creds missing → fail-open with `errorId: 'ENTITLEMENT_FAIL_OPEN_NO_CREDS'`
- RPC error → fail-open with `errorId: 'ENTITLEMENT_FAIL_OPEN_RPC'`
- Deploy-defect codes (`42883`, `42501`) → fail-open with `errorId: 'ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT'` (alertable)

## Stripe integration

### Stripe-side setup

One Product ("YouTube AI Chat Pro"), two Prices:
- `price_monthly` → $6.99/mo recurring
- `price_yearly` → $59.88/yr recurring

Test-mode and live-mode use different IDs. Env vars:

```
STRIPE_SECRET_KEY            # server only
STRIPE_WEBHOOK_SECRET        # server only, signature verification
STRIPE_PRICE_MONTHLY         # server only
STRIPE_PRICE_YEARLY          # server only
```

### `POST /api/billing/checkout`

Auth required (no anon). Body: `{ plan: 'monthly' | 'yearly' }`.

1. Look up `user_subscriptions` row. If absent, create Stripe Customer (`metadata.user_id = userId`) and insert row with `tier='free'`.
2. Create Checkout Session: `mode='subscription'`, the chosen price, `customer=stripe_customer_id`, `success_url=/billing/success`, `cancel_url=/pricing?canceled=1`, `client_reference_id=userId`, `metadata={user_id: userId}`.
3. Return `{ url }`. Frontend `window.location` to it.

### `POST /api/billing/portal`

Auth required, must have a `stripe_customer_id`. Creates a Billing Portal Session and returns the URL. Used for "Manage subscription / Cancel / Update card / Switch plan".

### `POST /api/webhooks/stripe`

Public endpoint. Signature-verified using `STRIPE_WEBHOOK_SECRET`. Idempotent via `stripe_webhook_events` table.

| Event | Action |
|---|---|
| `checkout.session.completed` | Pull `subscription`, write row with `tier='pro'`, `status`, `plan`, `current_period_end` |
| `customer.subscription.updated` | Re-derive tier from `status` + `current_period_end`; UPSERT all fields |
| `customer.subscription.deleted` | `tier='free'`, null `stripe_subscription_id`, keep `stripe_customer_id` |
| `invoice.payment_failed` | Log; no state change (Stripe retries → eventual `subscription.updated` to `past_due` then `unpaid`) |
| `invoice.paid` | No-op (covered by `subscription.updated`) |
| _all others_ | Return 200, no-op |

### `/billing/success` page

Polls `GET /api/me/entitlements` every 2s for up to 30s. On `tier=pro` → toast + redirect to `/`. On 30s timeout → friendly "still processing" message. Never trusts the redirect itself; the webhook is what flips the bit.

### Local development

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Test cards:
- `4242 4242 4242 4242` — happy path
- `4000 0000 0000 0341` — declines after subscribing (test `past_due` flow)

## Frontend surfaces

### 1. Summary cap (free user, 10/10 used)

Server returns `429 { error: 'free_quota_exceeded', limit: 10, period: 'month', upgradeUrl: '/pricing' }` before starting the LLM stream. Frontend renders an upgrade card in place of the summary panel:

> **You've used your 10 free summaries this month.**
> Upgrade to Pro for unlimited summaries, chat, and history.
> *[Upgrade — $4.99/mo]*  *[See plans]*
>
> Resets May 1.

### 2. Chat cap (free user, 5/5 messages on this video)

Inline banner above the input on the chat tab. Input disabled. Past messages stay visible. Below 3 messages used: silent. At 3+ used: subtle counter `"3 of 5 free messages used"` under the input.

> **You've used 5/5 free chat messages on this video.**
> *[Upgrade for unlimited chat — $4.99/mo]*

### 3. History page

Free user header: `"Showing 10 of 10 — older summaries auto-replaced. [Upgrade for unlimited history]"`. Eviction at write-time is silent (no popup); the next history visit is where context lives.

Anon user `/history`: empty state, not a 0/0 counter.

> **Save and revisit your summaries.**
> Sign up to keep a history of every video you've summarized.
> *[Sign up free]*

### 4. Anon summary cap (1/1 lifetime)

Inline message at the top of the homepage. URL input disabled.

> **Try unlimited free** — sign up to get 10 free summaries per month and our AI chat.
> *[Sign up free]*  *[I have an account]*

### 5. New routes/surfaces

- **`/pricing`** — public page. Two-column comparison Free vs Pro. CTA "Upgrade — $4.99/mo billed yearly" with monthly toggle. FAQ section (cancel anytime, what happens at period end, refund policy). Auth-aware: signed-in → POSTs `/api/billing/checkout`; anon → routed to signup with `redirect_to=/pricing?intent=upgrade`.
- **`/billing/success`** — post-checkout polling page (above).
- **`/billing/canceled`** — destination for Stripe's `cancel_url`. Plain "No worries — you're still on the free tier."
- **Manage subscription** — link in user dropdown, Pro users only. Calls `/api/billing/portal`.

### Entitlements hook

A single `useEntitlements()` hook (TanStack Query) replaces ad-hoc tier checks. Refetches on auth change and after `/billing/success`. Server source: `GET /api/me/entitlements` returning:

```ts
{
  tier: 'anon' | 'free' | 'pro',
  caps: {
    summariesUsed: 3, summariesLimit: 10,
    historyUsed: 7, historyLimit: 10,
  },
  subscription?: { plan, current_period_end, cancel_at_period_end }
}
```

Per-video chat usage is **not** in this payload — the chat tab counts locally via existing chat-messages query.

## Edge cases

### Race conditions

- **Concurrent summary submissions at 9/10:** `increment_monthly_summary` RPC is atomic. One request gets count=10, the other 11. Whichever returns >10 sees `allowed: false` and 429s. No double-spend.
- **Webhook lag after Checkout:** `/billing/success` polls until `tier=pro` (up to 30s). User never sees a stale "still on free" view.
- **Cancel mid-period:** `subscription.updated` arrives with `cancel_at_period_end=true, status='active'`. Tier stays `pro` until `current_period_end`. At expiry, Stripe sends `subscription.deleted` and tier flips to `free`. No background job needed.
- **Re-subscribe after cancel:** existing `stripe_customer_id` reused. Idempotent UPSERT.
- **Plan switch monthly ↔ yearly:** Stripe Customer Portal handles proration. We just write the new `plan` and `current_period_end`.

### Failure modes (fail-open philosophy from `rate-limit.ts`)

- Entitlement RPC errors / Supabase unreachable → `allowed: true, reason: 'fail_open'`. Better to briefly let a free user past the cap than 500 a paying customer.
- Webhook signature verification failure → 400, no action. Stripe retries.
- Webhook DB write failure → 500. Stripe retries (correct — we want it to retry).
- Stripe API down during Checkout → 503 with retry CTA. No server-side auto-retry (could create duplicate sessions).

All fail-open paths log with stable `errorId` for alerting.

### Anon → signed-up

Anon counter does not migrate. New free account starts at 0/10. Anon row orphaned, GC sweeps after 90 days.

### Refund policy

No automatic refunds in v1. Customer Portal allows self-service cancel (period-end). Manual refund requests via support email → Stripe Dashboard one-click. Documented in `/pricing` FAQ and Terms.

## Testing

### Unit (`vitest`)

- `lib/services/entitlements.ts` — full coverage: anon allowed/exceeded, free within/at-limit/exceeded, pro always allowed, fail-open paths. Mirror existing `rate-limit.test.ts` structure.
- `app/api/webhooks/stripe/route.ts` — fixture-driven, one fixture per event type. Idempotency test: replay same `event.id`, second is no-op.
- `app/api/billing/checkout/route.ts` — mocked Stripe SDK. Happy path, no-customer-yet branch, existing-customer branch, anon → 401.
- `app/api/billing/portal/route.ts` — mocked Stripe SDK. Pro user happy, free user without `stripe_customer_id` → 400.
- Cap-check integration in existing `summarize/stream` and `chat/stream` route tests — extend existing files; mock entitlement service the same way they mock `checkRateLimit`.

### Migrations

`migration-upgrade-test` (existing CI job) validates all four migrations apply cleanly on the legacy fixture.

### E2E (Playwright, against `pnpm dev`)

Stripe CLI listening on dev port for webhook delivery. Test creds at `~/.config/claude-test-creds/youtubeai.env`.

1. **Happy path purchase** — sign in, hit summary cap, click upgrade, complete Checkout (`4242…`), land on `/billing/success`, verify `tier=pro` via API, verify can summarize an 11th video.
2. **Cap hit, no purchase** — free user hits 10/10, sees upgrade card, dismisses, back to home with cap copy intact.
3. **Anon hits lifetime cap** — fresh browser context, summarize one video, attempt second → see "Sign up" wall.
4. **Pro user cancels** — Pro user → Manage → Stripe Portal cancel → return. Verify `cancel_at_period_end=true`, tier still `pro`, "Cancels on $DATE" copy shown.
5. **Pro chat unlimited** — Pro user sends >5 messages on one video; cap doesn't apply.

### Manual sanity (one-time, before flipping to live mode)

- Webhook signing secret rotation
- Live-mode price IDs match
- Stripe Tax decision documented (off for v1; revisit at threshold)
- Invoice email template / branding via Stripe Dashboard

## Phasing

The implementation plan will split into three phases, shipped together as one launch:

1. **Schema + entitlements + cap enforcement** — migrations, `lib/services/entitlements.ts`, integration into `summarize/stream` and `chat/stream`. Silent gate; no UI yet. Free users start hitting 429s.
2. **Stripe layer** — checkout, portal, webhook, `/billing/success`, `/billing/canceled`. Pro is reachable; subscription state syncs.
3. **Frontend surfaces** — `/pricing`, upgrade modals/cards on summary/chat/history pages, anon signup wall, manage-subscription link, `useEntitlements` hook.

Each phase is independently testable. Practically all three ship together to avoid showing free users a wall they can't pay through.

## Out of scope / deferred

- Long-video tier (Pro feature, phase 2 candidate)
- Premium model selector (Pro feature, phase 2 candidate)
- Exports — markdown/PDF (Pro feature, phase 2 candidate)
- Reverse trial (e.g. 7-day full Pro on signup)
- Credit packs / pay-as-you-go
- Team plans, B2B invoicing
- Automatic refunds
- Multi-currency display, regional pricing
- Stripe Tax (deferred; revisit at jurisdictional threshold)
- Email lifecycle nudges ("you've used 7/10 summaries", "renewal coming up") — deferred to a later phase
