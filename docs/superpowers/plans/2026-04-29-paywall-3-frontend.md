# Paywall — Phase 3: Frontend surfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the paywall visible. Users see why they hit a 402, can compare plans, click "Upgrade", and reach Stripe. Anonymous users see the right wall on the homepage and `/history`. Pro users see a "Manage subscription" link. Without this phase, phase 1's 402s are user-hostile (raw error toasts); with it, the paywall feels like product polish.

**Architecture:** A single `useEntitlements()` TanStack Query hook is the source of truth in the UI. A new `/pricing` page hosts the upgrade comparison. Existing pages (`/summary`, the chat tab, `/history`, the homepage) get inline upgrade UI keyed off the hook. New components live under `components/paywall/`. All UI uses the design-system tokens per `youtubeai_chat_frontend/CLAUDE.md`.

**Tech Stack:** Next.js 15 client components, TanStack Query (already installed), Radix primitives via `components/ui/*`, design-system tokens. Spec: [`docs/superpowers/specs/2026-04-29-paywall-design.md`](../specs/2026-04-29-paywall-design.md). Phase 1 + 2 prerequisites: [`paywall-1`](./2026-04-29-paywall-1-entitlements.md), [`paywall-2`](./2026-04-29-paywall-2-stripe.md).

**Spec sections this plan implements:** Frontend surfaces 1–5, Entitlements hook, the pricing/Manage-subscription routing, the soft warning thresholds.

**Design-system reminder:** Use only `components/ui/*` primitives + semantic tokens (`bg-surface-base`, `text-text-primary`, `bg-accent-brand`, etc.). Never raw palette colors. Never `bg-card`/`text-foreground` legacy shadcn tokens. See the frontend `CLAUDE.md` for the full contract.

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `lib/hooks/useEntitlements.ts` | TanStack Query hook reading `/api/me/entitlements` |
| `lib/hooks/__tests__/useEntitlements.test.tsx` | Hook tests with mocked fetch |
| `components/paywall/UpgradeCard.tsx` | Reusable upgrade-CTA card (used on summary cap, history empty, etc.) |
| `components/paywall/ChatCapBanner.tsx` | The 5/5 banner that disables chat input |
| `components/paywall/ChatCapCounter.tsx` | "3 of 5 free messages used" subtle counter |
| `components/paywall/AnonSignupWall.tsx` | Top-of-homepage prompt when anon hit lifetime |
| `components/paywall/HistoryAnonEmpty.tsx` | The "Sign up to save your summaries" empty state |
| `components/paywall/HistoryFreeBanner.tsx` | "10 of 10 — older summaries auto-replaced" header |
| `components/paywall/ManageSubscriptionLink.tsx` | Dropdown link → `/api/billing/portal` |
| `app/pricing/page.tsx` | Public Free vs Pro comparison + monthly/yearly toggle |
| `app/pricing/_components/PricingCard.tsx` | The two plan cards |
| `app/pricing/_components/PricingFAQ.tsx` | Cancel/refund/period-end Q&A |
| `components/paywall/__tests__/*.test.tsx` | Component tests |

**Modified files:**

| Path | Change |
|---|---|
| `app/summary/components/youtube-summarizer-app.tsx` | On 402 from `/api/summarize/stream`, render `<UpgradeCard variant="summary-cap" />` instead of an error toast |
| `app/summary/components/chat-tab.tsx` (or wherever chat input lives) | Show `<ChatCapBanner />` when 402 returned; show `<ChatCapCounter />` once `remaining <= 2` |
| `app/page.tsx` (or homepage hero component) | When `useEntitlements().tier === 'anon'` AND `summariesUsed >= summariesLimit`, render `<AnonSignupWall />` above the URL form |
| `app/history/page.tsx` | When anon, render `<HistoryAnonEmpty />`; when free, render `<HistoryFreeBanner />` above the list |
| `app/components/header.tsx` (or wherever the user dropdown is) | Pro users see "Manage subscription" — calls `/api/billing/portal` and `window.location.assign(url)` |
| `app/page.tsx` / `app/layout.tsx` | Inject TanStack Query provider if not already wrapping the app (if useEntitlements is the first hook to need it) |

