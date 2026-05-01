# Account page — design

**Status:** approved (brainstorming → writing-plans handoff)
**Date:** 2026-05-01
**Scope:** Add an `/account` page where signed-in users see their profile basics, plan, usage, and a single button into Stripe Customer Portal for managing or cancelling their subscription. Replace the current avatar-dropdown "Manage Subscription" item with an "Account" link.

## Why

Today the app has no first-class account surface. The avatar in the header is a static circle whose dropdown shows just "Manage Subscription" (Pro only) and "Sign Out". Free users have no way to see their plan or usage. Pro users have no way to see their renewal date or whether their subscription is set to cancel — only a buried link that bounces them to Stripe. Users have asked for a real way to manage and cancel their subscription, and the absence of any account page makes the product feel less trustworthy.

The backend pieces already exist: `/api/me/entitlements` returns tier, plan, period end, and `cancel_at_period_end`; `/api/billing/portal` issues a Stripe Customer Portal redirect. This spec adds only the missing UI surface.

## Goal

A single new route `/account` that:

1. Shows the signed-in user's email, current plan, and key plan metadata (renewal date for Pro; usage caps for Free).
2. Surfaces one primary action per tier: **Manage subscription** (Pro) → Stripe Customer Portal, or **Upgrade** (Free) → `/pricing`.
3. Includes a Sign Out button.
4. Is reachable from the avatar dropdown via a new "Account" link, replacing the current dropdown's "Manage Subscription" item (which moves onto the page).

Out of scope for this phase: editing display name, editing email, changing avatar, deleting account, in-app cancel UI, exporting data, multi-tab settings hub, notifications/preferences, output-language defaults, theme persistence beyond what already exists.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | URL is `/account` (not `/profile`, `/settings`) | "Account" reads as the umbrella; "profile" implies editable personal info we don't ship; "settings" implies preferences we don't ship. |
| 2 | Page renders for both Free and Pro signed-in users | Free users are the larger cohort and need a place to see their plan and upgrade. |
| 3 | Anonymous (signed-out OR `is_anonymous`) → redirect to `/auth/login?next=/account` | Page contains no demo value; consistent with how `/history` gates anon users today. |
| 4 | Cancel/manage flow stays in Stripe Customer Portal | Already wired up, PCI-compliant, handles proration/dunning/refunds. Building native cancel adds risk for no user benefit. |
| 5 | Avatar dropdown becomes: **Account** → `/account`, **Sign Out** | Single billing entry point. The "Manage Subscription" button lives on the page itself. |
| 6 | Server-rendered page for the static frame; client component for actions | Standard pattern in this repo (`app/history/`, `app/admin/`). SEO doesn't matter (private page) but SSR avoids a content-flash. |
| 7 | Use `useEntitlements` for tier-dependent content (no new server fetcher) | The hook already exists, has 30s staleTime and refetch-on-focus, and is the single source of truth for paywall surfaces. |
| 8 | No new API routes | `/api/me/entitlements` and `/api/billing/portal` cover everything. |
| 9 | Reuse `ManageSubscriptionLink` component but render it as a primary button on the page (not a dropdown row) | Same fetch/redirect logic; styling is the only difference. Extract a shared hook or accept a `variant` prop — implementation choice deferred to plan. |
| 10 | Show `cancel_at_period_end` state explicitly with a banner: "Your subscription is set to end on Mon, May 31. Resume in Stripe portal." | Currently invisible to the user — a real risk: a user thinks they cancelled and keeps using the app, then gets locked out without warning. |

## UX

### Page sections (top-to-bottom, single column, max-w-prose)

1. **Header** — `text-h2`: "Account"
2. **Profile card** (`bg-surface-raised`, `border-border-subtle`):
   - Avatar (existing `ProfileAvatar` component)
   - Display name (from `user_metadata.full_name`, fallback to email-prefix — same logic as `ProfileAvatar`)
   - Email (`text-text-muted`)
3. **Plan card**:
   - **Pro**:
     - Heading: "Pro plan" (`text-h3`)
     - Plan period: "Billed yearly" or "Billed monthly" (from `subscription.plan`)
     - Renewal line: "Renews on Mon, May 31" (from `subscription.current_period_end`)
     - **If `cancel_at_period_end`**: warning banner using `bg-state-warning` or `border-accent-warning`: "Your subscription will end on Mon, May 31. You can resume it from the billing portal."
     - Primary button: "Manage subscription" → opens Stripe Customer Portal
   - **Free**:
     - Heading: "Free plan"
     - Usage line: "10 of 10 summaries used this month" (from caps)
     - Secondary line: "5 of 10 saved videos in history" (if `historyUsed/historyLimit` provided)
     - Primary button: "Upgrade to Pro" → `/pricing` (same CTA target as `UpgradeCard`)
4. **Sign Out** — secondary button, `Button variant="outline"`, calls `supabase.auth.signOut()` then routes to `/`.

### Header dropdown change

Current `app/components/header.tsx` dropdown:
```
- Manage Subscription   (Pro only)
- Sign Out
```

New dropdown:
```
- Account
- Sign Out
```

The "Account" item is a `<Link href="/account">`. The `ManageSubscriptionLink` component is no longer rendered in the header — it (or its underlying logic) is reused on `/account`. The `Sign Out` item stays exactly as is.

### States

- **Loading** (entitlements fetch pending): show skeleton placeholders for the plan card. Don't block on the profile card — `user` is already in context.
- **Entitlements error** (network or 5xx): render the profile card; show a small inline error in the plan card "Couldn't load plan details. Try refreshing." Do **not** redirect or fail the whole page — matches the fail-open philosophy of other paywall surfaces.
- **Manage portal error**: surface inline below the button (existing `ManageSubscriptionLink` already does this).

