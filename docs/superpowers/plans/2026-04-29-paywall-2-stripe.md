# Paywall — Phase 2: Stripe integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Stripe Checkout, Customer Portal, and webhook delivery so users can actually purchase Pro and have their `user_subscriptions.tier` flip to `pro`. The webhook is the **only** writer of `tier`. Frontend never trusts redirect state.

**Architecture:** New service module `lib/services/stripe.ts` wraps the SDK and computes tier from `(status, current_period_end)`. Three new App Router endpoints: `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/webhooks/stripe`. Two new pages: `/billing/success` (polls `/api/me/entitlements` until tier flips to pro), `/billing/canceled`. Idempotency via the `stripe_webhook_events` table created in phase 1.

**Tech Stack:** `stripe` Node SDK, Next.js 15 App Router, Vitest. Spec: [`docs/superpowers/specs/2026-04-29-paywall-design.md`](../specs/2026-04-29-paywall-design.md). Phase 1 prerequisite: [`2026-04-29-paywall-1-entitlements.md`](./2026-04-29-paywall-1-entitlements.md) merged.

**Spec sections this plan implements:** Stripe integration (all of it), `/billing/success` polling page, idempotency, tier derivation logic, the 3-day past_due grace window.

---

## Pre-work — Stripe Dashboard setup (one-time, manual)

Before any code, in the Stripe Dashboard (test mode first):

1. Create one **Product**: "YouTube AI Chat Pro"
2. Create two **Prices** under it:
   - `price_monthly` — $6.99/mo, recurring, monthly
   - `price_yearly` — $59.88/yr, recurring, yearly ($4.99/mo equivalent)
3. **Customer Portal** → enable, allow cancellation (period end), allow plan switching between the two prices.
4. **Webhooks** → add endpoint `https://www.youtubeai.chat/api/webhooks/stripe` (live) and the dev tunnel for test. Subscribe to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
5. Copy the **Webhook signing secret** for both modes (`whsec_...`).
6. Note both **Price IDs** (`price_...`).

Repeat for live mode at launch time. Document price IDs in your secrets manager / Vercel env settings.

Local dev uses Stripe CLI:
```
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
The CLI prints a `whsec_...` for local dev — different from the dashboard's. Use the CLI's value in `.env.local`.

---

## Environment variables

Add to `.env.local` (test mode), Vercel preview, and Vercel production (live mode):

```
STRIPE_SECRET_KEY=sk_test_...      # or sk_live_... in production
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...
ANON_COOKIE_SECRET=<32+ random chars>   # already added in phase 1; ensure non-empty
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # used to build success_url/cancel_url
```

`NEXT_PUBLIC_SITE_URL` should be `https://www.youtubeai.chat` in prod, the deploy URL in preview.

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `lib/services/stripe.ts` | SDK wrapper: `getStripe()`, `deriveTier(status, currentPeriodEnd)`, `priceIdForPlan(plan)` |
| `lib/services/__tests__/stripe.test.ts` | Tier derivation + helpers |
| `app/api/billing/checkout/route.ts` | `POST` — creates Checkout Session, returns `{ url }` |
| `app/api/billing/checkout/__tests__/route.test.ts` | Auth, mocked SDK |
| `app/api/billing/portal/route.ts` | `POST` — creates Portal Session, returns `{ url }` |
| `app/api/billing/portal/__tests__/route.test.ts` | Auth + sub-required |
| `app/api/webhooks/stripe/route.ts` | `POST` — signature verify + idempotent event dispatch |
| `app/api/webhooks/stripe/__tests__/route.test.ts` | Per-event fixtures + idempotency |
| `app/billing/success/page.tsx` | Polls `/api/me/entitlements` until `tier=pro` (or 30s) |
| `app/billing/canceled/page.tsx` | Plain "no worries" landing page |

---

## Task 1: Install SDK + scaffold env

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `.env.example`