---

## Task 1: `useEntitlements` hook

**Files:**
- Create: `lib/hooks/useEntitlements.ts`
- Create: `lib/hooks/__tests__/useEntitlements.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEntitlements } from "../useEntitlements";

const wrapper = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useEntitlements", () => {
  it("fetches and returns the entitlement payload", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        tier: "free",
        caps: { summariesUsed: 3, summariesLimit: 10, historyUsed: 7, historyLimit: 10 },
      }), { status: 200 })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tier).toBe("free");
    expect(result.current.data?.caps.summariesUsed).toBe(3);
  });

  it("returns isError when fetch fails", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("boom"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// lib/hooks/useEntitlements.ts
import { useQuery } from "@tanstack/react-query";

export type EntitlementsData = {
  tier: "anon" | "free" | "pro";
  caps: {
    summariesUsed: number;
    summariesLimit: number; // -1 = unlimited
    historyUsed?: number;
    historyLimit?: number;  // -1 = unlimited
  };
  subscription?: {
    plan?: "monthly" | "yearly" | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean | null;
  } | null;
};

async function fetchEntitlements(): Promise<EntitlementsData> {
  const res = await fetch("/api/me/entitlements", { cache: "no-store" });
  if (!res.ok) throw new Error(`entitlements ${res.status}`);
  return (await res.json()) as EntitlementsData;
}

export function useEntitlements() {
  return useQuery({
    queryKey: ["entitlements"],
    queryFn: fetchEntitlements,
    staleTime: 30_000, // refetch on auth change / billing success via invalidateQueries
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 4: Run, expect pass + commit**

```bash
git add lib/hooks/useEntitlements.ts lib/hooks/__tests__/useEntitlements.test.tsx
git commit -m "feat(paywall): useEntitlements hook"
```

---

## Task 2: `<UpgradeCard />` reusable component

The shared upgrade prompt. Three variants: `summary-cap`, `chat-cap`, `history-cap`. Renders a heading + body + CTA pair.

**Files:**
- Create: `components/paywall/UpgradeCard.tsx`
- Create: `components/paywall/__tests__/UpgradeCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UpgradeCard } from "../UpgradeCard";

