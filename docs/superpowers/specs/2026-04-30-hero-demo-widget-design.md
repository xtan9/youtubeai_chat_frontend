# Hero demo widget — design

**Status:** approved (brainstorming → writing-plans handoff)
**Date:** 2026-04-30
**Scope:** Replace the bare "paste YouTube URL" form on the marketing homepage with an interactive demo widget that shows the real product running on five pre-cached sample videos. Anonymous visitors can browse summaries, transcripts, and chat with the AI on each sample. The existing paste-URL form remains, repositioned below the demo.

## Why

The current `/` hero ends in an empty input box. A visitor who has never seen the product has no idea what they're buying into until they paste a URL, wait for transcription, and hope the output is useful. That's a high-friction first impression. Eightify (and similar) instead show the product working on real videos, so the value prop is visible before the visitor commits anything. We can do better than Eightify by making the demo **fully interactive** — real cached summaries, real transcripts with clickable timestamps, real AI chat against each sample — not just static screenshots.

## Goal

An anonymous visitor landing on `/` sees:

1. The existing hero copy (`<HeroSection />`, the badge + gradient H1 + feature pills + anchor nav) — unchanged.
2. A new three-column **HeroDemo** widget below it:
   - **Col 1**: active video thumbnail + 6-card carousel of all samples
   - **Col 2**: `Summary | Transcript` tabs rendering real cached output for the active sample
   - **Col 3**: live `<ChatTab>` against the active sample — visitor can actually chat
3. A small "Or try your own video:" heading above the existing `<InputForm />`, which moves below the demo widget. The anon-summary-cap gate (`<AnonHomepageGate />`) stays directly above the input form.

Logged-in users continue to be redirected to `/dashboard` by middleware (decision from `2026-04-28-post-login-page-design.md`); the demo widget is only ever seen by anonymous visitors.

Out of scope for v1: video playback inside the widget (clicking thumbnail goes to YouTube), suggestion-based deep-linking to a specific sample (`?sample=...`), translating sample summaries to non-English locales, A/B testing widget vs. legacy form.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Reuse existing `<ChatTab>` directly in Col 3, not a hand-rolled chat | The real chat (suggestions, streaming, anon caps, paywall banners) is the demo. Hand-written Q&A would be marketing copy, not product proof. |
| 2 | Reuse `<SummaryContent>`'s ReactMarkdown component config via a new shared module `summary-markdown-renderer.tsx` | `SummaryContent` defines the brand-colored markdown styling (h1 with brand-secondary border, h2 brand-secondary, h3 brand, etc.). The hero demo must render summaries identically. Extract the renderer config; both sites consume it. No visual divergence. |
| 3 | Extract `signInAnonymously` bootstrap into `lib/hooks/useAnonSession.ts`; both `useYouTubeSummarizer` and `HeroDemo` consume it | `<ChatTab>` requires a Supabase user. Today only `useYouTubeSummarizer` (mounted on `/summary`) bootstraps the anon session. Without this extraction, anon visitors hitting the hero get 401 on chat. |
| 4 | Add optional `className?: string` prop to `<ChatTab>` to override its hardcoded `h-[640px]` | The hero column needs a different height. One-line addition. No behavior change for existing `/summary` callers. |
| 5 | Keep `<InputForm />` rendered below the demo, not delete it | Anon visitors get 1 free lifetime summary; the paste-URL flow is the entry point. Replacing it entirely would force every first-time visitor to sign up to use the product they haven't tried. |
| 6 | Lazy-load HeroDemo via `next/dynamic({ ssr: false })` with a thumbnail-only skeleton | `<ChatTab>` pulls react-markdown + 4 hooks + paywall components, currently `/summary`-only. Inline-importing into homepage bloats LCP. Skeleton ships at ~3KB; full widget chunk loads on idle/interaction. |
| 7 | Per-video data files under `app/components/hero-demo-data/<id>.ts` (dynamic imported per active sample), index file with metadata only | Five samples × ~10KB summary + ~30 truncated segments = ~50KB if shipped inline. Lazy-load drops initial payload to ~3KB metadata; each sample's full data loads on first selection. |
| 8 | Truncate transcript display to first ~30 segments + "View full transcript on /summary →" link | Full transcripts are 1100–3900 segments per sample; rendering all in the hero column overflows. 30 segments fills the visible scroll area; the link routes serious users to the existing /summary page where the full transcript renders. |
| 9 | Five samples for v1; sixth slot left open for the user to run later | The two cached Robert Greene videos (`2r2il8aj67w` + `BWJ4vnXIvts`) are both Chris Williamson interviews of the same guest — content collision. Drop the older "Laws of Human Nature" (`2r2il8aj67w`); keep "12 Laws of Power" (`BWJ4vnXIvts`). Adding a 6th later is one row in `index.ts`. |
| 10 | PostHog event `hero_demo_sample_selected { sample_id, sample_title }` on each carousel click | Track which samples drive engagement so we can swap underperformers. |