- [ ] **Step 1: Install Stripe**

```
pnpm add stripe
```

- [ ] **Step 2: Add env vars to `.env.example`**

```
# Stripe (paywall — phase 2)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_YEARLY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore(paywall): add stripe SDK + env scaffolding"
```

---

## Task 2: `lib/services/stripe.ts` — SDK wrapper + tier derivation

**Files:**
- Create: `lib/services/stripe.ts`
- Create: `lib/services/__tests__/stripe.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const loadFresh = async () => {
  vi.resetModules();
  return await import("../stripe");
};

describe("deriveTier", () => {
  it("active + future period_end → pro", async () => {
    const { deriveTier } = await loadFresh();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(deriveTier("active", future)).toBe("pro");
  });

  it("trialing + future period_end → pro", async () => {
    const { deriveTier } = await loadFresh();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(deriveTier("trialing", future)).toBe("pro");
  });

  it("active + past period_end → free", async () => {
    const { deriveTier } = await loadFresh();
    const past = new Date(Date.now() - 86400_000).toISOString();
    expect(deriveTier("active", past)).toBe("free");
  });

  it("past_due within 3 days → pro (grace)", async () => {
    const { deriveTier } = await loadFresh();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    expect(deriveTier("past_due", twoDaysAgo)).toBe("pro");
  });

  it("past_due over 3 days → free", async () => {
    const { deriveTier } = await loadFresh();
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000).toISOString();
    expect(deriveTier("past_due", fiveDaysAgo)).toBe("free");
  });

  it("canceled → free regardless of period_end", async () => {
    const { deriveTier } = await loadFresh();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(deriveTier("canceled", future)).toBe("free");
  });

  it("unknown status → free", async () => {
    const { deriveTier } = await loadFresh();
    expect(deriveTier("incomplete_expired", null)).toBe("free");
  });

  it("null period_end → free", async () => {
    const { deriveTier } = await loadFresh();
    expect(deriveTier("active", null)).toBe("free");
  });
});

describe("priceIdForPlan", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_M");
    vi.stubEnv("STRIPE_PRICE_YEARLY", "price_Y");
  });
  it("returns correct price for plan", async () => {
    const { priceIdForPlan } = await loadFresh();
    expect(priceIdForPlan("monthly")).toBe("price_M");
    expect(priceIdForPlan("yearly")).toBe("price_Y");
  });
  it("returns null for unknown plan", async () => {
    const { priceIdForPlan } = await loadFresh();
    expect(priceIdForPlan("weekly" as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// lib/services/stripe.ts
import Stripe from "stripe";

let _client: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      console.error("[stripe] STRIPE_SECRET_KEY missing", {
        errorId: "STRIPE_KEY_MISSING",
      });
    }
    return null;
  }
  _client = new Stripe(key, { apiVersion: "2025-08-27.basil" });
  return _client;
}

export type Plan = "monthly" | "yearly";

export function priceIdForPlan(plan: Plan): string | null {
  if (plan === "monthly") return process.env.STRIPE_PRICE_MONTHLY ?? null;
  if (plan === "yearly") return process.env.STRIPE_PRICE_YEARLY ?? null;
  return null;
}

const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Compute the user-facing tier from Stripe subscription state.
 * Source-of-truth function — used by the webhook to write
 * `user_subscriptions.tier`. Mirrors the spec's tier-derivation rule.
 */
export function deriveTier(
  status: string | null | undefined,
  currentPeriodEndIso: string | null | undefined
): "free" | "pro" {
  if (!status || !currentPeriodEndIso) return "free";
  const periodEnd = Date.parse(currentPeriodEndIso);
  if (!Number.isFinite(periodEnd)) return "free";
  const now = Date.now();

  if (status === "active" || status === "trialing") {
    return periodEnd > now ? "pro" : "free";
  }
  if (status === "past_due") {
    return periodEnd > now - PAST_DUE_GRACE_MS ? "pro" : "free";
  }
  return "free";
}

// Convenience: webhook payloads stamp `current_period_end` as a unix
// seconds number. Convert before passing to deriveTier so callers
// don't have to remember.
export function periodEndToIso(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/services/stripe.ts lib/services/__tests__/stripe.test.ts
git commit -m "feat(paywall): stripe SDK wrapper + tier derivation logic"
```

