# Post-login page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-in users land on a personal `/dashboard` (input form on top, recent 10 summaries below, link to `/history`) instead of the marketing homepage. Marketing homepage stays at `/` for anonymous visitors.

**Architecture:** Two new auth-required routes (`/dashboard`, `/history`) backed by a new server-side data layer (`lib/services/user-history.ts`). Proxy entry (`proxy.ts` → `lib/supabase/middleware.ts`) gets one extra branch that redirects `/` → `/dashboard` for authenticated users. RLS already restricts `user_video_history` reads to the row owner, so the auth-scoped Supabase client is used directly — no service-role escalation, no migration.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 (semantic tokens, see `youtubeai_chat_frontend/CLAUDE.md`) + `@supabase/ssr` + Vitest + Playwright. UI primitives come from `components/ui/*`.

**Spec:** [docs/superpowers/specs/2026-04-28-post-login-page-design.md](../specs/2026-04-28-post-login-page-design.md)

---

## File Structure

**New files:**
- `lib/services/user-history.ts` — `getRecentHistory`, `getHistoryPage` (auth-scoped reads)
- `lib/services/__tests__/user-history.test.ts`
- `lib/utils/relative-time.ts` — `formatRelativeTime(iso, now?)` using `Intl.RelativeTimeFormat`
- `lib/utils/__tests__/relative-time.test.ts`
- `app/components/history/history-row.tsx` — single row (thumbnail, title, channel, date, link)
- `app/components/history/history-list.tsx` — `<ol>` of rows
- `app/components/history/empty-history-state.tsx` — empty-state copy
- `app/components/history/__tests__/history-row.test.tsx`
- `app/components/history/__tests__/history-list.test.tsx`
- `app/components/history/__tests__/empty-history-state.test.tsx`
- `app/dashboard/page.tsx` — server component
- `app/dashboard/__tests__/page.test.tsx`
- `app/history/page.tsx` — server component, paginated
- `app/history/components/history-pagination.tsx` — uses `components/ui/pagination`
- `app/history/__tests__/page.test.tsx`

**Modified files:**
- `lib/supabase/middleware.ts` — add `/` → `/dashboard` redirect for logged-in users
- `lib/supabase/__tests__/middleware.test.ts` — extend coverage

**Conventions to follow:**
- Design system contract: only `components/ui/*` primitives + semantic tokens (`bg-surface-base`, `text-text-primary`, etc.). No `bg-purple-500`, no legacy `bg-card`.
- Server components by default; only the client-only `InputForm` is `"use client"`.
- Vitest tests live next to code in `__tests__/` (existing pattern).

---

### Task 1: Commit the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-28-post-login-page-design.md` (already created)

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/specs/2026-04-28-post-login-page-design.md docs/superpowers/plans/2026-04-28-post-login-page.md
git commit -m "docs(post-login): spec + plan"
```

---

### Task 2: `formatRelativeTime` helper

**Files:**
- Create: `lib/utils/relative-time.ts`
- Test: `lib/utils/__tests__/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/utils/__tests__/relative-time.test.ts
import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../relative-time";