## Architecture

### Files added

```
app/components/hero-demo.tsx                       # the widget (client component)
app/components/__tests__/hero-demo.test.tsx        # unit tests
app/components/hero-demo-data/index.ts             # SAMPLES metadata array (id, title, channel, durationSec, thumbnailUrl, dataLoader)
app/components/hero-demo-data/Hrbq66XqtCo.ts       # Jensen × Dwarkesh full data
app/components/hero-demo-data/nm1TxQj9IsQ.ts       # Huberman Sleep full data
app/components/hero-demo-data/Mde2q7GFCrw.ts       # Lex × Yuval Harari full data
app/components/hero-demo-data/csA9YhzYvmk.ts       # Mo Gawdat E101 full data
app/components/hero-demo-data/BWJ4vnXIvts.ts       # Robert Greene 12 Laws of Power full data
app/summary/components/summary-markdown-renderer.tsx    # extracted ReactMarkdown components map
app/summary/components/__tests__/summary-markdown-renderer.test.tsx
lib/hooks/useAnonSession.ts                        # extracted hook
lib/hooks/__tests__/useAnonSession.test.tsx
```

### Files modified

```
app/page.tsx                                       # render order: HeroSection → HeroDemo → "Or try your own video:" heading → AnonHomepageGate → InputForm
lib/hooks/useYouTubeSummarizer.ts                  # replace inline anon-session block (lines 31–70) with useAnonSession() call
app/summary/components/chat-tab.tsx                # accept optional className prop
app/summary/components/summary-content.tsx         # import the markdown components map from summary-markdown-renderer.tsx instead of defining inline
```

### Component shape

```tsx
// app/components/hero-demo.tsx — single default-exported component
export default function HeroDemo() {
  useAnonSession();                                // bootstrap anon Supabase user for ChatTab
  const [activeId, setActiveId] = useState(SAMPLES[0].id);
  const [tab, setTab] = useState<"summary"|"transcript">("summary");
  const [data, setData] = useState<SampleData | null>(initialSampleData);
  const [fading, setFading] = useState(false);

  // Lazy-load the active sample's full data (summary + segments) on selection
  useEffect(() => { /* dynamic import + setData with 250ms fade */ }, [activeId]);

  const sample = SAMPLES.find(s => s.id === activeId)!;
  return (
    <section className="mx-auto max-w-page px-4 mb-16">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr]">
        <Col1 sample={sample} samples={SAMPLES} activeId={activeId} onSelect={setActiveId} />
        <Col2 data={data} fading={fading} tab={tab} onTabChange={setTab} fullSummaryHref={`/summary?url=${encodeURIComponent(sample.youtubeUrl)}`} />
        <Col3 youtubeUrl={sample.youtubeUrl} />
      </div>
    </section>
  );
}
```

### Data shape

```ts
// app/components/hero-demo-data/index.ts
export interface SampleMeta {
  readonly id: string;                  // YouTube ID
  readonly youtubeUrl: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly thumbnailUrl: string;        // https://i.ytimg.com/vi/{id}/maxresdefault.jpg
  readonly loadFullData: () => Promise<SampleData>;  // dynamic import
}

export interface SampleData {
  readonly id: string;
  readonly summary: string;             // markdown from cache
  readonly segments: ReadonlyArray<{ text: string; start: number; duration: number }>;  // first 30
  readonly model: string;
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  { id: "Hrbq66XqtCo", youtubeUrl: "https://www.youtube.com/watch?v=Hrbq66XqtCo", title: "Jensen Huang – Will Nvidia's moat persist?", channel: "Dwarkesh Patel", durationSec: 6191, thumbnailUrl: "https://i.ytimg.com/vi/Hrbq66XqtCo/maxresdefault.jpg", loadFullData: () => import("./Hrbq66XqtCo").then(m => m.default) },
  // ... 4 more
];
```

### Render contract — three columns