---

## Task 3: `POST /api/billing/checkout`

**Files:**
- Create: `app/api/billing/checkout/route.ts`
- Create: `app/api/billing/checkout/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
1. Unauthenticated → 401
2. Anonymous Supabase user (`is_anonymous=true`) → 401 (anon can't subscribe)
3. New user, no `user_subscriptions` row → creates Stripe Customer with `metadata.user_id`, inserts row, creates Checkout Session, returns `{ url }`
4. Existing user with `stripe_customer_id` → reuses customer, creates session
5. Bad plan in body → 400
6. Stripe API throws → 503

```ts
// __tests__/route.test.ts — full bodies, mocked SDK
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getServiceRoleClient: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => mocks.getServiceRoleClient(),
}));

vi.mock("@/lib/services/stripe", () => ({
  getStripe: () => ({
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
  }),
  priceIdForPlan: (p: string) => (p === "monthly" ? "price_M" : p === "yearly" ? "price_Y" : null),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example");
  // Default service-role chain returning maybeSingle()
  mocks.getServiceRoleClient.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      upsert: mocks.upsert,
    }),
  });
});

it("401 when not signed in", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(401);
});

it("401 when user is anonymous (Supabase anon auth)", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", is_anonymous: true } },
    error: null,
  });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(401);
});

it("400 on invalid plan", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "weekly" }),
  }));
  expect(res.status).toBe(400);
});

it("creates customer + session for new user, returns url", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.customersCreate.mockResolvedValue({ id: "cus_1" });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.url).toBe("https://checkout.stripe.com/x");
  expect(mocks.customersCreate).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: { user_id: "u1" } })
  );
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: "u1", stripe_customer_id: "cus_1", tier: "free" })
  );
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: "u1",
      line_items: [{ price: "price_M", quantity: 1 }],
    })
  );
});

it("reuses existing customer when user_subscriptions row already exists", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_existing" },
    error: null,
  });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "yearly" }),
  }));

  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(
    expect.objectContaining({ customer: "cus_existing", line_items: [{ price: "price_Y", quantity: 1 }] })
  );
});

it("503 when Stripe throws", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_existing" },
    error: null,
  });
  mocks.sessionsCreate.mockRejectedValue(new Error("stripe down"));
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(503);
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement route**

```ts
// app/api/billing/checkout/route.ts
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripe, priceIdForPlan } from "@/lib/services/stripe";

const BodySchema = z.object({
  plan: z.enum(["monthly", "yearly"]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "Invalid plan" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user || (user.is_anonymous ?? false)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const sr = getServiceRoleClient();
  if (!sr) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  const priceId = priceIdForPlan(parsed.data.plan);
  if (!priceId) {
    return Response.json({ message: "Plan unavailable" }, { status: 503 });
  }

  try {
    // Look up or create Stripe customer
    const { data: existing } = await sr
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error } = await sr.from("user_subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        tier: "free",
      });
      if (error) {
        console.error("[billing/checkout] upsert failed", {
          errorId: "BILLING_UPSERT_FAIL",
          userId: user.id,
          code: error.code,
        });
      }
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      success_url: `${siteUrl}/billing/success`,
      cancel_url: `${siteUrl}/pricing?canceled=1`,
      allow_promotion_codes: true,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] stripe error", {
      errorId: "BILLING_CHECKOUT_FAIL",
      userId: user.id,
      err,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
}
```

- [ ] **Step 4: Run tests + lint**

- [ ] **Step 5: Commit**