const NOW = new Date("2026-04-28T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("returns 'just now' for less than a minute ago", () => {
    expect(
      formatRelativeTime("2026-04-28T11:59:30Z", NOW)
    ).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(
      formatRelativeTime("2026-04-28T11:55:00Z", NOW)
    ).toBe("5 minutes ago");
  });

  it("returns hours for under a day", () => {
    expect(
      formatRelativeTime("2026-04-28T09:00:00Z", NOW)
    ).toBe("3 hours ago");
  });

  it("returns days for under a week", () => {
    expect(
      formatRelativeTime("2026-04-25T12:00:00Z", NOW)
    ).toBe("3 days ago");
  });

  it("returns weeks for under a month", () => {
    expect(
      formatRelativeTime("2026-04-14T12:00:00Z", NOW)
    ).toBe("2 weeks ago");
  });

  it("returns months for under a year", () => {
    expect(
      formatRelativeTime("2026-01-28T12:00:00Z", NOW)
    ).toBe("3 months ago");
  });

  it("returns years for over a year", () => {
    expect(
      formatRelativeTime("2024-04-28T12:00:00Z", NOW)
    ).toBe("2 years ago");
  });

  it("singularizes 1-unit values", () => {
    expect(
      formatRelativeTime("2026-04-28T11:00:00Z", NOW)
    ).toBe("1 hour ago");
  });

  it("returns 'just now' for invalid timestamps", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run lib/utils/__tests__/relative-time.test.ts`
Expected: FAIL with "Cannot find module '../relative-time'"

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/utils/relative-time.ts
const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

export function formatRelativeTime(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diffSec < 60) return "just now";
  for (const { unit, seconds } of UNITS) {
    if (diffSec >= seconds) {
      const value = Math.floor(diffSec / seconds);
      return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run lib/utils/__tests__/relative-time.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/relative-time.ts lib/utils/__tests__/relative-time.test.ts
git commit -m "feat(utils): formatRelativeTime helper"
```

---

### Task 3: `user-history` service — types + `getRecentHistory`

**Files:**
- Create: `lib/services/user-history.ts`
- Test: `lib/services/__tests__/user-history.test.ts`

- [ ] **Step 1: Write the failing tests for `getRecentHistory`**

```ts
// lib/services/__tests__/user-history.test.ts
import { describe, it, expect, vi } from "vitest";
import { getRecentHistory } from "../user-history";

type SupabaseLike = {
  from: ReturnType<typeof vi.fn>;
};

function makeSupabase(rows: unknown[], error: unknown = null): SupabaseLike {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return { from: vi.fn().mockReturnValue(builder) };
}

const ROW = {
  created_at: "2026-04-28T12:00:00Z",
  videos: {
    id: "v-uuid-1",
    youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    channel_name: "Rick Astley",
  },
};

describe("getRecentHistory", () => {
  it("returns mapped rows in shape consumers expect", async () => {
    const supabase = makeSupabase([ROW]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      videoId: "v-uuid-1",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      youtubeVideoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelName: "Rick Astley",
      viewedAt: "2026-04-28T12:00:00Z",
    });
  });

  it("defaults limit to 10", async () => {
    const supabase = makeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getRecentHistory(supabase as any, "u-1");
    const builder = supabase.from.mock.results[0].value;
    expect(builder.range).toHaveBeenCalledWith(0, 9);
  });

  it("honors custom limit", async () => {
    const supabase = makeSupabase([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getRecentHistory(supabase as any, "u-1", 5);
    const builder = supabase.from.mock.results[0].value;
    expect(builder.range).toHaveBeenCalledWith(0, 4);
  });

  it("returns null youtubeVideoId when URL is malformed", async () => {
    const supabase = makeSupabase([
      { ...ROW, videos: { ...ROW.videos, youtube_url: "not a url" } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows[0].youtubeVideoId).toBeNull();
  });

  it("returns empty array on supabase error and logs", async () => {
    const supabase = makeSupabase(null, { message: "boom" });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("filters out rows with no joined video", async () => {
    const supabase = makeSupabase([
      ROW,
      { created_at: "2026-04-28T11:00:00Z", videos: null },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await getRecentHistory(supabase as any, "u-1");
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run lib/services/__tests__/user-history.test.ts`
Expected: FAIL with "Cannot find module '../user-history'"

- [ ] **Step 3: Write minimal implementation (recent only)**

```ts
// lib/services/user-history.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractVideoId } from "./youtube-url";

export type HistoryRow = {
  videoId: string;
  youtubeUrl: string;
  youtubeVideoId: string | null;
  title: string | null;
  channelName: string | null;
  viewedAt: string;
};

type RawRow = {
  created_at: string;
  videos: {
    id: string;
    youtube_url: string;
    title: string | null;
    channel_name: string | null;
  } | null;
};

function mapRow(raw: RawRow): HistoryRow | null {
  if (!raw.videos) return null;
  return {
    videoId: raw.videos.id,
    youtubeUrl: raw.videos.youtube_url,
    youtubeVideoId: extractVideoId(raw.videos.youtube_url),
    title: raw.videos.title,
    channelName: raw.videos.channel_name,
    viewedAt: raw.created_at,
  };
}

export async function getRecentHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  limit: number = 10,
): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from("user_video_history")
    .select(
      "created_at, videos!inner (id, youtube_url, title, channel_name)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  if (error) {
    console.error("getRecentHistory failed", error);
    return [];
  }

  return ((data as RawRow[] | null) ?? [])
    .map(mapRow)
    .filter((r): r is HistoryRow => r !== null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --run lib/services/__tests__/user-history.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/services/user-history.ts lib/services/__tests__/user-history.test.ts
git commit -m "feat(history): getRecentHistory service"
```

---

### Task 4: `getHistoryPage` (paginated)

**Files:**
- Modify: `lib/services/user-history.ts`
- Modify: `lib/services/__tests__/user-history.test.ts`

- [ ] **Step 1: Add failing tests for `getHistoryPage`**

```ts
// append to lib/services/__tests__/user-history.test.ts
import { getHistoryPage } from "../user-history";

function makeSupabasePage(
  rows: unknown[],
  total: number,
  rangeError: unknown = null,
  countError: unknown = null,
) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let isCount = false;
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn((..._args: unknown[]) => {
    isCount = _args[1] !== undefined;
    return builder;
  });
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn((start: number, end: number) => {
    calls.push({ method: "range", args: [start, end] });
    return Promise.resolve({ data: rows, error: rangeError });
  });
  // The count query is `await`-ed directly after .eq(...) without .range,
  // so make `eq` thenable when isCount is set.
  const baseEq = builder.eq as ReturnType<typeof vi.fn>;
  baseEq.mockImplementation(() => {
    if (isCount) {
      return Promise.resolve({ count: total, error: countError });
    }
    return builder;
  });
  return {
    from: vi.fn(() => builder),
    _calls: calls,
  };
}

describe("getHistoryPage", () => {
  const ROW2 = ROW;

  it("requests the right range for page 1, perPage 25", async () => {
    const supabase = makeSupabasePage([ROW2], 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(supabase._calls.find((c) => c.method === "range")?.args).toEqual([
      0,
      24,
    ]);
  });

  it("requests the right range for page 3, perPage 10", async () => {
    const supabase = makeSupabasePage([ROW2], 25);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getHistoryPage(supabase as any, "u-1", 3, 10);
    expect(supabase._calls.find((c) => c.method === "range")?.args).toEqual([
      20,
      29,
    ]);
  });

  it("returns total and totalPages from count query", async () => {
    const supabase = makeSupabasePage([ROW2], 53);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 1, 25);
    expect(result.total).toBe(53);
    expect(result.totalPages).toBe(3);
  });

  it("clamps page to at least 1", async () => {
    const supabase = makeSupabasePage([], 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getHistoryPage(supabase as any, "u-1", 0, 25);
    expect(result.totalPages).toBe(0);
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test --run lib/services/__tests__/user-history.test.ts`
Expected: 4 new tests fail with "getHistoryPage is not exported".

- [ ] **Step 3: Implement `getHistoryPage`**

Add to `lib/services/user-history.ts`:

```ts
export async function getHistoryPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  page: number,
  perPage: number = 25,
): Promise<{ rows: HistoryRow[]; total: number; totalPages: number }> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const offset = (safePage - 1) * perPage;

  const [rowsResult, countResult] = await Promise.all([
    supabase
      .from("user_video_history")
      .select(
        "created_at, videos!inner (id, youtube_url, title, channel_name)",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + perPage - 1),
    supabase
      .from("user_video_history")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  if (rowsResult.error) {
    console.error("getHistoryPage rows failed", rowsResult.error);
    return { rows: [], total: 0, totalPages: 0 };
  }
  if (countResult.error) {
    console.error("getHistoryPage count failed", countResult.error);
    return { rows: [], total: 0, totalPages: 0 };
  }

  const rows = ((rowsResult.data as RawRow[] | null) ?? [])
    .map(mapRow)
    .filter((r): r is HistoryRow => r !== null);
  const total = countResult.count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);

  return { rows, total, totalPages };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run lib/services/__tests__/user-history.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/user-history.ts lib/services/__tests__/user-history.test.ts
git commit -m "feat(history): getHistoryPage paginated service"
```

---

### Task 5: Middleware redirect for `/`

**Files:**
- Modify: `lib/supabase/middleware.ts`
- Modify: `lib/supabase/__tests__/middleware.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `lib/supabase/__tests__/middleware.test.ts` describe block:

```ts
it("redirects authenticated user from / to /dashboard", async () => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@example.com" } },
  });
  const response = await updateSession(req("/"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://example.com/dashboard"
  );
});