**Col 1 — Video + carousel.** Top: active sample's thumbnail in a `aspect-video` wrapper, click-through to `https://www.youtube.com/watch?v={id}` (new tab). Below: title (`text-h5`, line-clamp-2), channel + duration row (`text-body-sm text-text-muted`). Below that: horizontal-scroll row of 5 sample cards (mini thumbnail 96px wide, two-line title). Active card: `border-accent-brand ring-2 ring-accent-brand/30`. Inactive: `border-border-subtle hover:border-border-default`. Cards are `<button type="button" aria-pressed={i === active}>`.

**Col 2 — Summary / Transcript.** Radix `<Tabs>` from `components/ui/tabs.tsx`. The `Summary` tab renders the active sample's markdown via the shared `SummaryMarkdownComponents` map (same brand-colored headings, italic emphasis, blockquote styling as `/summary`). Container: `bg-surface-raised border border-border-subtle rounded-xl p-6`, internal scroll capped at `max-h-[560px]`. The `Transcript` tab renders the truncated 30 segments as a list — each row: timestamp pill (`bg-surface-sunken text-text-secondary text-caption font-mono`), text (`text-body-sm`). Below the list: `<a href="/summary?url=…">View full transcript on /summary →</a>`.

**Col 3 — Chat.** Reuses `<ChatTab youtubeUrl={sample.youtubeUrl} active={true} className="h-[480px] lg:h-[560px]" />`. Anon Supabase user is bootstrapped by `useAnonSession()` at the parent. Chat empty state shows auto-generated suggestions (`useChatSuggestions`); typing a question fires a real streamed response via `/api/chat/stream`; anon cap → existing `<ChatCapBanner variant="anon-blocked">`; free cap → existing `<ChatCapBanner variant="free-cap">`. No new chat code.

### Animation

When `activeId` changes:

1. `setFading(true)` → Col 2 wrapper gets `opacity-0`, transition `duration-base` (250ms).
2. Dynamic-import the new sample's data file.
3. After import resolves, `setData(...)` → `setFading(false)`. Col 2 fades back in.

Wrap with `motion-safe:transition-opacity` so users who set `prefers-reduced-motion: reduce` see instant swap.

### Mobile / responsive

- `<lg`: stack to a single column. Carousel becomes a horizontal-scroll row across the full screen width. Then Summary/Transcript tabs. Then chat (still working at full width).
- `<md`: chat panel becomes collapsible (`<details>`-based or accordion) so the homepage doesn't end with 480px of chat above the fold on phones.

### Token discipline

No raw color classes anywhere. All surfaces use `bg-surface-*`, text uses `text-text-*`, borders `border-border-*`, accents `accent-brand` / `accent-brand-secondary`. Highlighted keywords inside summary use `<mark>` (semantic) styled by the markdown components map.

### SEO / perf

- Homepage `<HeroSection />` stays server-rendered. No SEO regression on existing H1, structured data, or anchor nav.
- HeroDemo is dynamic-imported with `ssr: false`, so the initial HTML stays small. The skeleton (5 thumbnail cards) is server-rendered for layout stability.
- Each sample's full data file is ~10KB markdown + ~3KB segments = ~13KB compressed. Loaded only on selection.
- Initial payload addition: ~3KB metadata + ~13KB first sample's data (eager-bundled via static import in the index file so Sample 1 is visible immediately on widget hydration).
- The first sample's eager-bundle keeps "click sample 2" instant because by then idle prefetch has likely warmed the chunks.

### Anon flow

1. Visitor lands on `/`, no Supabase session.
2. HeroDemo's `useAnonSession()` calls `supabase.auth.signInAnonymously()` — anon user is created.
3. Visitor clicks Sample 2: data file dynamic-imports, Col 2 fades in with the new content. Col 3 (`ChatTab`) sees the new `youtubeUrl` prop, fetches `/api/chat/messages` (empty thread for this anon user × this video) + `/api/chat/suggestions` (auto-generated questions from the cached summary).
4. Visitor types a question, hits enter. `/api/chat/stream` streams a real answer, citing real timestamps from the cached transcript.
5. Visitor exhausts the anon chat cap — `<ChatCapBanner variant="anon-blocked">` appears with a sign-up CTA.
6. Visitor scrolls down: `<AnonHomepageGate />` either renders nothing (their 1 free anon summary is unused) or the existing `<AnonSignupWall reason="hit-cap" />` (they already used their free summary). Below: `<InputForm />` for pasting their own URL.

No change to /summary, no change to entitlements, no migration.

## Tests

### Unit (Vitest + React Testing Library)