```bash
git add app/api/billing/checkout
git commit -m "feat(paywall): POST /api/billing/checkout (Stripe Checkout Session)"
```

---

## Task 4: `POST /api/billing/portal`

**Files:**
- Create: `app/api/billing/portal/route.ts`
- Create: `app/api/billing/portal/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests** — same hoisted-mock pattern as Task 3.

```ts
// app/api/billing/portal/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}));

vi.mock("@/lib/services/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: mocks.portalCreate } } }),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example");
});

it("401 when not signed in", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(401);
});

it("401 for anonymous Supabase user", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", is_anonymous: true } }, error: null,
  });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(401);
});

it("400 when no user_subscriptions row exists", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", is_anonymous: false } }, error: null,
  });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(400);
});

it("returns portal URL for user with stripe_customer_id", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", is_anonymous: false } }, error: null,
  });
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" }, error: null,
  });
  mocks.portalCreate.mockResolvedValue({ url: "https://billing.stripe.com/x" });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.url).toBe("https://billing.stripe.com/x");
  expect(mocks.portalCreate).toHaveBeenCalledWith(expect.objectContaining({
    customer: "cus_1",
    return_url: "https://test.example/",
  }));
});

it("503 when Stripe throws", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", is_anonymous: false } }, error: null,
  });
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" }, error: null,
  });
  mocks.portalCreate.mockRejectedValue(new Error("stripe down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(503);
});
```

- [ ] **Step 2: Implement**

```ts
// app/api/billing/portal/route.ts
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripe } from "@/lib/services/stripe";

export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user || (user.is_anonymous ?? false)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const sr = getServiceRoleClient();
  const stripe = getStripe();
  if (!sr || !stripe) {
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }

  const { data } = await sr
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data?.stripe_customer_id) {
    return Response.json({ message: "No subscription on file" }, { status: 400 });
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${siteUrl}/`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] stripe error", {
      errorId: "BILLING_PORTAL_FAIL", userId: user.id, err,
    });
    return Response.json({ message: "Service unavailable" }, { status: 503 });
  }
}
```

- [ ] **Step 3: Run, expect pass + commit**

```bash
git add app/api/billing/portal
git commit -m "feat(paywall): POST /api/billing/portal (Stripe Customer Portal)"
```

---

## Task 5: Webhook endpoint — signature + idempotency

**Files:**
- Create: `app/api/webhooks/stripe/route.ts`
- Create: `app/api/webhooks/stripe/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  insertEvent: vi.fn(),
  retrieveSub: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/services/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.retrieveSub },
  }),
  deriveTier: (await import("../../../../lib/services/stripe")).deriveTier,
  periodEndToIso: (s: number | null) =>
    s ? new Date(s * 1000).toISOString() : null,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "stripe_webhook_events") {
        return { upsert: mocks.insertEvent };
      }
      if (table === "user_subscriptions") {
        return { upsert: mocks.upsert };
      }
      throw new Error(`unexpected ${table}`);
    },
  }),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
});

it("400 when signature missing", async () => {
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", { method: "POST", body: "{}" }));
  expect(res.status).toBe(400);
});

it("400 when constructEvent throws (bad signature)", async () => {
  mocks.constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=x" },
  }));
  expect(res.status).toBe(400);
});

it("200 + no-op when event already processed (idempotency)", async () => {
  mocks.constructEvent.mockReturnValue({ id: "evt_1", type: "customer.subscription.updated", data: { object: {} } });
  // upsert with onConflict ignore returning empty data signals duplicate
  mocks.insertEvent.mockResolvedValue({ data: [], error: null });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=x" },
  }));
  expect(res.status).toBe(200);
  expect(mocks.upsert).not.toHaveBeenCalled();
});

// More cases (per event) live in Task 6, 7, 8.
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement skeleton**

```ts
// app/api/webhooks/stripe/route.ts
import { getStripe, deriveTier, periodEndToIso } from "@/lib/services/stripe";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type Stripe from "stripe";

export const runtime = "nodejs"; // need raw body
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

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

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", { err });
    return new Response("Bad signature", { status: 400 });
  }

  // Idempotency: insert event_id; on conflict, this is a duplicate.
  const ins = await sr
    .from("stripe_webhook_events")
    .upsert({ event_id: event.id }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");
  if (ins.error) {
    console.error("[stripe-webhook] idempotency insert failed", {
      errorId: "WEBHOOK_IDEMPOTENCY_FAIL", id: event.id, code: ins.error.code,
    });
    return new Response("DB error", { status: 500 });
  }
  if (!ins.data || ins.data.length === 0) {
    // Conflict — already processed
    return new Response("ok", { status: 200 });
  }

  try {
    await dispatch(event, sr, stripe);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[stripe-webhook] handler threw", {
      errorId: "WEBHOOK_HANDLER_THREW", id: event.id, type: event.type, err,
    });
    // 5xx → Stripe retries (good — we want it to retry on transient failures)
    return new Response("handler error", { status: 500 });
  }
}

