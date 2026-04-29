# Paywall — Phase 1: Entitlements & cap enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the database schema, entitlement service, and cap enforcement to the existing summarize and chat endpoints. No UI changes, no Stripe — this phase delivers a silent paywall that returns 429 to free users at their limits. Phases 2 and 3 add the upgrade path.

**Architecture:** Mirror the existing `lib/services/rate-limit.ts` pattern. New tables (`user_subscriptions`, `monthly_summary_usage`, `anon_summary_quota`, `stripe_webhook_events`) plus an atomic-increment RPC for monthly usage. New `lib/services/entitlements.ts` exports `checkSummaryEntitlement`, `checkChatEntitlement`, `getUserTier` — same fail-open philosophy, same observability story, same shape as `RateLimitResult`. Existing routes get one new check inserted next to the existing `checkRateLimit` call.

**Tech Stack:** Postgres (Supabase), TypeScript, Next.js 15 App Router, Vitest, Zod, `@supabase/ssr`. Spec: [`docs/superpowers/specs/2026-04-29-paywall-design.md`](../specs/2026-04-29-paywall-design.md).

**Spec sections this plan implements:** Database (all four migrations), Entitlement service, the "cap enforcement" half of Architecture (race conditions, fail-open), and the new `GET /api/me/entitlements` endpoint.

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260429100000_user_subscriptions.sql` | Table + RLS + grants. Webhook is sole writer; users can SELECT own row. |
| `supabase/migrations/20260429100001_monthly_summary_usage.sql` | Table + `increment_monthly_summary` RPC + grants |
| `supabase/migrations/20260429100002_anon_summary_quota.sql` | Table + `increment_anon_summary_quota` RPC + grants |
| `supabase/migrations/20260429100003_stripe_webhook_events.sql` | Idempotency table; phase 2 will use it |
| `lib/services/entitlements.ts` | `checkSummaryEntitlement`, `checkChatEntitlement`, `getUserTier`, `getUserCaps`, types |
| `lib/services/__tests__/entitlements.test.ts` | Unit tests, mirrors `rate-limit.test.ts` |
| `lib/services/anon-cookie.ts` | Read/write a signed UUID cookie; key the anon counter |
| `lib/services/__tests__/anon-cookie.test.ts` | Cookie helpers tests |
| `app/api/me/entitlements/route.ts` | `GET` returns `{ tier, caps, subscription }` for the UI |
| `app/api/me/entitlements/__tests__/route.test.ts` | Route tests |

**Modified files:**

| Path | Change |
|---|---|
| `app/api/summarize/stream/route.ts` | After `checkRateLimit`, call `checkSummaryEntitlement`; for free users, FIFO-evict oldest history row when count >= 10 |
| `app/api/chat/stream/route.ts` | After `checkRateLimit`, call `checkChatEntitlement(userId, summaryId)` |
| `app/api/summarize/stream/__tests__/route.test.ts` | Mock entitlement service alongside rate limit; cover allowed/exceeded/fail-open |
| `app/api/chat/stream/__tests__/route.test.ts` | Same |
| `lib/services/summarize-cache.ts` | Plumb `tier` into the history-write path so eviction logic lives in one transaction (or wrap caller-side — see Task 11 for the chosen split) |

---

## Constants

These constants live in `lib/services/entitlements.ts` and are imported anywhere they're needed:

```ts
export const FREE_LIMITS = {
  summariesPerMonth: 10,
  chatMessagesPerVideo: 5,
  historyItems: 10,
} as const;

export const ANON_LIMITS = {
  summariesLifetime: 1,
} as const;
```

The numbers above are the v1 spec. Do not duplicate them anywhere else; import from `entitlements.ts`.

---

## Task 1: Migration — `user_subscriptions`

**Files:**
- Create: `supabase/migrations/20260429100000_user_subscriptions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One row per user. Lazily created on first checkout. Webhook (phase 2)
-- is the sole writer of `tier`; everything else reads. `tier` is
-- denormalized from `status` + `current_period_end` for fast reads on
-- the request path (every metered endpoint dispatches off it).

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id                uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text         NOT NULL UNIQUE,
  stripe_subscription_id text         UNIQUE,
  tier                   text         NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  plan                   text         CHECK (plan IS NULL OR plan IN ('monthly', 'yearly')),
  status                 text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean      NOT NULL DEFAULT false,
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_customer
  ON user_subscriptions(stripe_customer_id);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_subscriptions_select_own" ON user_subscriptions;
CREATE POLICY "user_subscriptions_select_own"
  ON user_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Service role bypasses RLS; no INSERT/UPDATE policies needed for
-- authenticated. The REVOKE below makes the denial explicit so a future
-- accidental policy can't widen access silently.
REVOKE INSERT, UPDATE, DELETE ON user_subscriptions FROM anon, authenticated;
```

- [ ] **Step 2: Verify against the legacy fixture**

Run: `pnpm test -- supabase` if a migration test exists, or skip — the `migration-upgrade-test` job in CI does this for real on PR.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260429100000_user_subscriptions.sql
git commit -m "feat(paywall): user_subscriptions table for tier state"
```

---

## Task 2: Migration — `monthly_summary_usage` + RPC

**Files:**
- Create: `supabase/migrations/20260429100001_monthly_summary_usage.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Per-user monthly summary counter. year_month is a 'YYYY-MM' string in
-- UTC (computed by the app), so the boundary is UTC midnight on the 1st.
-- Mirrors the rate_limits table pattern.

CREATE TABLE IF NOT EXISTS monthly_summary_usage (
  user_id    uuid  NOT NULL,
  year_month text  NOT NULL,
  count      int   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_summary_usage_user
  ON monthly_summary_usage(user_id, year_month DESC);

ALTER TABLE monthly_summary_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_summary_usage_select_own" ON monthly_summary_usage;
CREATE POLICY "monthly_summary_usage_select_own"
  ON monthly_summary_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON monthly_summary_usage FROM anon, authenticated;

-- Atomic increment. Returns the NEW count after the increment, so the
-- caller can compare against the limit. ON CONFLICT prevents the
-- double-spend race two concurrent requests would otherwise create.
CREATE OR REPLACE FUNCTION increment_monthly_summary(
  p_user_id uuid,
  p_year_month text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO monthly_summary_usage (user_id, year_month, count)
  VALUES (p_user_id, p_year_month, 1)
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET count = monthly_summary_usage.count + 1
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION increment_monthly_summary(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_monthly_summary(uuid, text) TO service_role;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260429100001_monthly_summary_usage.sql
git commit -m "feat(paywall): monthly_summary_usage table + atomic increment RPC"
```