it("does NOT redirect anonymous user on /", async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const response = await updateSession(req("/"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
});

it("does NOT redirect authenticated user away from /summary", async () => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@example.com" } },
  });
  const response = await updateSession(req("/summary"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
});

it("redirects authenticated user from / to /dashboard regardless of query string", async () => {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "u1" } },
  });
  const response = await updateSession(
    new NextRequest("https://example.com/?utm_source=email")
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://example.com/dashboard"
  );
});
```

- [ ] **Step 2: Run tests, expect failures**

Run: `pnpm test --run lib/supabase/__tests__/middleware.test.ts`
Expected: 3 failures (the redirect doesn't exist yet).

- [ ] **Step 3: Add the redirect branch in middleware**

In `lib/supabase/middleware.ts`, after `const { data: { user } } = await supabase.auth.getUser();` and BEFORE the `isPublicPath` block, add:

```ts
if (user && request.nextUrl.pathname === "/") {
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  return NextResponse.redirect(url);
}
```

- [ ] **Step 4: Run tests, expect all pass**

Run: `pnpm test --run lib/supabase/__tests__/middleware.test.ts`
Expected: all original + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/middleware.ts lib/supabase/__tests__/middleware.test.ts
git commit -m "feat(auth): redirect logged-in users from / to /dashboard"
```