async function dispatch(
  event: Stripe.Event,
  sr: ReturnType<typeof getServiceRoleClient>,
  stripe: Stripe,
): Promise<void> {
  // Filled in Tasks 6, 7, 8.
  switch (event.type) {
    case "checkout.session.completed":
      // Task 6
      break;
    case "customer.subscription.updated":
      // Task 7
      break;
    case "customer.subscription.deleted":
      // Task 8
      break;
    case "invoice.payment_failed":
    case "invoice.paid":
      // No-op — subscription.updated covers state changes
      break;
    default:
      // Ignore
      break;
  }
}
```

- [ ] **Step 4: Run, expect pass on signature + idempotency tests**

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/stripe
git commit -m "feat(paywall): stripe webhook scaffolding (signature + idempotency)"
```

---

## Task 6: Webhook handler — `checkout.session.completed`

**Files:**
- Modify: `app/api/webhooks/stripe/route.ts`
- Modify: `app/api/webhooks/stripe/__tests__/route.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("checkout.session.completed: writes pro subscription row", async () => {
  mocks.constructEvent.mockReturnValue({
    id: "evt_2",
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: "u1",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { user_id: "u1" },
      },
    },
  });
  mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_2" }], error: null });
  mocks.retrieveSub.mockResolvedValue({
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    items: { data: [{ price: { id: "price_M" } }] },
  });
  mocks.upsert.mockResolvedValue({ error: null });

  const { POST } = await import("../route");
  await POST(new Request("http://x", {
    method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" },
  }));

  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: "u1",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      tier: "pro",
      plan: "monthly",
      status: "active",
      cancel_at_period_end: false,
    }),
    expect.objectContaining({ onConflict: "user_id" })
  );
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement the case branch in `dispatch`**

```ts
case "checkout.session.completed": {
  const session = event.data.object as Stripe.Checkout.Session;
  const userId = (session.metadata?.user_id ?? session.client_reference_id) as string | undefined;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!userId || !subId || !customerId) {
    console.error("[stripe-webhook] checkout.completed missing fields", {
      id: event.id, userId, subId, customerId,
    });
    return;
  }
  const sub = await stripe.subscriptions.retrieve(subId);
  const periodEnd = periodEndToIso(sub.current_period_end);
  const tier = deriveTier(sub.status, periodEnd);
  const plan = priceIdToPlan(sub);

  const { error } = await sr.from("user_subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      tier,
      plan,
      status: sub.status,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`upsert failed: ${error.message}`);
  break;
}
```

Add helper at the bottom:

```ts
function priceIdToPlan(sub: Stripe.Subscription): "monthly" | "yearly" | null {
  const priceId = sub.items?.data[0]?.price?.id;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/stripe
git commit -m "feat(paywall): webhook handler — checkout.session.completed"
```

---

## Task 7: Webhook handler — `customer.subscription.updated`

Triggered on every state change (renewal, cancel-at-period-end toggle, plan switch, payment failure → past_due, payment recovery). Re-derive tier from `(status, current_period_end)` and UPSERT.

- [ ] **Step 1: Add failing tests** — using the same harness from Task 5.

```ts
function buildEvent(sub: Partial<{ id: string; status: string; customer: string; current_period_end: number; cancel_at_period_end: boolean; items: { data: Array<{ price: { id: string } }> } }>) {
  return {
    id: `evt_${Math.random()}`,
    type: "customer.subscription.updated",
    data: { object: { id: "sub_1", customer: "cus_1", cancel_at_period_end: false, items: { data: [{ price: { id: "price_M" } }] }, ...sub } },
  };
}

function setupRowLookup(userId: string | null) {
  vi.mocked(/* getServiceRoleClient mock */).mockReturnValue({
    from: (table: string) => {
      if (table === "stripe_webhook_events") return { upsert: () => ({ select: async () => ({ data: [{ event_id: "x" }], error: null }) }) };
      if (table === "user_subscriptions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: userId ? { user_id: userId } : null, error: null }) }) }),
          upsert: mocks.upsert,
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  } as never);
}

it("active + future period → tier=pro", async () => {
  setupRowLookup("u1");
  const future = Math.floor(Date.now() / 1000) + 30 * 86400;
  mocks.constructEvent.mockReturnValue(buildEvent({ status: "active", current_period_end: future }));
  mocks.upsert.mockResolvedValue({ error: null });
  const { POST } = await import("../route");
  await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: "u1", tier: "pro", status: "active", plan: "monthly" }),
    expect.objectContaining({ onConflict: "user_id" }),
  );
});