- `hero-demo.test.tsx`:
  - Renders with sample 1's metadata visible (title, channel, duration formatted as "1h 43m")
  - Clicking sample 2's card sets `aria-pressed=true` on it and `false` on sample 1
  - Tab key navigation cycles through the 5 sample cards (Radix-free row, manual `tabIndex`)
  - Switching tabs swaps panel content (`role="tabpanel"`)
- `summary-markdown-renderer.test.tsx`: every existing test in `summary-content.theme.test.tsx` still passes after the extraction (proves no visual regression).
- `useAnonSession.test.tsx`: mocks Supabase; calls `signInAnonymously` once when no existing session; reuses existing session if one exists; handles the error path.

### E2E (Playwright)

`tests/e2e/hero-demo.spec.ts` — runs against `pnpm dev` on :3000:

1. Open `/` in a fresh anon context (no cookies).
2. Wait for the demo widget to hydrate (skeleton → real data).
3. Assert sample 1's title is visible in Col 1 + summary content (TL;DR text from the real cache) is visible in Col 2.
4. Click sample 2 (Huberman Sleep). Wait for fade. Assert sample 2's title + summary now show.
5. Switch to the Transcript tab. Assert a timestamp pill is rendered.
6. Type a question into the chat input ("What time of day should I get sunlight?"), press Enter. Assert the response streams and includes a timestamp citation `[mm:ss]` referencing the real transcript.
7. Scroll down. Assert the InputForm is still rendered and accepts a URL.

The test runs unauthenticated; logged-in users would 302 to /dashboard before the demo renders.

### Manual verification (post-deploy)

Vercel preview URL — eyeball the widget on light + dark themes, mobile + desktop, ensure no layout shift on sample swap, verify the chat actually streams against production data.

## Out of scope / deferred

- **Sixth sample.** Easy add — one row in `index.ts` + one new data file. Defer until user runs another URL.
- **Chat-suggestion `suggested_followups` backfill.** Currently `NULL` for all 5 sample rows in the DB. The chat tab generates them on-demand via `useChatSuggestions` hook, which calls `/api/chat/suggestions`. That endpoint computes them server-side from the cached summary. First visitor to chat with each sample populates the column. No action needed.
- **A/B test demo vs. legacy.** No flagging in v1; we keep the existing `<InputForm />` below as the safety net.
- **Sample data refresh.** When the AI improves and the cached summaries drift, regenerate via running the URLs through `/summary` and re-querying Supabase. Document the regeneration script in a follow-up if drift becomes painful.
- **Chat persistence across signup.** When an anon user upgrades, their anon-keyed chat threads don't migrate to the signed-in user. This is the same behavior as the rest of the app today; not introducing new state.

## File / line references for the planner

- Existing summary-content config to extract: `app/summary/components/summary-content.tsx:140-235` (the `components={...}` prop on `<ReactMarkdown>`).
- Existing anon-session bootstrap to extract: `lib/hooks/useYouTubeSummarizer.ts:31-70`.
- Existing chat-tab fixed height: `app/summary/components/chat-tab.tsx:74` (`flex h-[640px] flex-col rounded-lg ...`).
- Existing homepage render: `app/page.tsx:14-32`.
- Anon homepage gate: `app/components/anon-homepage-gate.tsx`.
- Existing input form: `app/components/input-form.tsx`.

## Sample data (locked)

| # | id | Title | Channel | Duration | Source verified |
|---|----|-------|---------|----------|-----------------|
| 1 | Hrbq66XqtCo | Jensen Huang – Will Nvidia's moat persist? | Dwarkesh Patel | 1h 43m 11s | DB cache |
| 2 | nm1TxQj9IsQ | Master Your Sleep & Be More Alert When Awake | Andrew Huberman | 1h 22m 3s | DB cache |
| 3 | Mde2q7GFCrw | Yuval Noah Harari (Lex Fridman Podcast #390) | Lex Fridman | 2h 44m 41s | DB cache |
| 4 | csA9YhzYvmk | The Happiness Expert: Mo Gawdat (DOAC E101) | The Diary Of A CEO | 1h 57m 34s | DB cache |
| 5 | BWJ4vnXIvts | 12 Laws Of Power For Life — Robert Greene #383 | Chris Williamson | 1h 5m 30s | DB cache |

Pre-captured snapshot of full data (summary markdown + transcript segments + timing) for all 5 lives at `/tmp/yt-demo-data/all.json` — to be lifted into the per-video data files during implementation.
