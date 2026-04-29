# Post-login page (D) — design

**Status:** approved (brainstorming → writing-plans handoff)
**Date:** 2026-04-28
**Scope:** Give signed-in users a different landing experience instead of the marketing homepage. Show their summary history. Keep the marketing homepage intact for anonymous visitors.

## Why

Today, signing in changes nothing visible except the avatar in the top-right. Returning users land on the same marketing page with hero, benefits, FAQ, and testimonials — content they don't need. Their summary history exists in the database (`user_video_history` is already populated whenever a logged-in user runs a summarize) but is invisible. This wastes the value of the login.

## Goal

A signed-in user landing on `/` lands on a personal page that:

1. Keeps the **summarize-a-new-video** flow primary (the app's core job).
2. Surfaces the user's **recent summary history** below the form, so re-opening past summaries is one click.
3. Provides a **full archive** at `/history` with simple pagination for users with more history than the rail shows.

Out of scope for v1: search, filter, delete, pin/favorite, stats cards, sort options, infinite scroll, last-viewed-at tracking on cache hit (see "Deferred").

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Tool-first layout: input form on top, history below | App's center of gravity is the summarize tool; history is the bonus that justifies login. |
| 2 | New `/dashboard` route + middleware redirect `/` → `/dashboard` for logged-in users | Marketing page stays at `/` (one canonical, indexable URL for SEO and crawlers). Logged-in users effectively never see marketing. |
| 3 | Compact full-width list (small thumbnail + title + channel + date) | Information-dense, low ceremony, recognisable at a glance via thumbnails. |
| 4 | Click history row → `/summary?url=<original-yt-url>` | Reuses the existing cache-hit path. No new route or handler. Free. |
| 5 | Dashboard shows 10 most recent. Bottom link `View all →` goes to `/history`. | 10 is enough to feel substantive without dominating the page. Shipping `View all` that 404s is broken — `/history` lands in v1. |
| 6 | `/history` paginates 25/page via `?page=N` | Simple, server-rendered, no client state. |
| 7 | Sort by `user_video_history.created_at DESC` (no migration) | Re-summarizing the same video doesn't bump the row. For the day-1 population (no one has re-runs yet) this is identical to "most recent." Adding `last_viewed_at` is deferred until real users complain. |
| 8 | Server components, RLS-enforced reads via the auth-scoped Supabase client | RLS policy `history_select` already restricts to `auth.uid() = user_id`. No service-role escalation needed. |

## Architecture

### Routes

```
/                  marketing page (existing)         anonymous-OK; logged-in → 302 /dashboard
/dashboard         input form + 10 recent history    auth-required (NEW)
/history           paginated archive, 25/page        auth-required (NEW)
/summary?url=…     existing summary view             unchanged
```

### Middleware change (`lib/supabase/middleware.ts`)

After `supabase.auth.getUser()`, before the existing `if (!user && !isPublicPath)` block, add:

```ts
if (user && request.nextUrl.pathname === "/") {
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  return NextResponse.redirect(url);
}
```

`/dashboard` and `/history` are simply *not* in `isPublicPath`, so anonymous visitors are auto-redirected to `/auth/login` by the existing logic.

### File layout

```
app/
├─ dashboard/
│  ├─ page.tsx                        server component, fetches user + 10 recent rows
│  └─ components/
│     └─ welcome-greeting.tsx         "Welcome back, {first name or email-local-part}"
├─ history/
│  ├─ page.tsx                        server component, fetches user + paginated rows
│  └─ components/
│     └─ history-pagination.tsx       prev/next link controls
├─ components/                        (existing app-level shared)
│  └─ history/
│     ├─ history-row.tsx              one row, used by dashboard + history page
│     ├─ history-list.tsx             ordered list wrapper
│     └─ empty-history-state.tsx      "no summaries yet" UI

lib/
└─ services/
   ├─ user-history.ts                 NEW: getRecentHistory, getHistoryPage
   └─ __tests__/user-history.test.ts  NEW: query shape + pagination + edge cases
```

### Data layer (`lib/services/user-history.ts`)

```ts
export type HistoryRow = {
  videoId: string;          // videos.id (UUID, used as React key)
  youtubeUrl: string;       // for /summary?url=… link
  youtubeVideoId: string | null;  // 11-char ID for thumbnail; null if extraction fails
  title: string | null;
  channelName: string | null;
  viewedAt: string;         // ISO from user_video_history.created_at
};

export async function getRecentHistory(
  supabase: SupabaseClient,
  userId: string,
  limit?: number,            // defaults to 10
): Promise<HistoryRow[]>;

export async function getHistoryPage(
  supabase: SupabaseClient,
  userId: string,
  page: number,              // 1-indexed
  perPage?: number,          // defaults to 25
): Promise<{ rows: HistoryRow[]; total: number; totalPages: number }>;
```

Query (Supabase JS):

```ts
const { data, error } = await supabase
  .from("user_video_history")
  .select("created_at, videos!inner (id, youtube_url, title, channel_name)")
  .eq("user_id", userId)               // redundant with RLS but explicit
  .order("created_at", { ascending: false })
  .range(offset, offset + limit - 1);
```

For `/history`, a second query with `{ count: "exact", head: true }` returns the total. RLS enforces user isolation; the explicit `.eq("user_id", …)` is a belt-and-braces marker for readers.

YouTube ID extraction reuses the existing helper used by `summarize-cache.ts` (`computeVideoKey` / `extractVideoId`). Bad URLs return `youtubeVideoId: null` and the row renders with a fallback placeholder thumbnail — the row still works, the thumbnail just falls back.

### UI components

**`history-row.tsx`** — single row:
- 80×45 px thumbnail from `https://i.ytimg.com/vi/{youtubeVideoId}/mqdefault.jpg` (or fallback inline SVG when null)
- Title (text-body-md, bold, 1 line truncate)
- Channel (text-caption muted, 1 line truncate)
- Relative date right-aligned ("3 days ago"), using a small `formatRelativeTime` helper or `Intl.RelativeTimeFormat`
- Whole row wrapped in `<Link href={`/summary?url=${encodeURIComponent(youtubeUrl)}`}>` with hover/focus states from `bg-state-hover` / `bg-state-focus`
- `<a aria-label>` exposes the title for screen readers

**`history-list.tsx`** — `<ol>` of rows. Empty array → renders `<EmptyHistoryState />`.

**`empty-history-state.tsx`** — friendly text: "You haven't summarized any videos yet. Paste a URL above to get started." Uses `text-text-muted`. Maybe a subtle icon.

**`welcome-greeting.tsx`** — small `<h1>` with the user's display name (Supabase `user.user_metadata.full_name` if present, else `user.email.split("@")[0]`). Falls back gracefully.

**Design system contract:** strictly use `components/ui/*` primitives and semantic tokens (`bg-surface-raised`, `text-text-primary`, `border-border-subtle`, `bg-state-hover`, etc.) per `youtubeai_chat_frontend/CLAUDE.md`. No raw palette colors.

### Page composition

**`/dashboard`** (`app/dashboard/page.tsx`, server component):

```tsx
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/auth/login");        // belt-and-braces; middleware should already do this

const rows = await getRecentHistory(supabase, user.id, 10);

return (
  <main className="…">
    <WelcomeGreeting user={user} />
    <InputForm />
    <section>
      <h2>Recent</h2>
      <HistoryList rows={rows} />
      {rows.length >= 10 && <Link href="/history">View all →</Link>}
    </section>
  </main>
);
```

**`/history`** (`app/history/page.tsx`, server component, `searchParams: { page?: string }`):

```tsx
const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
const { rows, total, totalPages } = await getHistoryPage(supabase, user.id, page, 25);

return (
  <main className="…">
    <h1>Your summaries</h1>
    <HistoryList rows={rows} />
    <HistoryPagination current={page} totalPages={totalPages} />
  </main>
);
```

### Error handling

- DB query fails on dashboard → render the input form normally, but replace `<HistoryList>` with an inline error: "Couldn't load your history right now." The form still works. Log the error.
- DB query fails on `/history` → render an error state at the page level: "Couldn't load your summaries. Try again later." with a back-to-dashboard link.
- Page-level errors (auth missing, etc.) bubble to Next's `error.tsx` boundary if added. Middleware should prevent this state.

### Loading state

`/dashboard` is server-rendered; data is fetched before the page streams. Initial load shows the full page. For *navigations* into `/dashboard` from another route, Next's default behavior is fine (no `loading.tsx` needed for v1). If the JOIN is slow in practice, we can wrap `<HistoryList>` in `<Suspense>` later — not in v1.

## Tests

### Unit (Vitest)

`lib/services/__tests__/user-history.test.ts`:
- `getRecentHistory` — returns rows in DESC order, honors limit, empty array for no history
- `getHistoryPage` — pagination math: page 1, page 2, last partial page, page beyond range (returns empty rows + correct total/totalPages)
- `getHistoryPage` — returns `total` and `totalPages` reflecting full-table count
- Both — malformed `youtube_url` row → `youtubeVideoId: null`, row still returned

`lib/supabase/__tests__/middleware.test.ts` — extend with:
- Logged-in user GET `/` → 302 to `/dashboard`
- Logged-out user GET `/` → 200 (no redirect)
- Logged-in user GET `/summary` → 200 (no redirect)
- Logged-in user GET `/dashboard` → 200
- Logged-out user GET `/dashboard` → 302 to `/auth/login`

`app/components/history/__tests__/history-row.test.tsx`:
- Renders title, channel, relative date
- Constructs correct `/summary?url=…` href with encoding
- Renders fallback thumbnail when `youtubeVideoId` is null
- a11y: role + accessible name include the title

`app/components/history/__tests__/empty-history-state.test.tsx`:
- Renders the empty-state copy

`app/dashboard/__tests__/page.test.tsx` and `app/history/__tests__/page.test.tsx`:
- Smoke render with mocked supabase + history service

### Playwright e2e (per project CLAUDE.md)

Per `youtubeai_chat/CLAUDE.md`, every UI change runs an e2e flow before being declared done. Sign-in uses creds at `~/.config/claude-test-creds/youtubeai.env`.

Flow to verify:
1. Anonymous GET `/` → marketing page renders.
2. Sign in → arrive at `/dashboard` (NOT `/`).
3. Empty state visible if account has no history; otherwise list is visible.
4. Submit a fresh URL via input form → after summary completes, return to `/dashboard` and confirm the new video appears at the top of the list.
5. Click a history row → lands on `/summary?url=…` and the cached summary renders without re-running.
6. If history > 10, click `View all →` → lands on `/history` page 1 with 25 rows.
7. Click `Next` → page=2 in URL, different rows visible.
8. Sign out → GET `/` → marketing page renders again (no redirect).

## Performance

- `/dashboard` adds two DB queries (auth + 10-row JOIN). Both indexed (`idx_user_video_history_user_id` exists).
- `/history` adds three (auth + page + count). The count is a `SELECT count(*) WHERE user_id = $1` against the same index — cheap.
- No client-side fetching, no waterfalls. Server component renders once, ships HTML.
- Thumbnails come from `i.ytimg.com` directly; no proxying.

## Security

- All DB reads use the auth-scoped Supabase client. RLS policy `history_select` enforces `auth.uid() = user_id`. The explicit `.eq("user_id", …)` in code is defense-in-depth, not the primary control.
- No service-role usage. No new RLS policies. No new tables. No migration.
- The `/summary?url=…` link only carries the original YouTube URL, which is already public information.

## Deferred (NOT v1)

- Search bar
- Filter by channel / date / language
- Delete a history item
- Pin / favorite
- Stats cards (videos summarized, time saved)
- Sort options (oldest, by channel)
- Infinite scroll on `/history`
- `last_viewed_at` column + cache-hit upsert (so re-runs bump position)
- Loading skeletons / Suspense boundaries (only if data fetch is slow in practice)
- Auth-aware logo `href` (currently `/`, redirects through middleware — fine)

## Open issues / risks

- **Sort order of re-runs.** Documented above. Decision: ship as-is.
- **Cache invalidation on logout.** `/dashboard` is server-rendered with the user's session. After logout, hitting `/dashboard` redirects to `/auth/login` via the existing middleware — no stale data leaks. Verified: there is no shared edge cache for these routes.
- **Bot traffic.** Crawlers should never reach `/dashboard` or `/history` (no public links, both require auth). Add `robots: { index: false }` metadata to both pages anyway.
- **Existing `/auth/sign-up` callback.** Sign-up flows currently land users on `/`. After this change, the `/` middleware redirect bounces them to `/dashboard` automatically — no callback wiring change needed.

## Acceptance criteria

- [ ] Anonymous user GET `/` renders marketing page (no regression).
- [ ] Logged-in user GET `/` redirects to `/dashboard`.
- [ ] `/dashboard` shows the input form, a "Recent" list of up to 10 rows, and a `View all →` link when there are 10+ rows.
- [ ] `/history` shows a paginated list of all the user's history, 25 per page, with prev/next controls.
- [ ] Clicking a row navigates to `/summary?url=…` and renders the cached summary.
- [ ] Empty state copy renders when the user has no history.
- [ ] All UI uses semantic design tokens; no raw palette classes.
- [ ] Unit tests pass; lint passes; Playwright e2e passes against `pnpm dev`.
- [ ] No new database migration shipped.