---

## Task 3: Migration — `anon_summary_quota` + RPC

**Files:**
- Create: `supabase/migrations/20260429100002_anon_summary_quota.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Lifetime summary counter for anonymous browser sessions. anon_id is a
-- signed UUID cookie set by the app. Soft gate: clearing cookies resets
-- the count. Acceptable per spec — this nudges signup, doesn't stop
-- adversaries.

CREATE TABLE IF NOT EXISTS anon_summary_quota (
  anon_id      uuid         PRIMARY KEY,
  count        int          NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  last_used_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anon_summary_quota_last_used
  ON anon_summary_quota(last_used_at);

ALTER TABLE anon_summary_quota ENABLE ROW LEVEL SECURITY;

-- Anonymous browsers don't have a Supabase JWT; only service role reads
-- and writes this table. Make the denial explicit.
REVOKE ALL ON anon_summary_quota FROM anon, authenticated;

CREATE OR REPLACE FUNCTION increment_anon_summary_quota(p_anon_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO anon_summary_quota (anon_id, count, last_used_at)
  VALUES (p_anon_id, 1, now())
  ON CONFLICT (anon_id)
  DO UPDATE SET count = anon_summary_quota.count + 1, last_used_at = now()
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION increment_anon_summary_quota(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_anon_summary_quota(uuid) TO service_role;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260429100002_anon_summary_quota.sql
git commit -m "feat(paywall): anon_summary_quota table + atomic increment RPC"
```

---

## Task 4: Migration — `stripe_webhook_events` (idempotency)

**Files:**
- Create: `supabase/migrations/20260429100003_stripe_webhook_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Stripe redelivers webhooks. Inserting event.id with ON CONFLICT
-- DO NOTHING gives us idempotency: a second delivery sees the conflict
-- and the handler returns 200 immediately. Phase 2 wires the actual
-- handler; this table lands in phase 1 so the schema is fully in place
-- before any Stripe code touches it.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id    text         PRIMARY KEY,
  received_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stripe_webhook_events FROM anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260429100003_stripe_webhook_events.sql
git commit -m "feat(paywall): stripe_webhook_events idempotency table"
```

---

## Task 5: Anon cookie service

The anon counter is keyed on a signed UUID held in a cookie. We sign with HMAC-SHA256 using a server-only secret so a forged cookie can't impersonate another anon's row.

**Files:**
- Create: `lib/services/anon-cookie.ts`
- Test: `lib/services/__tests__/anon-cookie.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/services/__tests__/anon-cookie.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { signAnonId, verifyAnonId, ANON_COOKIE_NAME } from "../anon-cookie";

const SECRET = "test-secret-32-chars-minimum-aaaa";

describe("anon-cookie sign/verify", () => {
  beforeEach(() => {
    vi.stubEnv("ANON_COOKIE_SECRET", SECRET);
  });

  it("round-trips a UUID", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const signed = signAnonId(id);
    expect(verifyAnonId(signed)).toBe(id);
  });

  it("rejects a tampered payload", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const signed = signAnonId(id);
    const tampered = signed.replace(id, "22222222-2222-2222-2222-222222222222");
    expect(verifyAnonId(tampered)).toBeNull();
  });

  it("rejects a malformed cookie", () => {
    expect(verifyAnonId("not-a-cookie")).toBeNull();
    expect(verifyAnonId("")).toBeNull();
    expect(verifyAnonId("abc.def")).toBeNull();
  });

  it("returns null when ANON_COOKIE_SECRET missing", () => {
    vi.stubEnv("ANON_COOKIE_SECRET", "");
    const id = "11111111-1111-1111-1111-111111111111";
    expect(signAnonId(id)).toBeNull();
    expect(verifyAnonId("anything")).toBeNull();
  });

  it("exports the cookie name", () => {
    expect(ANON_COOKIE_NAME).toBe("yt_anon_id");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm vitest run lib/services/__tests__/anon-cookie.test.ts
```
Expected: FAIL — module does not export `signAnonId`.

- [ ] **Step 3: Implement**

```ts
// lib/services/anon-cookie.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const ANON_COOKIE_NAME = "yt_anon_id";

// 1 year. Sliding via re-set on each request would extend lifetime; we
// don't bother — fixed expiry is fine, the counter survives even if the
// cookie expires (orphaned row GC'd at 90 days).
export const ANON_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function getSecret(): string | null {
  const s = process.env.ANON_COOKIE_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") {
      console.error("[anon-cookie] ANON_COOKIE_SECRET missing or too short", {
        errorId: "ANON_COOKIE_SECRET_MISSING",
      });
    }
    return null;
  }
  return s;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Sign a UUID. Returns "<uuid>.<hmac-hex>" or null if secret missing. */
export function signAnonId(uuid: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return `${uuid}.${hmac(secret, uuid)}`;
}

/** Verify a signed cookie. Returns the UUID on success, null otherwise. */
export function verifyAnonId(signed: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const dot = signed.indexOf(".");
  if (dot <= 0 || dot === signed.length - 1) return null;
  const id = signed.slice(0, dot);
  const tag = signed.slice(dot + 1);
  const expected = hmac(secret, id);
  if (tag.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(tag, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  return id;
}
```

- [ ] **Step 4: Run, expect pass**

```
pnpm vitest run lib/services/__tests__/anon-cookie.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/services/anon-cookie.ts lib/services/__tests__/anon-cookie.test.ts
git commit -m "feat(paywall): signed anon-id cookie helpers"
```

---

## Task 6: Entitlement service — types, constants, `getUserTier`