---

### Task 6: `EmptyHistoryState` component

**Files:**
- Create: `app/components/history/empty-history-state.tsx`
- Test: `app/components/history/__tests__/empty-history-state.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/history/__tests__/empty-history-state.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyHistoryState } from "../empty-history-state";

describe("EmptyHistoryState", () => {
  it("renders the empty-state copy", () => {
    render(<EmptyHistoryState />);
    expect(
      screen.getByText(/haven't summarized any videos yet/i)
    ).toBeInTheDocument();
  });

  it("has status role for screen readers", () => {
    render(<EmptyHistoryState />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `pnpm test --run app/components/history/__tests__/empty-history-state.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
// app/components/history/empty-history-state.tsx
import { Sparkles } from "lucide-react";

export function EmptyHistoryState() {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-6 py-10 text-center"
    >
      <Sparkles
        className="h-8 w-8 text-text-muted"
        aria-hidden="true"
      />
      <p className="text-body-md text-text-primary">
        You haven&apos;t summarized any videos yet.
      </p>
      <p className="text-body-sm text-text-muted">
        Paste a YouTube URL above to get started.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test --run app/components/history/__tests__/empty-history-state.test.tsx`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add app/components/history/empty-history-state.tsx app/components/history/__tests__/empty-history-state.test.tsx
git commit -m "feat(history): EmptyHistoryState component"
```

---

### Task 7: `HistoryRow` component

**Files:**
- Create: `app/components/history/history-row.tsx`
- Test: `app/components/history/__tests__/history-row.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/history/__tests__/history-row.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryRow } from "../history-row";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";

const NOW = new Date("2026-04-28T12:00:00Z").getTime();

const ROW: HistoryRowType = {
  videoId: "v-1",
  youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  youtubeVideoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelName: "Rick Astley",
  viewedAt: "2026-04-25T12:00:00Z",
};

describe("HistoryRow", () => {
  it("renders title, channel and relative date", () => {
    render(<HistoryRow row={ROW} now={NOW} />);
    expect(
      screen.getByText("Never Gonna Give You Up")
    ).toBeInTheDocument();
    expect(screen.getByText("Rick Astley")).toBeInTheDocument();
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
  });

  it("links to /summary?url=<encoded original>", () => {
    render(<HistoryRow row={ROW} now={NOW} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/summary?url=" +
        encodeURIComponent(
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        )
    );
  });

  it("link has accessible name including the title", () => {
    render(<HistoryRow row={ROW} now={NOW} />);
    expect(
      screen.getByRole("link", {
        name: /Never Gonna Give You Up/i,
      })
    ).toBeInTheDocument();
  });

  it("uses youtube thumbnail when youtubeVideoId is present", () => {
    render(<HistoryRow row={ROW} now={NOW} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"
    );
  });

  it("renders fallback thumbnail when youtubeVideoId is null", () => {
    render(
      <HistoryRow
        row={{ ...ROW, youtubeVideoId: null }}
        now={NOW}
      />
    );
    // Fallback uses an inline placeholder, not the i.ytimg.com host.
    const img = screen.queryByRole("img") as HTMLImageElement | null;
    if (img) {
      expect(img.src).not.toContain("i.ytimg.com");
    }
  });

  it("falls back to 'Untitled' when title is null", () => {
    render(
      <HistoryRow row={{ ...ROW, title: null }} now={NOW} />
    );
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `pnpm test --run app/components/history/__tests__/history-row.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
// app/components/history/history-row.tsx
import Link from "next/link";
import { Video } from "lucide-react";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";
import { formatRelativeTime } from "@/lib/utils/relative-time";

type HistoryRowProps = {
  row: HistoryRowType;
  now?: number;
};

export function HistoryRow({ row, now }: HistoryRowProps) {
  const title = row.title ?? "Untitled";
  const summaryHref = `/summary?url=${encodeURIComponent(row.youtubeUrl)}`;
  const dateLabel = formatRelativeTime(row.viewedAt, now);

  return (
    <li className="list-none">
      <Link
        href={summaryHref}
        aria-label={`View summary of ${title}`}
        className="group flex items-center gap-3 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 transition-colors duration-fast hover:bg-state-hover focus-visible:bg-state-focus focus-visible:outline-none"
      >
        <div className="flex h-[45px] w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-sunken">
          {row.youtubeVideoId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://i.ytimg.com/vi/${row.youtubeVideoId}/mqdefault.jpg`}
              alt=""
              loading="lazy"
              width={80}
              height={45}
              className="h-full w-full object-cover"
            />
          ) : (
            <Video
              className="h-5 w-5 text-text-muted"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-md font-medium text-text-primary">
            {title}
          </p>
          {row.channelName ? (
            <p className="truncate text-caption text-text-muted">
              {row.channelName}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-caption text-text-muted">
          {dateLabel}
        </span>
      </Link>
    </li>
  );
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm test --run app/components/history/__tests__/history-row.test.tsx`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add app/components/history/history-row.tsx app/components/history/__tests__/history-row.test.tsx
git commit -m "feat(history): HistoryRow component"
```

---

### Task 8: `HistoryList` component

**Files:**
- Create: `app/components/history/history-list.tsx`
- Test: `app/components/history/__tests__/history-list.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/history/__tests__/history-list.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryList } from "../history-list";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";

const ROWS: HistoryRowType[] = [
  {
    videoId: "v-1",
    youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    youtubeVideoId: "aaaaaaaaaaa",
    title: "First",
    channelName: "C1",
    viewedAt: "2026-04-28T12:00:00Z",
  },
  {
    videoId: "v-2",
    youtubeUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    youtubeVideoId: "bbbbbbbbbbb",
    title: "Second",
    channelName: "C2",
    viewedAt: "2026-04-27T12:00:00Z",
  },
];

describe("HistoryList", () => {
  it("renders one row per item", () => {
    render(<HistoryList rows={ROWS} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders empty state when rows is empty", () => {
    render(<HistoryList rows={[]} />);
    expect(
      screen.getByText(/haven't summarized any videos yet/i)
    ).toBeInTheDocument();
  });

  it("uses an ordered-list landmark", () => {
    render(<HistoryList rows={ROWS} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `pnpm test --run app/components/history/__tests__/history-list.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
// app/components/history/history-list.tsx
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";
import { HistoryRow } from "./history-row";
import { EmptyHistoryState } from "./empty-history-state";

type HistoryListProps = {
  rows: HistoryRowType[];
  now?: number;
};

export function HistoryList({ rows, now }: HistoryListProps) {
  if (rows.length === 0) {
    return <EmptyHistoryState />;
  }
  return (
    <ol className="flex flex-col gap-2 p-0">
      {rows.map((row) => (
        <HistoryRow key={row.videoId} row={row} now={now} />
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run app/components/history/__tests__/history-list.test.tsx`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add app/components/history/history-list.tsx app/components/history/__tests__/history-list.test.tsx
git commit -m "feat(history): HistoryList component"
```

---

### Task 9: `/dashboard` page

**Files:**
- Create: `app/dashboard/page.tsx`
- Test: `app/dashboard/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// app/dashboard/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HistoryRow } from "@/lib/services/user-history";

const mockGetUser = vi.fn();
const mockGetRecentHistory = vi.fn();
const mockRedirect = vi.fn(() => {
  throw new Error("REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));
vi.mock("@/lib/services/user-history", () => ({
  getRecentHistory: (...args: unknown[]) => mockGetRecentHistory(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));
vi.mock("@/app/components/input-form", () => ({
  InputForm: () => <div data-testid="input-form" />,
}));

import DashboardPage from "../page";

const ROW: HistoryRow = {
  videoId: "v-1",
  youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  youtubeVideoId: "aaaaaaaaaaa",
  title: "Welcome Back Video",
  channelName: "C1",
  viewedAt: "2026-04-28T12:00:00Z",
};

describe("DashboardPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetRecentHistory.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects to /auth/login when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(DashboardPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders input form, recent label, and history list when authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    mockGetRecentHistory.mockResolvedValue([ROW]);
    const ui = await DashboardPage();
    render(ui);
    expect(screen.getByTestId("input-form")).toBeInTheDocument();
    expect(screen.getByText(/recent/i)).toBeInTheDocument();
    expect(screen.getByText("Welcome Back Video")).toBeInTheDocument();
  });

  it("does not show 'View all' link when fewer than 10 rows", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    mockGetRecentHistory.mockResolvedValue([ROW]);
    const ui = await DashboardPage();
    render(ui);
    expect(screen.queryByText(/view all/i)).not.toBeInTheDocument();
  });

  it("shows 'View all' link when there are 10 rows", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    mockGetRecentHistory.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ ...ROW, videoId: `v-${i}` }))
    );
    const ui = await DashboardPage();
    render(ui);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/history");
  });

  it("renders empty state when there is no history", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    mockGetRecentHistory.mockResolvedValue([]);
    const ui = await DashboardPage();
    render(ui);
    expect(
      screen.getByText(/haven't summarized any videos yet/i)
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `pnpm test --run app/dashboard/__tests__/page.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the page**

```tsx
// app/dashboard/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRecentHistory } from "@/lib/services/user-history";
import { InputForm } from "@/app/components/input-form";
import { HistoryList } from "@/app/components/history/history-list";

export const metadata: Metadata = {
  title: "Dashboard - YouTubeAI.chat",
  robots: { index: false, follow: false },
};

const RECENT_LIMIT = 10;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const rows = await getRecentHistory(supabase, user.id, RECENT_LIMIT);
  const showViewAll = rows.length >= RECENT_LIMIT;

  const greetingName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "there";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 font-bold text-text-primary">
          Welcome back, {greetingName}
        </h1>
        <p className="text-body-md text-text-secondary">
          Paste a YouTube URL to summarize a new video.
        </p>
      </header>

      <section className="w-full">
        <InputForm />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h4 font-semibold text-text-primary">
            Recent
          </h2>
          {showViewAll ? (
            <Link
              href="/history"
              className="text-body-sm text-text-secondary hover:text-text-primary"
            >
              View all →
            </Link>
          ) : null}
        </div>
        <HistoryList rows={rows} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test --run app/dashboard/__tests__/page.test.tsx`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx app/dashboard/__tests__/page.test.tsx
git commit -m "feat(dashboard): /dashboard page"
```

---

### Task 10: `/history` page + pagination

**Files:**
- Create: `app/history/page.tsx`
- Create: `app/history/components/history-pagination.tsx`
- Test: `app/history/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// app/history/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HistoryRow } from "@/lib/services/user-history";

const mockGetUser = vi.fn();
const mockGetHistoryPage = vi.fn();
const mockRedirect = vi.fn(() => {
  throw new Error("REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));
vi.mock("@/lib/services/user-history", () => ({
  getHistoryPage: (...args: unknown[]) => mockGetHistoryPage(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

import HistoryPage from "../page";

const ROW: HistoryRow = {
  videoId: "v-1",
  youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  youtubeVideoId: "aaaaaaaaaaa",
  title: "Older Video",
  channelName: "C1",
  viewedAt: "2026-04-28T12:00:00Z",
};

describe("HistoryPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetHistoryPage.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects unauthenticated users to /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(
      HistoryPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders rows for the authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      rows: [ROW],
      total: 1,
      totalPages: 1,
    });
    const ui = await HistoryPage({
      searchParams: Promise.resolve({}),
    });
    render(ui);
    expect(screen.getByText("Older Video")).toBeInTheDocument();
  });

  it("uses page=N from search params", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      rows: [],
      total: 50,
      totalPages: 2,
    });
    await HistoryPage({
      searchParams: Promise.resolve({ page: "2" }),
    });
    expect(mockGetHistoryPage).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      2,
      25
    );
  });

  it("clamps invalid page values to 1", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      rows: [],
      total: 0,
      totalPages: 0,
    });
    await HistoryPage({
      searchParams: Promise.resolve({ page: "garbage" }),
    });
    expect(mockGetHistoryPage).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      1,
      25
    );
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `pnpm test --run app/history/__tests__/page.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement pagination component**

```tsx
// app/history/components/history-pagination.tsx
import Link from "next/link";

type HistoryPaginationProps = {
  current: number;
  totalPages: number;
};

export function HistoryPagination({
  current,
  totalPages,
}: HistoryPaginationProps) {
  if (totalPages <= 1) return null;
  const prev = current > 1 ? current - 1 : null;
  const next = current < totalPages ? current + 1 : null;

  return (
    <nav
      aria-label="History pagination"
      className="flex items-center justify-between gap-3"
    >
      {prev !== null ? (
        <Link
          href={`/history?page=${prev}`}
          className="text-body-sm text-text-secondary hover:text-text-primary"
          rel="prev"
        >
          ← Previous
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="text-caption text-text-muted">
        Page {current} of {totalPages}
      </span>
      {next !== null ? (
        <Link
          href={`/history?page=${next}`}
          className="text-body-sm text-text-secondary hover:text-text-primary"
          rel="next"
        >
          Next →
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Implement page**

```tsx
// app/history/page.tsx
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getHistoryPage } from "@/lib/services/user-history";
import { HistoryList } from "@/app/components/history/history-list";
import { HistoryPagination } from "./components/history-pagination";

export const metadata: Metadata = {
  title: "Your summaries - YouTubeAI.chat",
  robots: { index: false, follow: false },
};

const PER_PAGE = 25;

type SearchParams = Promise<{ page?: string }>;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const params = await searchParams;
  const parsed = parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  const { rows, totalPages } = await getHistoryPage(
    supabase,
    user.id,
    page,
    PER_PAGE,
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 font-bold text-text-primary">
          Your summaries
        </h1>
        <p className="text-body-md text-text-secondary">
          Every YouTube video you&apos;ve summarized.
        </p>
      </header>

      <HistoryList rows={rows} />
      <HistoryPagination current={page} totalPages={totalPages} />
    </main>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test --run app/history/__tests__/page.test.tsx`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add app/history/page.tsx app/history/components/history-pagination.tsx app/history/__tests__/page.test.tsx
git commit -m "feat(history): /history page with pagination"
```

---

### Task 11: Final lint + full test pass

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Expected: clean. If failures, fix and re-run.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test --run`
Expected: 1186 + new tests (≈ 1216), all passing.

- [ ] **Step 3: Type-check via Next build (sanity)**

Run: `pnpm build` (in worktree). Expected: no TS errors and no missing module errors.

- [ ] **Step 4: Commit any lint/build fixups (if needed)**

```bash
git add -A
git commit -m "chore: lint + build cleanup"
```

(Skip if there are no fixups.)

---

### Task 12: Playwright e2e

**Why required:** Project CLAUDE.md mandates Playwright e2e for every UI change before declaring done. Test creds at `~/.config/claude-test-creds/youtubeai.env`.

- [ ] **Step 1: Start dev server in the worktree**

```bash
pnpm dev
```

(Background process; will use port 3000.)

- [ ] **Step 2: Use the playwright skill to drive the flow**

Flow:
1. Visit `http://localhost:3000/` anonymously → marketing page (`HeroSection` text visible).
2. Sign in with test creds (`/auth/login`).
3. Confirm URL after sign-in is `/dashboard` and "Welcome back" greeting + InputForm + history list (or empty state) are visible.
4. If history rows exist: click the first row → URL becomes `/summary?url=...` and the cached summary view renders.
5. If 10+ rows visible: click "View all →" → URL becomes `/history` and the paginated list renders with "Page 1 of N".
6. If totalPages ≥ 2: click "Next →" → URL contains `?page=2`, different rows visible.
7. Sign out → visit `/` → marketing page renders again (no redirect).

Capture a screenshot of `/dashboard` for the PR description.

- [ ] **Step 3: Stop dev server**

Kill the backgrounded `pnpm dev`.

(No commit — this is verification only.)

---

### Task 13: Push, rebase on origin/main, create PR

- [ ] **Step 1: Rebase on origin/main** (per memory rule)

```bash
git fetch origin
git rebase origin/main
```

If conflicts, resolve and continue.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/post-login-page
```

- [ ] **Step 3: Create PR**

```bash
gh pr create --title "feat: post-login dashboard with summary history" --body "$(cat <<'EOF'
## Summary

- New `/dashboard` route serves as the post-login landing — input form on top, list of the user's 10 most recent summaries below, "View all →" link to `/history` when there are ≥10 rows.
- New `/history` route paginates the user's full summary history (25 per page).
- Proxy redirects logged-in users from `/` to `/dashboard`. Marketing page at `/` is unchanged for anonymous visitors and crawlers.
- All reads are auth-scoped (RLS-enforced). No migration, no service-role escalation.

## Test plan

- [x] Vitest: new tests for `formatRelativeTime`, `getRecentHistory`, `getHistoryPage`, middleware redirect, history components, dashboard page, history page
- [x] `pnpm lint` clean
- [x] `pnpm build` clean
- [x] Playwright e2e: anon `/` → marketing; sign in → `/dashboard`; click row → cached summary; "View all" → `/history`; pagination; sign out → `/` marketing

Spec: `docs/superpowers/specs/2026-04-28-post-login-page-design.md`
Plan: `docs/superpowers/plans/2026-04-28-post-login-page.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 14: pr-review-toolkit + fix loop

- [ ] **Step 1:** Run `pr-review-toolkit:review-pr` skill against the new PR (per project CLAUDE.md).
- [ ] **Step 2:** Address findings — make code changes, write tests, commit each fix atomically.
- [ ] **Step 3:** Push fixes.
- [ ] **Step 4:** If substantial follow-up commits, re-run `pr-review-toolkit:review-pr`.
- [ ] **Step 5:** Repeat until no findings remain.

---

### Task 15: Wait for CI and merge

- [ ] **Step 1:** Watch CI: `gh pr checks --watch <pr-number>`
- [ ] **Step 2:** When all checks green AND no review findings remain (per memory: PR merge gate), merge:

```bash
gh pr merge <pr-number> --squash --delete-branch
```

---

## Self-review

- **Spec coverage:** Every decision in the spec is implemented (routing, middleware redirect, data layer, list/row/empty components, pages, pagination, tests, security stance). Yes.
- **Placeholders:** None.
- **Type consistency:** `HistoryRow` type defined once in `lib/services/user-history.ts`, imported everywhere. Method signatures match between spec and tasks.
- **Risks tracked:** Sort order (deferred); cache leak on logout (handled by middleware redirect on `/dashboard`); bot indexing (`robots: { index: false }` on both pages).