## Architecture

### Files

| File | Status | Purpose |
|---|---|---|
| `app/account/page.tsx` | NEW | Server component. Reads user via `createClient()`; redirects to `/auth/login?next=/account` if absent or `is_anonymous`. Renders `<AccountView />`. |
| `app/account/AccountView.tsx` | NEW | Client component. Calls `useEntitlements`, renders profile + plan + sign out per the UX spec above. |
| `app/account/__tests__/page.test.tsx` | NEW | Vitest. Renders for tier=free, tier=pro, tier=pro+cancel_at_period_end, entitlements-error. Verifies right CTA per tier. |
| `app/account/__tests__/AccountView.test.tsx` | NEW (or merged into the page test) | Behavior coverage for the cancel-pending banner and button click. |
| `app/components/header.tsx` | MODIFIED | Replace `ManageSubscriptionLink` dropdown item with an `Account` link to `/account`. Remove the `tier === "pro"` conditional and the `DropdownMenuSeparator`. |
| `app/components/__tests__/header.test.tsx` | MODIFIED | Update assertions: `Account` link renders for any signed-in user; `Sign Out` still present. |
| `components/paywall/ManageSubscriptionLink.tsx` | MAYBE MODIFIED | If we extract a shared hook (`useOpenBillingPortal`), this component reuses it. Final structure decided in the implementation plan. |

### Data flow

```
/account (server)
  └─ getUser() ── if no user or is_anonymous → redirect /auth/login?next=/account
  └─ render <AccountView />

<AccountView /> (client)
  ├─ useUser()                       ─► email, full_name, avatar_url
  ├─ useEntitlements()               ─► tier, caps, subscription{plan, current_period_end, cancel_at_period_end}
  ├─ Pro:  button → POST /api/billing/portal → window.location.assign(body.url)
  ├─ Free: button → router.push("/pricing")
  └─ Sign out: supabase.auth.signOut() → router.push("/")
```

No new API routes. No new database tables. No new server-side libraries.

### Auth gating

Server-side check in `page.tsx` is the gate:

```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user || user.is_anonymous) {
  redirect("/auth/login?next=/account");
}
```

This matches the existing pattern; the `?next=` param is handled by the login flow (verify and adjust during implementation if the existing flow names the param differently — `redirectTo`, `next`, etc.).

### Design system

All visual primitives must come from `components/ui/*` (`Card`, `Button`, `Avatar`, `Skeleton`, etc.). Tokens only — no raw palette colors, no `bg-card`/`text-foreground`/legacy shadcn tokens. Layout uses `mx-auto max-w-page px-6 py-8` (the page wrapper convention from `youtubeai_chat_frontend/CLAUDE.md`) wrapping a `max-w-prose` content column.

## Testing

### Unit (Vitest)

- `app/account/__tests__/page.test.tsx`:
  - Unauthenticated → redirect call to `/auth/login?next=/account`.
  - `is_anonymous=true` → same redirect.
  - Authenticated → renders `AccountView`.
- `app/account/__tests__/AccountView.test.tsx` (or co-located):
  - tier=free → "Free plan", usage line, "Upgrade to Pro" button targets `/pricing`.
  - tier=pro, no cancel pending → "Pro plan", renewal date, "Manage subscription" button.
  - tier=pro, `cancel_at_period_end=true` → warning banner with formatted end date.
  - entitlements query errors → profile card visible, plan card shows inline fallback message.
  - Sign Out click → `supabase.auth.signOut()` called, then route to `/`.
- `app/components/__tests__/header.test.tsx`:
  - Signed-in (free or pro) → dropdown contains `Account` link to `/account` and `Sign Out`.
  - Signed-out → no dropdown, just Sign In button (existing behavior).

### E2E (Playwright)

Use `~/.config/claude-test-creds/youtubeai.env` for auth. Add a new spec or extend an existing one:

1. **Free user account flow**: sign in → click avatar → click "Account" → URL is `/account` → "Free plan" visible → click "Upgrade to Pro" → URL is `/pricing`.
2. **Pro user account flow** *(if test-mode Pro account is available; otherwise mark deferred and document)*: sign in → click avatar → click "Account" → "Pro plan" visible with renewal date → click "Manage subscription" → request to `/api/billing/portal` returns a Stripe URL (don't follow into Stripe, just verify the redirect target via network log).
3. **Anonymous redirect**: visit `/account` while logged out → land on `/auth/login` with the `next` param set.

If no Pro test account exists, write the test against the free flow + an API-level test for the portal route (already exists at `app/api/billing/portal/__tests__/route.test.ts`) and document the gap in the PR.

## Risks / open questions

1. **Login redirect-back param name** — confirm whether the existing login flow honors `?next=` or a different param. If different, conform to the existing convention rather than adding a new param. *Resolved during planning by reading `app/auth/login/`.*
2. **Pro test credentials** — we may not have a Pro-tier test account. The plan must either (a) provision one for tests, (b) mock entitlements at the React Query layer, or (c) explicitly defer the Pro Playwright case to manual smoke. Defaulting to (b) for unit-level coverage and (c) for Playwright to keep scope tight.
3. **Header dropdown loses paywall visibility for Pro** — by removing the in-dropdown "Manage Subscription" we add one click for a Pro user who just wants the Stripe portal. Acceptable: the route is shorter (`/account`) than the current dropdown and the button is the page's primary action.