it("past_due within 3 days → tier=pro (grace)", async () => {
  setupRowLookup("u1");
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
  mocks.constructEvent.mockReturnValue(buildEvent({ status: "past_due", current_period_end: twoDaysAgo }));
  mocks.upsert.mockResolvedValue({ error: null });
  const { POST } = await import("../route");
  await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ tier: "pro", status: "past_due" }),
    expect.anything(),
  );
});

it("past_due over 3 days → tier=free", async () => {
  setupRowLookup("u1");
  const fiveDaysAgo = Math.floor(Date.now() / 1000) - 5 * 86400;
  mocks.constructEvent.mockReturnValue(buildEvent({ status: "past_due", current_period_end: fiveDaysAgo }));
  mocks.upsert.mockResolvedValue({ error: null });
  const { POST } = await import("../route");
  await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ tier: "free", status: "past_due" }),
    expect.anything(),
  );
});

it("plan switch monthly → yearly updates `plan`", async () => {
  setupRowLookup("u1");
  const future = Math.floor(Date.now() / 1000) + 365 * 86400;
  mocks.constructEvent.mockReturnValue(buildEvent({
    status: "active", current_period_end: future,
    items: { data: [{ price: { id: "price_Y" } }] },
  }));
  mocks.upsert.mockResolvedValue({ error: null });
  const { POST } = await import("../route");
  await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ plan: "yearly" }),
    expect.anything(),
  );
});