describe("UpgradeCard", () => {
  it("renders the summary-cap copy", () => {
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/used your 10 free summaries/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upgrade/i })).toHaveAttribute("href", "/pricing");
  });
  it("renders the chat-cap copy", () => {
    render(<UpgradeCard variant="chat-cap" />);
    expect(screen.getByText(/free chat messages on this video/i)).toBeInTheDocument();
  });
  it("renders the history-cap copy", () => {
    render(<UpgradeCard variant="history-cap" />);
    expect(screen.getByText(/upgrade for unlimited history/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```tsx
// components/paywall/UpgradeCard.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Variant = "summary-cap" | "chat-cap" | "history-cap";

const COPY: Record<Variant, { title: string; body: string; reset?: string }> = {
  "summary-cap": {
    title: "You've used your 10 free summaries this month.",
    body: "Upgrade to Pro for unlimited summaries, chat, and history.",
    reset: "Resets on the 1st.",
  },
  "chat-cap": {
    title: "You've used your 5 free chat messages on this video.",
    body: "Upgrade to Pro for unlimited chat across every video.",
  },
  "history-cap": {
    title: "Showing 10 of 10 — older summaries auto-replaced.",
    body: "Upgrade for unlimited history.",
  },
};

export function UpgradeCard({ variant }: { variant: Variant }) {
  const copy = COPY[variant];
  return (
    <section
      className="rounded-2xl bg-surface-raised border border-border-subtle p-6 text-center"
      data-paywall-variant={variant}
    >
      <h2 className="text-h4 text-text-primary">{copy.title}</h2>
      <p className="mt-2 text-body-md text-text-secondary">{copy.body}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/pricing">
          <Button>Upgrade — $4.99/mo</Button>
        </Link>
        <Link href="/pricing">
          <Button variant="outline">See plans</Button>
        </Link>
      </div>
      {copy.reset && (
        <p className="mt-3 text-caption text-text-muted">{copy.reset}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run, expect pass + commit**

```bash
git add components/paywall
git commit -m "feat(paywall): UpgradeCard component (summary/chat/history variants)"
```

---

## Task 3: Wire summary cap into the summary page

Currently the summarize app handles 4xx/5xx generically. Add a 402 branch that renders `<UpgradeCard variant="summary-cap" />` instead of the error toast/banner.

**Files:**
- Modify: `app/summary/components/youtube-summarizer-app.tsx`
- Add a small test in the file's existing test suite if it has one, or in `app/summary/__tests__/`.

- [ ] **Step 1: Find the existing 4xx error path**

```bash
grep -n "status === 4\|response.status\|errorCode" app/summary/components/youtube-summarizer-app.tsx
```

- [ ] **Step 2: Add 402 handling**

In the fetch handler:

```tsx
if (res.status === 402) {
  const body = await res.json().catch(() => ({}));
  setUpgrade({ kind: body?.tier === "anon" ? "anon-cap" : "summary-cap" });
  // Do NOT set the generic error state.
  return;
}
```

Add `upgrade` state to the component:
```tsx
const [upgrade, setUpgrade] = useState<{ kind: "summary-cap" | "anon-cap" } | null>(null);
```

In the render branch:
```tsx
{upgrade?.kind === "summary-cap" && <UpgradeCard variant="summary-cap" />}
{upgrade?.kind === "anon-cap" && <AnonSignupWall reason="hit-cap" />}
```

Reset `upgrade` to `null` whenever a new submit starts.

- [ ] **Step 3: Test the 402 branch**

Add a test that injects a fake fetch response with status 402 and asserts `<UpgradeCard>` renders.

- [ ] **Step 4: Run + commit**

```bash
git add app/summary/components/youtube-summarizer-app.tsx
git commit -m "feat(paywall): summary-cap UpgradeCard replaces generic error on 402"
```

---

## Task 4: Chat cap — banner + counter

The chat tab currently posts to `/api/chat/stream`. Two changes:

1. **Counter** below the input that appears once `remaining <= 2` (silent at higher remaining): "3 of 5 free messages used"
2. **Banner** above the input replacing it when 402 returned (or when `remaining === 0`).

**Files:**
- Modify: `app/summary/components/chat-tab.tsx` (or wherever the chat input lives — find via `grep "ChatInput\|sendChatMessage"`)
- Create: `components/paywall/ChatCapBanner.tsx`
- Create: `components/paywall/ChatCapCounter.tsx`

- [ ] **Step 1: Build `<ChatCapBanner />`**

```tsx
// components/paywall/ChatCapBanner.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ChatCapBanner() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-4 text-center">
      <p className="text-body-md text-text-primary">
        You've used 5/5 free chat messages on this video.
      </p>
      <Link href="/pricing" className="mt-2 inline-block">
        <Button size="sm">Upgrade for unlimited chat — $4.99/mo</Button>
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Build `<ChatCapCounter />`**

```tsx
// components/paywall/ChatCapCounter.tsx
export function ChatCapCounter({ used, limit }: { used: number; limit: number }) {
  // Only render when within 2 of the cap (per spec — soft until close)
  if (used < limit - 2) return null;
  return (
    <p className="text-caption text-text-muted text-center mt-1">
      {used} of {limit} free messages used
    </p>
  );
}
```

- [ ] **Step 3: Wire into chat tab**

In the chat tab/component, track per-video usage from the chat-message list count + handle 402:

```tsx
const userMessageCount = messages.filter(m => m.role === "user").length;
const FREE_CHAT_LIMIT = 5;

// In the send handler:
if (res.status === 402) {
  setChatCapHit(true);
  return;
}

// Render:
{chatCapHit ? <ChatCapBanner /> : (
  <>
    <ChatInput ... />
    {tier === "free" && <ChatCapCounter used={userMessageCount} limit={FREE_CHAT_LIMIT} />}
  </>
)}
```

`tier` comes from `useEntitlements()`.

- [ ] **Step 4: Tests**

Component tests: render banner with cap-hit; render counter at usage 3, 4, 5 (visible) and at 0–2 (hidden).

- [ ] **Step 5: Run + commit**

```bash
git add app/summary/components/chat-tab.tsx components/paywall/ChatCapBanner.tsx components/paywall/ChatCapCounter.tsx
git commit -m "feat(paywall): chat-tab cap banner + soft remaining counter"
```

---

## Task 5: Anon homepage wall

When the homepage detects `tier === "anon"` and `summariesUsed >= summariesLimit`, render the signup wall above the URL form (and disable the form).

**Files:**
- Create: `components/paywall/AnonSignupWall.tsx`
- Modify: `app/components/hero-section.tsx` (or wherever the homepage hero/URL input lives — likely under `app/components/` based on existing files)

- [ ] **Step 1: Build `<AnonSignupWall />`**

```tsx
// components/paywall/AnonSignupWall.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Reason = "hit-cap" | "feature-locked";

export function AnonSignupWall({ reason }: { reason: Reason }) {
  const copy = reason === "hit-cap"
    ? "Try unlimited free — sign up to get 10 free summaries per month and our AI chat."
    : "Sign up to keep using the app — get 10 free summaries each month.";
  return (
    <section className="rounded-2xl bg-surface-raised border border-border-subtle p-6 text-center">
      <p className="text-body-md text-text-primary">{copy}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/auth/sign-up?redirect_to=/"><Button>Sign up free</Button></Link>
        <Link href="/auth/login?redirect_to=/"><Button variant="outline">I have an account</Button></Link>
      </div>
    </section>
  );
}
```

(Adjust the auth route paths to match the existing `app/auth/` routes.)

- [ ] **Step 2: Wire into the hero**

```tsx
const { data: ent } = useEntitlements();
const anonCapHit =
  ent?.tier === "anon" &&
  ent.caps.summariesUsed >= ent.caps.summariesLimit;

return (
  <>
    {anonCapHit && <AnonSignupWall reason="hit-cap" />}
    <UrlInputForm disabled={anonCapHit} />
  </>
);
```

- [ ] **Step 3: Test + commit**

```bash
git add components/paywall/AnonSignupWall.tsx app/components/hero-section.tsx
git commit -m "feat(paywall): anonymous homepage signup wall when lifetime cap hit"
```

---

## Task 6: History page — anon empty state + free counter banner

**Files:**
- Modify: `app/history/page.tsx`
- Create: `components/paywall/HistoryAnonEmpty.tsx`
- Create: `components/paywall/HistoryFreeBanner.tsx`

- [ ] **Step 1: Build the components**

```tsx
// components/paywall/HistoryAnonEmpty.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function HistoryAnonEmpty() {
  return (
    <section className="rounded-2xl bg-surface-raised border border-border-subtle p-12 text-center">
      <h2 className="text-h3 text-text-primary">Save and revisit your summaries.</h2>
      <p className="mt-2 text-body-md text-text-secondary">
        Sign up to keep a history of every video you've summarized.
      </p>
      <Link href="/auth/sign-up?redirect_to=/history" className="mt-4 inline-block">
        <Button>Sign up free</Button>
      </Link>
    </section>
  );
}

// components/paywall/HistoryFreeBanner.tsx
import Link from "next/link";

export function HistoryFreeBanner({ used, limit }: { used: number; limit: number }) {
  const atCap = used >= limit;
  return (
    <p className="text-body-sm text-text-secondary">
      Showing {Math.min(used, limit)} of {limit} — {atCap ? "older summaries auto-replaced. " : ""}
      <Link href="/pricing" className="text-accent-brand">Upgrade for unlimited history</Link>
    </p>
  );
}
```

- [ ] **Step 2: Wire into `/history`**

```tsx
// app/history/page.tsx — server component pseudo-shape
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (!user || (user.is_anonymous ?? false)) {
  return <HistoryAnonEmpty />;
}

const tier = await getUserTier(user.id);
const page = await getHistoryPage(supabase, user.id, requestedPage);

return (
  <>
    {tier === "free" && (
      <HistoryFreeBanner used={page.ok ? page.total : 0} limit={FREE_LIMITS.historyItems} />
    )}
    <HistoryList rows={page.ok ? page.rows : []} />
  </>
);
```

- [ ] **Step 3: Test + commit**

```bash
git add app/history/page.tsx components/paywall/HistoryAnonEmpty.tsx components/paywall/HistoryFreeBanner.tsx
git commit -m "feat(paywall): history anon empty state + free counter banner"
```

---

## Task 7: Manage subscription link

Pro users see a "Manage subscription" item in the user dropdown. Click → POST `/api/billing/portal` → redirect to Stripe.

**Files:**
- Create: `components/paywall/ManageSubscriptionLink.tsx`
- Modify: `app/components/header.tsx` (or wherever the user menu lives)

- [ ] **Step 1: Component**

```tsx
// components/paywall/ManageSubscriptionLink.tsx
"use client";
import { useState } from "react";

export function ManageSubscriptionLink() {
  const [pending, setPending] = useState(false);
  const onClick = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) throw new Error(`portal ${res.status}`);
      const body = await res.json();
      window.location.assign(body.url);
    } catch (err) {
      console.error("[paywall] portal navigation failed", err);
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-text-primary hover:bg-state-hover px-3 py-2 rounded-md text-body-sm w-full text-left"
    >
      {pending ? "Opening…" : "Manage subscription"}
    </button>
  );
}
```

- [ ] **Step 2: Wire into the user dropdown**

In the dropdown menu (only when `useEntitlements().data?.tier === "pro"`):

```tsx
{ent?.tier === "pro" && <ManageSubscriptionLink />}
```

- [ ] **Step 3: Commit**

```bash
git add components/paywall/ManageSubscriptionLink.tsx app/components/header.tsx
git commit -m "feat(paywall): manage subscription link for pro users"
```

---

## Task 8: `/pricing` page

Public landing page comparing Free vs Pro with the monthly/yearly toggle.

**Files:**
- Create: `app/pricing/page.tsx`
- Create: `app/pricing/_components/PricingCard.tsx`
- Create: `app/pricing/_components/PricingFAQ.tsx`

- [ ] **Step 1: Build PricingCard**

```tsx
// app/pricing/_components/PricingCard.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

type Plan = "monthly" | "yearly";

export function PricingProCard({ plan }: { plan: Plan }) {
  const router = useRouter();
  const { data: ent } = useEntitlements();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (!ent || ent.tier === "anon") {
      router.push("/auth/sign-up?redirect_to=/pricing?intent=upgrade");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error(`checkout ${res.status}`);
      const body = await res.json();
      window.location.assign(body.url);
    } catch {
      setPending(false);
    }
  };

  const price = plan === "yearly" ? "$4.99/mo" : "$6.99/mo";
  const billed = plan === "yearly" ? "billed $59.88 yearly" : "billed monthly";
  const cta = ent?.tier === "pro" ? "Current plan" : pending ? "Redirecting…" : "Upgrade";

  return (
    <section className="rounded-2xl border border-accent-brand bg-surface-raised p-6">
      <h3 className="text-h4 text-text-primary">Pro</h3>
      <p className="mt-1 text-display text-text-primary">{price}</p>
      <p className="text-caption text-text-muted">{billed}</p>
      <ul className="mt-4 space-y-2 text-body-md text-text-secondary">
        <li>Unlimited summaries</li>
        <li>Unlimited chat per video</li>
        <li>Unlimited history</li>
        <li>Cancel anytime</li>
      </ul>
      <Button
        className="mt-6 w-full"
        onClick={onClick}
        disabled={pending || ent?.tier === "pro"}
      >
        {cta}
      </Button>
    </section>
  );
}

export function PricingFreeCard() {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-raised p-6">
      <h3 className="text-h4 text-text-primary">Free</h3>
      <p className="mt-1 text-display text-text-primary">$0</p>
      <p className="text-caption text-text-muted">forever</p>
      <ul className="mt-4 space-y-2 text-body-md text-text-secondary">
        <li>10 summaries per month</li>
        <li>5 chat messages per video</li>
        <li>10-item history</li>
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Build the page with toggle**

```tsx
// app/pricing/page.tsx
"use client";
import { useState } from "react";
import { PricingFreeCard, PricingProCard } from "./_components/PricingCard";
import { PricingFAQ } from "./_components/PricingFAQ";

export default function PricingPage() {
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-h2 text-text-primary text-center">Simple pricing</h1>
      <p className="mt-2 text-body-md text-text-secondary text-center">
        Start free. Upgrade when you need more.
      </p>

      <div className="mt-6 flex justify-center gap-2">
        <button
          onClick={() => setPlan("yearly")}
          className={`px-4 py-2 rounded-md text-body-sm ${plan === "yearly" ? "bg-accent-brand text-text-inverse" : "text-text-secondary"}`}
        >
          Yearly · save 28%
        </button>
        <button
          onClick={() => setPlan("monthly")}
          className={`px-4 py-2 rounded-md text-body-sm ${plan === "monthly" ? "bg-accent-brand text-text-inverse" : "text-text-secondary"}`}
        >
          Monthly
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <PricingFreeCard />
        <PricingProCard plan={plan} />
      </div>

      <div className="mt-12">
        <PricingFAQ />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Build the FAQ**

```tsx
// app/pricing/_components/PricingFAQ.tsx
const items = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from the Manage subscription page. Pro stays active until the end of your current billing period.",
  },
  {
    q: "What happens at the end of my paid period if I cancel?",
    a: "You're moved back to the Free tier. Your summaries and chat history stay (subject to the Free 10-item history cap).",
  },
  {
    q: "Do you offer refunds?",
    a: "We don't process automatic refunds, but reach out — we'll handle exceptions case-by-case.",
  },
  {
    q: "What payment methods do you accept?",
    a: "All major credit and debit cards via Stripe.",
  },
];

export function PricingFAQ() {
  return (
    <section className="space-y-4">
      <h2 className="text-h4 text-text-primary">Common questions</h2>
      {items.map((it) => (
        <details key={it.q} className="rounded-lg border border-border-subtle bg-surface-raised p-4">
          <summary className="text-body-md text-text-primary cursor-pointer">{it.q}</summary>
          <p className="mt-2 text-body-sm text-text-secondary">{it.a}</p>
        </details>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Test + commit**

```bash
git add app/pricing
git commit -m "feat(paywall): /pricing page with monthly/yearly toggle and FAQ"
```

---

## Task 9: Invalidate entitlements after `/billing/success`

The success page (phase 2) polls until tier flips. To make sure the rest of the app re-reads, invalidate the `["entitlements"]` query when the success page detects pro.

**Files:**
- Modify: `app/billing/success/page.tsx`

- [ ] **Step 1: Update success page**

```tsx
import { useQueryClient } from "@tanstack/react-query";

const qc = useQueryClient();
// inside the polling tick where we set phase("ok"):
qc.invalidateQueries({ queryKey: ["entitlements"] });
```

- [ ] **Step 2: Commit**

```bash
git add app/billing/success/page.tsx
git commit -m "feat(paywall): invalidate entitlements query after billing success"
```

---

## Task 10: Documentation pass

- [ ] **Step 1: Update README**

In the frontend `README.md`, add a section under "Architecture" pointing at the spec doc and noting:
- `/pricing` is the upgrade page
- `/api/billing/checkout` and `/api/billing/portal` need Stripe env vars
- Webhook endpoint is `/api/webhooks/stripe`
- Local dev uses `stripe listen --forward-to localhost:3000/api/webhooks/stripe`

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(paywall): README pointer to spec + local dev setup"
```

---

## Task 11: E2E — full paywall walkthrough

**Files:**
- Create: `tests-utils/e2e/paywall-frontend.spec.ts` (match the project's existing e2e location)

- [ ] **Step 1: Tests**

1. **Anon homepage cap**: fresh browser context. Submit one summary — succeeds. Submit a second — page renders `<AnonSignupWall>`, URL form disabled, "Sign up free" button visible.
2. **Free user summary cap**: signed-in test user. Force `monthly_summary_usage.count = 11` via SQL. Visit `/summary?url=...`. Page renders `<UpgradeCard variant="summary-cap" />`, no error toast.
3. **Free user chat cap**: send 5 messages on one video. 6th attempt: `<ChatCapBanner>` replaces input, counter visible at 3/5, 4/5, 5/5.
4. **History anon**: anon visits `/history` → `<HistoryAnonEmpty>` rendered, "Sign up free" button.
5. **History free banner**: signed-in free user with 10 history items visits `/history` → counter visible.
6. **Pricing page → upgrade**: signed-in free user clicks "Upgrade" on `/pricing` (yearly), redirected to Stripe Checkout URL (test mode), completes purchase, lands on `/billing/success`, sees "Welcome to Pro!".
7. **Pro user**: after purchase, `<ChatCapBanner>` does not appear after 6+ messages; `/pricing` shows "Current plan".
8. **Manage subscription**: pro user clicks "Manage subscription" in dropdown → opens Stripe Customer Portal.

- [ ] **Step 2: Run e2e**

```
pnpm smoke:e2e
```

- [ ] **Step 3: Commit**

```bash
git add tests-utils/e2e/paywall-frontend.spec.ts
git commit -m "test(paywall): full frontend e2e walkthrough"
```

---

## Task 12: Lint + visual sanity

- [ ] `pnpm vitest run` — all green
- [ ] `pnpm lint` — clean
- [ ] Run `pnpm dev`, click through every paywall surface in light + dark mode (use `next-themes` `resolvedTheme` per the project's feedback memory). Capture screenshots if helpful.
- [ ] Verify no raw palette classes / no legacy shadcn tokens snuck in (`grep -rn "bg-card\|text-foreground\|bg-purple-\|text-red-" components/paywall app/pricing app/billing`)

---

## Acceptance criteria for Phase 3

- [ ] `useEntitlements()` returns the right shape for anon/free/pro users
- [ ] Summary 402 → `<UpgradeCard variant="summary-cap" />`, no generic error
- [ ] Chat 402 → `<ChatCapBanner>`; `<ChatCapCounter>` appears at usage ≥ 3
- [ ] Anon at lifetime cap → `<AnonSignupWall>` on homepage, URL form disabled
- [ ] `/history` for anon → `<HistoryAnonEmpty>`; for free at cap → `<HistoryFreeBanner>` with link
- [ ] `/pricing` shows free/pro side-by-side with yearly/monthly toggle and FAQ
- [ ] Pro user sees "Manage subscription" in dropdown → opens Stripe Portal
- [ ] After successful checkout, the rest of the app immediately reflects `tier=pro` (entitlements invalidated)
- [ ] No raw palette colors, no legacy shadcn tokens in any new file
- [ ] E2E walkthrough passes against `pnpm dev`
- [ ] Lint + tests green