**Files:**
- Create: `lib/services/entitlements.ts`
- Test: `lib/services/__tests__/entitlements.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/services/__tests__/entitlements.test.ts
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(() => ({ rpc: mocks.rpc, from: mocks.from })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

async function loadFreshModule() {
  vi.resetModules();
  return await import("../entitlements");
}

describe("FREE_LIMITS / ANON_LIMITS", () => {
  it("exports the spec values", async () => {
    const m = await loadFreshModule();
    expect(m.FREE_LIMITS).toEqual({
      summariesPerMonth: 10,
      chatMessagesPerVideo: 5,
      historyItems: 10,
    });
    expect(m.ANON_LIMITS).toEqual({ summariesLifetime: 1 });
  });
});

describe("getYearMonthUtc", () => {
  it("formats UTC year-month", async () => {
    const { getYearMonthUtc } = await loadFreshModule();
    expect(getYearMonthUtc(new Date("2026-04-29T23:59:00Z"))).toBe("2026-04");
    expect(getYearMonthUtc(new Date("2026-04-30T23:59:00Z"))).toBe("2026-04");
    expect(getYearMonthUtc(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05");
  });
});

describe("getUserTier", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });
  afterEach(() => vi.restoreAllMocks());

  function stubRow(row: unknown, error: { code?: string } | null = null) {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error }),
        }),
      }),
    });
  }

  it("returns 'free' when no subscription row exists", async () => {
    stubRow(null);
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("u1")).toBe("free");
  });

  it("returns 'pro' when tier='pro' in row", async () => {
    stubRow({ tier: "pro" });
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("u1")).toBe("pro");
  });

  it("returns 'free' on infra error (fail-open to free)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubRow(null, { code: "PGRST301" });
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("u1")).toBe("free");
  });
});
```

- [ ] **Step 2: Run, expect fail**

```
pnpm vitest run lib/services/__tests__/entitlements.test.ts
```

- [ ] **Step 3: Implement the skeleton**

```ts
// lib/services/entitlements.ts
import { getServiceRoleClient } from "@/lib/supabase/service-role";

export const FREE_LIMITS = {
  summariesPerMonth: 10,
  chatMessagesPerVideo: 5,
  historyItems: 10,
} as const;

export const ANON_LIMITS = {
  summariesLifetime: 1,
} as const;

const DEPLOY_DEFECT_CODES = new Set(["42883", "42501"]);

export type Tier = "anon" | "free" | "pro";

export type EntitlementResult =
  | { tier: "anon" | "free"; allowed: true; remaining: number; reason: "within_limit" | "fail_open" }
  | { tier: "anon" | "free"; allowed: false; remaining: 0; reason: "exceeded" }
  | { tier: "pro"; allowed: true; remaining: number; reason: "unlimited" };

export function getYearMonthUtc(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Reads `user_subscriptions.tier` directly. Fail-open to 'free' on infra
 * errors — preferable to 500-ing a legitimate request, and the worst case
 * is a paying user briefly hitting free caps until the read recovers.
 */
export async function getUserTier(userId: string): Promise<"free" | "pro"> {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for getUserTier", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return "free";
  }
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[entitlements] getUserTier error (fail-open to free)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_TIER_READ",
      userId,
      code: (error as { code?: string }).code,
    });
    return "free";
  }
  if (!data) return "free";
  return data.tier === "pro" ? "pro" : "free";
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/services/entitlements.ts lib/services/__tests__/entitlements.test.ts
git commit -m "feat(paywall): entitlements module skeleton + getUserTier"
```

---

## Task 7: Entitlement service — `checkSummaryEntitlement` (free + pro)