it("logs and 200s when customer is unknown (no row mapping)", async () => {
  setupRowLookup(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const future = Math.floor(Date.now() / 1000) + 86400;
  mocks.constructEvent.mockReturnValue(buildEvent({ status: "active", current_period_end: future }));
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(res.status).toBe(200);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
```

(Set up `STRIPE_PRICE_MONTHLY=price_M` and `STRIPE_PRICE_YEARLY=price_Y` in the test setup so `priceIdToPlan` resolves.)

- [ ] **Step 2: Implement case**

```ts
case "customer.subscription.updated": {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEnd = periodEndToIso(sub.current_period_end);
  const tier = deriveTier(sub.status, periodEnd);
  const plan = priceIdToPlan(sub);

  // Find user_id by stripe_customer_id (we own the mapping)
  const { data: row } = await sr
    .from("user_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!row?.user_id) {
    console.error("[stripe-webhook] subscription.updated for unknown customer", {
      id: event.id, customerId,
    });
    return;
  }

  const { error } = await sr.from("user_subscriptions").upsert(
    {
      user_id: row.user_id,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      tier,
      plan,
      status: sub.status,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`upsert failed: ${error.message}`);
  break;
}
```

- [ ] **Step 3: Run, expect pass + commit**

```bash
git add app/api/webhooks/stripe
git commit -m "feat(paywall): webhook handler — customer.subscription.updated"
```

---

## Task 8: Webhook handler — `customer.subscription.deleted`

Cancellation reaches its end. Flip to free, null out `stripe_subscription_id`. Keep `stripe_customer_id` so a future re-subscribe reuses the same customer.

- [ ] **Step 1: Add failing test**

```ts
it("subscription.deleted: tier=free, subscription_id null, customer kept", async () => {
  setupRowLookup("u1");
  mocks.constructEvent.mockReturnValue({
    id: "evt_d",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "canceled",
        current_period_end: Math.floor(Date.now() / 1000),
        cancel_at_period_end: false,
      },
    },
  });
  mocks.upsert.mockResolvedValue({ error: null });
  const { POST } = await import("../route");
  await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: "u1",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: null,
      tier: "free",
      plan: null,
      cancel_at_period_end: false,
    }),
    expect.objectContaining({ onConflict: "user_id" }),
  );
});

it("subscription.deleted with unknown customer: 200 + log, no upsert", async () => {
  setupRowLookup(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.constructEvent.mockReturnValue({
    id: "evt_d2",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_x", customer: "cus_x", status: "canceled" } },
  });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" }}));
  expect(res.status).toBe(200);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement**

```ts
case "customer.subscription.deleted": {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const { data: row } = await sr
    .from("user_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!row?.user_id) {
    console.error("[stripe-webhook] subscription.deleted for unknown customer", {
      id: event.id, customerId,
    });
    return;
  }

  const { error } = await sr.from("user_subscriptions").upsert(
    {
      user_id: row.user_id,
      stripe_customer_id: customerId,
      stripe_subscription_id: null,
      tier: "free",
      plan: null,
      status: sub.status,
      current_period_end: periodEndToIso(sub.current_period_end),
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`upsert failed: ${error.message}`);
  break;
}
```

- [ ] **Step 3: Run + commit**

```bash
git add app/api/webhooks/stripe
git commit -m "feat(paywall): webhook handler — customer.subscription.deleted"
```

---

## Task 9: `/billing/success` polling page

**Files:**
- Create: `app/billing/success/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/billing/success/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

export default function BillingSuccessPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"polling" | "ok" | "timeout" | "error">("polling");

  useEffect(() => {
    const startedAt = Date.now();
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/me/entitlements", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          if (body.tier === "pro") {
            setPhase("ok");
            // Brief celebratory pause then return home
            setTimeout(() => router.replace("/"), 1500);
            return;
          }
        }
      } catch {
        // ignore — try again
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPhase("timeout");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => { stopped = true; };
  }, [router]);

  return (
    <main className="container mx-auto max-w-md px-4 py-16 text-center">
      {phase === "polling" && (
        <>
          <h1 className="text-h2 text-text-primary">Confirming your subscription…</h1>
          <p className="mt-4 text-body-md text-text-secondary">
            One moment — we're activating Pro on your account.
          </p>
        </>
      )}
      {phase === "ok" && (
        <>
          <h1 className="text-h2 text-text-primary">Welcome to Pro!</h1>
          <p className="mt-4 text-body-md text-text-secondary">
            Unlimited summaries, chat, and history are now unlocked.
          </p>
        </>
      )}
      {phase === "timeout" && (
        <>
          <h1 className="text-h2 text-text-primary">Almost done</h1>
          <p className="mt-4 text-body-md text-text-secondary">
            Your subscription is still processing. Please refresh in a moment.
          </p>
          <Link href="/" className="mt-6 inline-block text-accent-brand">Back to summaries</Link>
        </>
      )}
    </main>
  );
}
```

(Tokens follow the design-system contract in `youtubeai_chat_frontend/CLAUDE.md`.)

- [ ] **Step 2: Lint**

- [ ] **Step 3: Commit**

```bash
git add app/billing/success
git commit -m "feat(paywall): /billing/success polling landing page"
```

---

## Task 10: `/billing/canceled` page

**Files:**
- Create: `app/billing/canceled/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/billing/canceled/page.tsx
import Link from "next/link";

export default function BillingCanceledPage() {
  return (
    <main className="container mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-h2 text-text-primary">No worries</h1>
      <p className="mt-4 text-body-md text-text-secondary">
        You're still on the free tier.
      </p>
      <Link href="/" className="mt-6 inline-block text-accent-brand">Back to summaries</Link>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/billing/canceled
git commit -m "feat(paywall): /billing/canceled landing page"
```

---

## Task 11: E2E happy path with Stripe CLI

Per CLAUDE.md, every feature/bug needs a Playwright e2e before being declared done.

**Files:**
- Create: `tests-utils/e2e/paywall-purchase.spec.ts` (or wherever existing e2e lives — match the project convention)

- [ ] **Step 1: Set up Stripe CLI listener**

In a separate terminal:
```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Copy the printed `whsec_...` into `.env.local`.

- [ ] **Step 2: Write the e2e**

The test:
1. Sign in as the test user
2. Manually flip `summariesUsed` to 11 via direct Supabase SQL (or repeated calls)
3. Visit `/pricing`, click "Upgrade — monthly"
4. On Stripe Checkout (test mode): fill `4242 4242 4242 4242`, any future expiry, any CVC, any name
5. Land on `/billing/success` — expect "Confirming…" then "Welcome to Pro!"
6. Hit `GET /api/me/entitlements` — expect `tier=pro`
7. Submit a 12th summary — expect 200/SSE (no 402)

- [ ] **Step 3: Run e2e + commit**

```bash
pnpm smoke:e2e
git add tests-utils/e2e/paywall-purchase.spec.ts
git commit -m "test(paywall): e2e happy-path purchase via stripe CLI"
```

---

## Task 12: Lint + final commit

- [ ] `pnpm vitest run`
- [ ] `pnpm lint`
- [ ] `pnpm tsc --noEmit` if your CI runs typecheck separately
- [ ] Manual verification: portal cancel via dashboard test → `cancel_at_period_end=true` arrives → DB row reflects it

- [ ] **Final commit (if needed)**

```bash
git commit -am "chore(paywall): phase-2 polish + lint" || echo "nothing to commit"
```

---

## Acceptance criteria for Phase 2

- [ ] All Stripe env vars documented in `.env.example`
- [ ] `POST /api/billing/checkout` returns a Stripe Checkout URL for free signed-in users; 401 anon; 400 bad plan
- [ ] `POST /api/billing/portal` returns a Stripe Portal URL for users with a customer; 400 if no row
- [ ] Webhook signature verification rejects forged requests; idempotency table prevents double-processing
- [ ] `checkout.session.completed` flips a user's `tier` to `pro`
- [ ] `customer.subscription.updated` correctly handles renewals, past_due grace, plan switches, cancel-at-period-end
- [ ] `customer.subscription.deleted` flips back to `tier='free'`, keeps `stripe_customer_id`
- [ ] `/billing/success` polls and shows the welcome message; `/billing/canceled` is a friendly fallback
- [ ] `pnpm vitest run` passes; `pnpm lint` clean
- [ ] E2E: real test-mode purchase results in `tier=pro` and removes the 402 wall