**Files:**
- Modify: `lib/services/entitlements.ts`
- Modify: `lib/services/__tests__/entitlements.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the existing test file:

```ts
describe("checkSummaryEntitlement (signed-in users)", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  function stubTier(tier: "free" | "pro") {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { tier }, error: null }),
        }),
      }),
    });
  }

  it("Pro: returns unlimited regardless of count", async () => {
    stubTier("pro");
    mocks.rpc.mockResolvedValue({ data: 9999, error: null }); // shouldn't be consulted
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r).toMatchObject({ tier: "pro", allowed: true, reason: "unlimited" });
  });

  it("Free under cap: allowed=true, remaining=limit-count", async () => {
    stubTier("free");
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    const { checkSummaryEntitlement, FREE_LIMITS } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r).toEqual({
      tier: "free",
      allowed: true,
      remaining: FREE_LIMITS.summariesPerMonth - 3,
      reason: "within_limit",
    });
  });

  it("Free at boundary (count===10): allowed", async () => {
    stubTier("free");
    mocks.rpc.mockResolvedValue({ data: 10, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("Free over cap (count===11): denied", async () => {
    stubTier("free");
    mocks.rpc.mockResolvedValue({ data: 11, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r).toEqual({
      tier: "free",
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
  });

  it("Free RPC error: fail-open with errorId", async () => {
    stubTier("free");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
    expect(err).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

Append to `entitlements.ts`:

```ts
type CheckSummaryArgs =
  | { userId: string; isAnon: false }
  | { anonId: string; isAnon: true };

export async function checkSummaryEntitlement(
  args: CheckSummaryArgs
): Promise<EntitlementResult> {
  if (args.isAnon) {
    return checkAnonSummaryEntitlement(args.anonId);
  }
  return checkSignedInSummaryEntitlement(args.userId);
}

async function checkSignedInSummaryEntitlement(
  userId: string
): Promise<EntitlementResult> {
  const tier = await getUserTier(userId);
  if (tier === "pro") {
    return { tier: "pro", allowed: true, remaining: Number.POSITIVE_INFINITY, reason: "unlimited" };
  }

  const limit = FREE_LIMITS.summariesPerMonth;
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for summary check", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }

  const yearMonth = getYearMonthUtc();

  try {
    const { data, error } = await supabase.rpc("increment_monthly_summary", {
      p_user_id: userId,
      p_year_month: yearMonth,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      const tag = code && DEPLOY_DEFECT_CODES.has(code)
        ? "ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT"
        : "ENTITLEMENT_FAIL_OPEN_RPC";
      console.error("[entitlements] summary RPC error (fail-open)", {
        errorId: tag, userId, code, error,
      });
      return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
    }
    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[entitlements] summary RPC bad data (fail-open)", {
        errorId: "ENTITLEMENT_FAIL_OPEN_BAD_DATA", userId, data,
      });
      return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
    }
    if (count > limit) {
      return { tier: "free", allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      tier: "free",
      allowed: true,
      remaining: Math.max(0, limit - count),
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[entitlements] summary check threw (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_UNEXPECTED", userId, err,
    });
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }
}

// Stub for now — Task 8 implements
async function checkAnonSummaryEntitlement(anonId: string): Promise<EntitlementResult> {
  void anonId;
  return { tier: "anon", allowed: true, remaining: ANON_LIMITS.summariesLifetime, reason: "fail_open" };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/services/entitlements.ts lib/services/__tests__/entitlements.test.ts
git commit -m "feat(paywall): checkSummaryEntitlement for free/pro signed-in users"
```

---

## Task 8: Entitlement service — `checkSummaryEntitlement` (anon)

**Files:**
- Modify: `lib/services/entitlements.ts`
- Modify: `lib/services/__tests__/entitlements.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("checkSummaryEntitlement (anon)", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  it("first use: allowed, remaining=0 after this call", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    const { checkSummaryEntitlement, ANON_LIMITS } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      anonId: "11111111-1111-1111-1111-111111111111",
      isAnon: true,
    });
    expect(r).toEqual({
      tier: "anon",
      allowed: true,
      remaining: ANON_LIMITS.summariesLifetime - 1,
      reason: "within_limit",
    });
  });

  it("second use: denied", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      anonId: "11111111-1111-1111-1111-111111111111",
      isAnon: true,
    });
    expect(r).toEqual({
      tier: "anon",
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
  });

  it("RPC error: fail-open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { checkSummaryEntitlement, ANON_LIMITS } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      anonId: "11111111-1111-1111-1111-111111111111",
      isAnon: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
    expect(r.remaining).toBe(ANON_LIMITS.summariesLifetime);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Replace the stub `checkAnonSummaryEntitlement`** with:

```ts
async function checkAnonSummaryEntitlement(
  anonId: string
): Promise<EntitlementResult> {
  const limit = ANON_LIMITS.summariesLifetime;
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for anon check", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
  }

  try {
    const { data, error } = await supabase.rpc("increment_anon_summary_quota", {
      p_anon_id: anonId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      const tag = code && DEPLOY_DEFECT_CODES.has(code)
        ? "ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT"
        : "ENTITLEMENT_FAIL_OPEN_RPC";
      console.error("[entitlements] anon RPC error (fail-open)", {
        errorId: tag, anonId, code, error,
      });
      return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
    }
    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) {
      console.error("[entitlements] anon RPC bad data (fail-open)", {
        errorId: "ENTITLEMENT_FAIL_OPEN_BAD_DATA", anonId, data,
      });
      return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
    }
    if (count > limit) {
      return { tier: "anon", allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      tier: "anon",
      allowed: true,
      remaining: Math.max(0, limit - count),
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[entitlements] anon check threw (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_UNEXPECTED", anonId, err,
    });
    return { tier: "anon", allowed: true, remaining: limit, reason: "fail_open" };
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/services/entitlements.ts lib/services/__tests__/entitlements.test.ts
git commit -m "feat(paywall): checkSummaryEntitlement for anon users"
```

---

## Task 9: Entitlement service — `checkChatEntitlement`

Per-video chat cap. No new RPC; query existing `chat_messages` table. Pro user → unlimited.

**Files:**
- Modify: `lib/services/entitlements.ts`
- Modify: `lib/services/__tests__/entitlements.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("checkChatEntitlement", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  function stubChain(opts: {
    tier: "free" | "pro";
    chatCount?: number;
    chatError?: { code?: string } | null;
  }) {
    let call = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "user_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { tier: opts.tier }, error: null }),
            }),
          }),
        };
      }
      if (table === "chat_messages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({
                  count: opts.chatCount ?? 0,
                  error: opts.chatError ?? null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) call=${++call}`);
    });
  }

  it("Pro: unlimited", async () => {
    stubChain({ tier: "pro", chatCount: 50 });
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r).toMatchObject({ tier: "pro", allowed: true, reason: "unlimited" });
  });

  it("Free under cap: allowed", async () => {
    stubChain({ tier: "free", chatCount: 2 });
    const { checkChatEntitlement, FREE_LIMITS } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r).toEqual({
      tier: "free",
      allowed: true,
      remaining: FREE_LIMITS.chatMessagesPerVideo - 2,
      reason: "within_limit",
    });
  });

  it("Free at boundary (count===5): denied (this would be the 6th)", async () => {
    stubChain({ tier: "free", chatCount: 5 });
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r).toEqual({
      tier: "free",
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
  });

  it("Free count error: fail-open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubChain({ tier: "free", chatError: { code: "42501" } });
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Append `checkChatEntitlement`**

```ts
/**
 * Per-video chat cap. We query existing chat_messages rather than a
 * dedicated counter: row volume is bounded (≤ FREE_LIMITS.chatMessagesPerVideo
 * for free, unbounded for pro but pro skips this branch). The (summary_id,
 * user_id) index makes this O(log n).
 *
 * NOTE: this counts EXISTING messages — call this BEFORE writing the new
 * user message. count === 5 means "5 already exist, this would be the 6th",
 * which is the cap-hit case for free (limit is 5 messages total).
 */
export async function checkChatEntitlement(
  userId: string,
  summaryId: string
): Promise<EntitlementResult> {
  const tier = await getUserTier(userId);
  if (tier === "pro") {
    return { tier: "pro", allowed: true, remaining: Number.POSITIVE_INFINITY, reason: "unlimited" };
  }

  const limit = FREE_LIMITS.chatMessagesPerVideo;
  const supabase = getServiceRoleClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") {
      console.error("[entitlements] service-role missing for chat check", {
        errorId: "ENTITLEMENT_FAIL_OPEN_NO_CREDS",
      });
    }
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }

  try {
    const { count, error } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("summary_id", summaryId)
      .eq("user_id", userId)
      .eq("role", "user");
    if (error) {
      const code = (error as { code?: string }).code;
      const tag = code && DEPLOY_DEFECT_CODES.has(code)
        ? "ENTITLEMENT_FAIL_OPEN_DEPLOY_DEFECT"
        : "ENTITLEMENT_FAIL_OPEN_CHAT_COUNT";
      console.error("[entitlements] chat count error (fail-open)", {
        errorId: tag, userId, summaryId, code,
      });
      return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
    }
    const used = count ?? 0;
    if (used >= limit) {
      return { tier: "free", allowed: false, remaining: 0, reason: "exceeded" };
    }
    return {
      tier: "free",
      allowed: true,
      remaining: limit - used,
      reason: "within_limit",
    };
  } catch (err) {
    console.error("[entitlements] chat check threw (fail-open)", {
      errorId: "ENTITLEMENT_FAIL_OPEN_UNEXPECTED", userId, summaryId, err,
    });
    return { tier: "free", allowed: true, remaining: limit, reason: "fail_open" };
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/services/entitlements.ts lib/services/__tests__/entitlements.test.ts
git commit -m "feat(paywall): checkChatEntitlement (per-video cap from chat_messages)"
```

---

## Task 10: Wire entitlement check into `/api/summarize/stream`

Insert immediately after the existing `checkRateLimit` block at `app/api/summarize/stream/route.ts:223`. The check applies to **both** signed-in (free or pro) and anonymous users.

**Files:**
- Modify: `app/api/summarize/stream/route.ts`
- Modify: `app/api/summarize/stream/__tests__/route.test.ts`

- [ ] **Step 1: Add failing tests** (extend the existing test file's mocks)

In `__tests__/route.test.ts`, add a hoisted mock entry:

```ts
// alongside the existing checkRateLimit mock
checkSummaryEntitlement: vi.fn(),
```

In the `vi.mock` for `lib/services/rate-limit`, add:

```ts
vi.mock("@/lib/services/entitlements", () => ({
  checkSummaryEntitlement: mocks.checkSummaryEntitlement,
  // re-export the constants used by route logic
  FREE_LIMITS: { summariesPerMonth: 10, chatMessagesPerVideo: 5, historyItems: 10 },
  ANON_LIMITS: { summariesLifetime: 1 },
}));
```

Add cases (after the existing rate-limit cases):

```ts
it("returns 402 with upgrade payload when free user exceeded monthly cap", async () => {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, reason: "within_limit" });
  mocks.checkSummaryEntitlement.mockResolvedValue({
    tier: "free", allowed: false, remaining: 0, reason: "exceeded",
  });
  // call the route handler with a valid signed-in body
  const res = await callRoute({ youtube_url: "https://www.youtube.com/watch?v=abc12345678" });
  expect(res.status).toBe(402);
  const body = await res.json();
  expect(body.errorCode).toBe("free_quota_exceeded");
  expect(body.upgradeUrl).toBe("/pricing");
});

it("returns 402 with anon-signup payload when anon exceeded lifetime cap", async () => {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reason: "within_limit" });
  mocks.checkSummaryEntitlement.mockResolvedValue({
    tier: "anon", allowed: false, remaining: 0, reason: "exceeded",
  });
  const res = await callRoute({ youtube_url: "..." });
  expect(res.status).toBe(402);
  const body = await res.json();
  expect(body.errorCode).toBe("anon_quota_exceeded");
});

it("logs fail_open without surfacing it in the response", async () => {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, reason: "within_limit" });
  mocks.checkSummaryEntitlement.mockResolvedValue({
    tier: "free", allowed: true, remaining: 10, reason: "fail_open",
  });
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  // Drive request to the point where streaming starts; test passes if 200/SSE.
  // ... existing harness ...
  expect(err).toHaveBeenCalledWith(
    expect.stringContaining("entitlement bypassed"),
    expect.objectContaining({ errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST" }),
  );
});
```

(The exact `callRoute` helper exists in this test file already — match its style.)

- [ ] **Step 2: Run, expect fail**

```
pnpm vitest run app/api/summarize/stream
```

- [ ] **Step 3: Modify the route**

In `app/api/summarize/stream/route.ts`, after the existing rate-limit block (currently ending around line 240), add:

```ts
import { checkSummaryEntitlement } from "@/lib/services/entitlements";
import { cookies } from "next/headers";
import { ANON_COOKIE_NAME, signAnonId, verifyAnonId } from "@/lib/services/anon-cookie";
import { randomUUID } from "node:crypto";

// ... inside POST, just after the existing checkRateLimit block:

// Resolve anon-id cookie for anonymous users. Set-Cookie is applied later
// via the response headers if we minted a new id.
let anonId: string | null = null;
let setAnonCookie: string | null = null;
if (isAnonymous) {
  const jar = await cookies();
  const existing = jar.get(ANON_COOKIE_NAME)?.value ?? null;
  const verified = existing ? verifyAnonId(existing) : null;
  if (verified) {
    anonId = verified;
  } else {
    const fresh = randomUUID();
    const signed = signAnonId(fresh);
    if (signed) {
      anonId = fresh;
      setAnonCookie = signed;
    }
  }
}

const entitlement = anonId
  ? await checkSummaryEntitlement({ anonId, isAnon: true })
  : await checkSummaryEntitlement({ userId: authedUser.id, isAnon: false });

if (entitlement.reason === "fail_open") {
  console.error("[summarize/stream] entitlement bypassed (fail-open)", {
    stage: "unknown" satisfies LogStage,
    errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST",
    userId: authedUser.id,
    isAnonymous,
    youtubeUrl: youtube_url,
  });
}
if (!entitlement.allowed) {
  const errorCode = entitlement.tier === "anon"
    ? "anon_quota_exceeded"
    : "free_quota_exceeded";
  return new Response(
    JSON.stringify({
      message:
        entitlement.tier === "anon"
          ? "Sign up to keep using the app — get 10 free summaries each month."
          : "You've used your 10 free summaries this month. Upgrade for unlimited.",
      errorCode,
      tier: entitlement.tier,
      upgradeUrl: "/pricing",
    }),
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        ...(setAnonCookie && {
          "Set-Cookie": `${ANON_COOKIE_NAME}=${setAnonCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
        }),
      },
    }
  );
}
```

For the success-path Set-Cookie: append `setAnonCookie` to the SSE response headers when constructing the streaming `Response`. Match the existing header-merge pattern in the file.

- [ ] **Step 4: Run tests**

```
pnpm vitest run app/api/summarize/stream
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add app/api/summarize/stream/route.ts app/api/summarize/stream/__tests__/route.test.ts
git commit -m "feat(paywall): enforce summary entitlement in /api/summarize/stream"
```

---

## Task 11: FIFO history eviction for free users

When a free user creates a new summary that lands in `user_video_history`, if the user already has 10 rows, delete the oldest by `accessed_at` in the same transaction.

The current write happens inside `lib/services/summarize-cache.ts` (history insert at the bottom of the cache write path). The cleanest place to add eviction is a new `enforceHistoryCap(supabase, userId, capacity)` helper called immediately after the upsert.

**Files:**
- Modify: `lib/services/summarize-cache.ts`
- Create: `lib/services/__tests__/summarize-cache-history-cap.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { enforceFreeHistoryCap } from "../summarize-cache";

type FakeRow = { id: string; accessed_at: string };

function makeSupabase(opts: {
  // Rows beyond the capacity (i.e. what the .range(capacity, capacity+99) call will return)
  rowsBeyondCapacity?: FakeRow[];
  selectError?: { code: string } | null;
  deleteError?: { code: string } | null;
}) {
  const calls: { op: string; payload: unknown }[] = [];
  const select = {
    select(_cols: string) { return select; },
    eq(_c: string, _v: string) { return select; },
    order() { return select; },
    range(start: number, end: number) {
      calls.push({ op: "range", payload: { start, end } });
      return Promise.resolve({
        data: opts.rowsBeyondCapacity ?? [],
        error: opts.selectError ?? null,
      });
    },
  };
  const del = {
    delete() { return { in: (col: string, ids: string[]) => {
      calls.push({ op: "delete", payload: { col, ids } });
      return Promise.resolve({ error: opts.deleteError ?? null });
    }}; },
  };
  return {
    client: { from: (_t: string) => ({ ...select, ...del }) } as unknown as Parameters<typeof enforceFreeHistoryCap>[0],
    calls,
  };
}

describe("enforceFreeHistoryCap", () => {
  it("noop when no rows beyond capacity", async () => {
    const { client, calls } = makeSupabase({ rowsBeyondCapacity: [] });
    await enforceFreeHistoryCap(client, "u1", 10);
    expect(calls.find((c) => c.op === "delete")).toBeUndefined();
    expect(calls.find((c) => c.op === "range")).toEqual({
      op: "range",
      payload: { start: 10, end: 109 },
    });
  });

  it("deletes the single oldest row when one is past capacity", async () => {
    const { client, calls } = makeSupabase({
      rowsBeyondCapacity: [{ id: "row-oldest", accessed_at: "2026-04-01T00:00:00Z" }],
    });
    await enforceFreeHistoryCap(client, "u1", 10);
    expect(calls.find((c) => c.op === "delete")?.payload).toEqual({
      col: "id",
      ids: ["row-oldest"],
    });
  });

  it("deletes multiple rows when many are past capacity", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, accessed_at: "2026-01-01T00:00:00Z",
    }));
    const { client, calls } = makeSupabase({ rowsBeyondCapacity: rows });
    await enforceFreeHistoryCap(client, "u1", 10);
    expect(calls.find((c) => c.op === "delete")?.payload).toEqual({
      col: "id", ids: ["r0", "r1", "r2", "r3", "r4"],
    });
  });

  it("logs and returns when SELECT fails (no throw)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = makeSupabase({
      selectError: { code: "42P01" },
    });
    await expect(enforceFreeHistoryCap(client, "u1", 10)).resolves.toBeUndefined();
    expect(calls.find((c) => c.op === "delete")).toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("history-cap query failed"),
      expect.objectContaining({ errorId: "HISTORY_CAP_QUERY_FAIL" }),
    );
  });

  it("logs and returns when DELETE fails (best-effort, no throw)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeSupabase({
      rowsBeyondCapacity: [{ id: "x", accessed_at: "2026-01-01T00:00:00Z" }],
      deleteError: { code: "42501" },
    });
    await expect(enforceFreeHistoryCap(client, "u1", 10)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("history-cap delete failed"),
      expect.objectContaining({ errorId: "HISTORY_CAP_DELETE_FAIL" }),
    );
  });
});
```

- [ ] **Step 2: Run, expect fail (function not exported)**

- [ ] **Step 3: Implement helper**

In `lib/services/summarize-cache.ts`, add:

```ts
/**
 * For free-tier users, keeps user_video_history at most `capacity` rows.
 * Called after the history upsert; if the row count exceeds capacity,
 * delete the oldest (lowest accessed_at) rows. Best-effort: errors are
 * logged but not thrown — a transient eviction failure is far better
 * than failing the whole summary write.
 */
export async function enforceFreeHistoryCap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  capacity: number,
): Promise<void> {
  // Find IDs to evict: anything past the capacity-th most-recent row.
  const { data, error } = await supabase
    .from("user_video_history")
    .select("id, accessed_at")
    .eq("user_id", userId)
    .order("accessed_at", { ascending: false })
    .range(capacity, capacity + 99); // grab up to 100 stale rows in one shot

  if (error) {
    console.error("[summarize-cache] history-cap query failed", {
      errorId: "HISTORY_CAP_QUERY_FAIL", userId, code: error.code,
    });
    return;
  }
  if (!data || data.length === 0) return;

  const ids = data.map((r: { id: string }) => r.id);
  const del = await supabase.from("user_video_history").delete().in("id", ids);
  if (del.error) {
    console.error("[summarize-cache] history-cap delete failed", {
      errorId: "HISTORY_CAP_DELETE_FAIL", userId, ids, code: del.error.code,
    });
  }
}
```

Then, in the existing `writeUserVideoHistory` (or whatever inserts to `user_video_history`) call site, after the upsert:

```ts
import { getUserTier, FREE_LIMITS } from "./entitlements";

// ... after the existing upsert ...
const tier = await getUserTier(userId);
if (tier === "free") {
  await enforceFreeHistoryCap(supabase, userId, FREE_LIMITS.historyItems);
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add lib/services/summarize-cache.ts lib/services/__tests__/summarize-cache-history-cap.test.ts
git commit -m "feat(paywall): FIFO history eviction for free-tier users"
```

---

## Task 12: Wire entitlement check into `/api/chat/stream`

The chat endpoint currently authenticates, runs `checkRateLimit`, then resolves the cached summary + transcript. Insert `checkChatEntitlement` AFTER the cached summary lookup, because we need `summaryId` (= `cachedSummary.id`) for the per-video count.

**Files:**
- Modify: `app/api/chat/stream/route.ts`
- Modify: `app/api/chat/stream/__tests__/route.test.ts`

- [ ] **Step 1: Add failing tests** (mirror Task 10's structure)

```ts
// In the route.test.ts hoisted mocks:
checkChatEntitlement: vi.fn(),

vi.mock("@/lib/services/entitlements", () => ({
  checkChatEntitlement: mocks.checkChatEntitlement,
  FREE_LIMITS: { chatMessagesPerVideo: 5, summariesPerMonth: 10, historyItems: 10 },
  ANON_LIMITS: { summariesLifetime: 1 },
}));

it("402 when free user has used 5 messages on this video", async () => {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, reason: "within_limit" });
  mocks.checkChatEntitlement.mockResolvedValue({
    tier: "free", allowed: false, remaining: 0, reason: "exceeded",
  });
  const res = await callChatRoute(/* valid body */);
  expect(res.status).toBe(402);
  const body = await res.json();
  expect(body.errorCode).toBe("free_chat_exceeded");
});

it("logs fail_open without affecting the response", async () => {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, reason: "within_limit" });
  mocks.checkChatEntitlement.mockResolvedValue({
    tier: "free", allowed: true, remaining: 5, reason: "fail_open",
  });
  // ... run, expect 200/SSE, expect console.error called with errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST" ...
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Modify the route**

In `app/api/chat/stream/route.ts`, after `cachedSummary` is resolved (around line 113):

```ts
import { checkChatEntitlement } from "@/lib/services/entitlements";

// ... after `if (!cachedSummary || !cachedTranscript) { return jsonError(404, ...); }`:

const entitlement = await checkChatEntitlement(userId, cachedSummary.id);
if (entitlement.reason === "fail_open") {
  console.error("[chat/stream] entitlement bypassed (fail-open)", {
    errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST",
    userId,
    summaryId: cachedSummary.id,
  });
}
if (!entitlement.allowed) {
  return new Response(
    JSON.stringify({
      message: "You've used your 5 free chat messages on this video. Upgrade for unlimited.",
      errorCode: "free_chat_exceeded",
      tier: entitlement.tier,
      upgradeUrl: "/pricing",
    }),
    { status: 402, headers: { "Content-Type": "application/json" } }
  );
}
```

- [ ] **Step 4: Run tests + lint**

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/stream/route.ts app/api/chat/stream/__tests__/route.test.ts
git commit -m "feat(paywall): enforce per-video chat entitlement in /api/chat/stream"
```

---

## Task 13: `GET /api/me/entitlements`

Returns the current user's tier + caps to drive the UI hook in plan 3. Reads only — no mutation. Anonymous users get `{ tier: "anon", caps: { ... } }` derived from cookie + RPC count.

**Files:**
- Create: `app/api/me/entitlements/route.ts`
- Create: `app/api/me/entitlements/__tests__/route.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// app/api/me/entitlements/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserTier: vi.fn(),
  cookieGet: vi.fn(),
  verifyAnonId: vi.fn(),
  fromAnon: vi.fn(),
  fromUsage: vi.fn(),
  fromHistory: vi.fn(),
  fromSub: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/services/anon-cookie", () => ({
  ANON_COOKIE_NAME: "yt_anon_id",
  verifyAnonId: mocks.verifyAnonId,
}));

vi.mock("@/lib/services/entitlements", () => ({
  ANON_LIMITS: { summariesLifetime: 1 },
  FREE_LIMITS: { summariesPerMonth: 10, chatMessagesPerVideo: 5, historyItems: 10 },
  getUserTier: mocks.getUserTier,
  getYearMonthUtc: () => "2026-04",
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "anon_summary_quota") return { select: () => ({ eq: () => ({ maybeSingle: mocks.fromAnon }) }) };
      if (table === "monthly_summary_usage") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.fromUsage }) }) }) };
      if (table === "user_video_history") return { select: () => ({ eq: () => mocks.fromHistory() }) };
      if (table === "user_subscriptions") return { select: () => ({ eq: () => ({ maybeSingle: mocks.fromSub }) }) };
      throw new Error(`unexpected ${table}`);
    },
  }),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("GET /api/me/entitlements", () => {
  it("returns anon tier with count=0 when not signed in and no cookie", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.cookieGet.mockReturnValue(undefined);
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      tier: "anon",
      caps: { summariesUsed: 0, summariesLimit: 1 },
    });
  });

  it("returns anon tier with current count when cookie verifies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.cookieGet.mockReturnValue({ value: "signed.sig" });
    mocks.verifyAnonId.mockReturnValue("aaaa-bbbb");
    mocks.fromAnon.mockResolvedValue({ data: { count: 1 }, error: null });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.tier).toBe("anon");
    expect(body.caps.summariesUsed).toBe(1);
    expect(body.caps.summariesLimit).toBe(1);
  });

  it("returns pro tier with subscription details", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } }, error: null,
    });
    mocks.getUserTier.mockResolvedValue("pro");
    mocks.fromSub.mockResolvedValue({
      data: { plan: "yearly", current_period_end: "2027-04-01T00:00:00Z", cancel_at_period_end: false },
      error: null,
    });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.tier).toBe("pro");
    expect(body.caps.summariesLimit).toBe(-1);
    expect(body.subscription).toEqual({
      plan: "yearly",
      current_period_end: "2027-04-01T00:00:00Z",
      cancel_at_period_end: false,
    });
  });

  it("returns free tier with current monthly + history counts", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } }, error: null,
    });
    mocks.getUserTier.mockResolvedValue("free");
    mocks.fromUsage.mockResolvedValue({ data: { count: 4 }, error: null });
    mocks.fromHistory.mockResolvedValue({ count: 7, error: null });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      tier: "free",
      caps: {
        summariesUsed: 4, summariesLimit: 10,
        historyUsed: 7, historyLimit: 10,
      },
    });
  });

  it("returns free tier with zeros when service-role unavailable", async () => {
    // Force getServiceRoleClient to return null by overriding the mock
    vi.doMock("@/lib/supabase/service-role", () => ({ getServiceRoleClient: () => null }));
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } }, error: null,
    });
    mocks.getUserTier.mockResolvedValue("free");
    vi.resetModules();
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.tier).toBe("free");
    expect(body.caps.summariesUsed).toBe(0);
    expect(body.caps.historyUsed).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// app/api/me/entitlements/route.ts
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ANON_LIMITS,
  FREE_LIMITS,
  getUserTier,
  getYearMonthUtc,
} from "@/lib/services/entitlements";
import { ANON_COOKIE_NAME, verifyAnonId } from "@/lib/services/anon-cookie";

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  // ─── Anonymous branch ───────────────────────────────────────────
  if (!user) {
    const jar = await cookies();
    const cookieVal = jar.get(ANON_COOKIE_NAME)?.value ?? null;
    const anonId = cookieVal ? verifyAnonId(cookieVal) : null;
    let used = 0;
    if (anonId) {
      const sr = getServiceRoleClient();
      if (sr) {
        const { data } = await sr
          .from("anon_summary_quota")
          .select("count")
          .eq("anon_id", anonId)
          .maybeSingle();
        used = data?.count ?? 0;
      }
    }
    return Response.json({
      tier: "anon",
      caps: {
        summariesUsed: used,
        summariesLimit: ANON_LIMITS.summariesLifetime,
      },
    });
  }

  // ─── Signed-in branch ──────────────────────────────────────────
  const userId = user.id;
  const isAnonAuth = user.is_anonymous ?? false;

  const tier = await getUserTier(userId);
  const sr = getServiceRoleClient();

  // Pro
  if (tier === "pro" && sr) {
    const { data: sub } = await sr
      .from("user_subscriptions")
      .select("plan, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    return Response.json({
      tier: "pro",
      caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
      subscription: sub ?? null,
    });
  }

  // Free (or fallback when service-role missing) — best-effort current values
  let summariesUsed = 0;
  let historyUsed = 0;
  if (sr) {
    const ym = getYearMonthUtc();
    const [{ data: usageRow }, { count: histCount }] = await Promise.all([
      sr.from("monthly_summary_usage")
        .select("count")
        .eq("user_id", userId)
        .eq("year_month", ym)
        .maybeSingle(),
      sr.from("user_video_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);
    summariesUsed = usageRow?.count ?? 0;
    historyUsed = histCount ?? 0;
  }

  return Response.json({
    tier: isAnonAuth ? "anon" : "free", // is_anonymous Supabase users are still gated as anon
    caps: {
      summariesUsed,
      summariesLimit: isAnonAuth
        ? ANON_LIMITS.summariesLifetime
        : FREE_LIMITS.summariesPerMonth,
      historyUsed,
      historyLimit: FREE_LIMITS.historyItems,
    },
  });
}
```

- [ ] **Step 4: Run tests + lint**

- [ ] **Step 5: Commit**

```bash
git add app/api/me/entitlements
git commit -m "feat(paywall): GET /api/me/entitlements for UI consumption"
```

---

## Task 14: E2E smoke + lint + final commit

- [ ] **Step 1: Run the full test suite**

```
pnpm vitest run
pnpm lint
```

- [ ] **Step 2: Run an e2e against `pnpm dev`** (per CLAUDE.md, required after a feature)

- Sign in as the test user (`~/.config/claude-test-creds/youtubeai.env`).
- Hit `/api/me/entitlements` — expect `tier: "free"`, `caps.summariesUsed` near 0.
- Confirm a summary submit still works and the count increments.
- Force `summariesUsed >= 10` (insert via `psql`/Supabase SQL editor in dev) and submit — expect 402 with `errorCode: "free_quota_exceeded"`.
- Clear the row, confirm it works again.

(In phase 1 there's no UI for this, so you're hitting the API directly with curl + the dev session cookie. Plan 3 wires the actual visual flow.)

- [ ] **Step 3: Commit any test fixes**

```bash
git commit -am "test(paywall): phase-1 smoke + lint cleanup" || echo "nothing to commit"
```

---

## Acceptance criteria for Phase 1

- [ ] All four migrations apply cleanly (CI `migration-upgrade-test` green)
- [ ] `pnpm vitest run` passes
- [ ] `pnpm lint` clean
- [ ] Free user at 11/10 monthly summaries: `/api/summarize/stream` returns 402 with `errorCode: "free_quota_exceeded"`
- [ ] Free user at 5/5 chat messages on a single video: `/api/chat/stream` returns 402 with `errorCode: "free_chat_exceeded"`
- [ ] Anonymous browser at 2/1 lifetime summaries: 402 with `errorCode: "anon_quota_exceeded"`
- [ ] Pro user (manually flip `user_subscriptions.tier='pro'` in dev) bypasses both caps
- [ ] `GET /api/me/entitlements` returns the spec-shaped payload for anon, free, and pro
- [ ] Free user creating an 11th history row evicts the oldest (verify via `select count(*) from user_video_history where user_id=$1` after a fresh seed)
- [ ] Fail-open paths log with stable `errorId` strings matching the spec (visible in dev console)
