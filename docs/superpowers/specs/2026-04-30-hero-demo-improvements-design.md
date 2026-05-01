# Hero demo widget — improvements

**Status:** approved (brainstorming → writing-plans handoff)
**Date:** 2026-04-30
**Scope:** Iterate on the v1 hero demo widget shipped in `2026-04-30-hero-demo-widget-design.md`. Replace the static thumbnail in column 1 with a real playable YouTube embed; render the full transcript with click-to-seek timestamps; replace the horizontal carousel with a 2×3 thumbnail grid; add a sixth sample; let anonymous visitors actually chat the demo samples; expose a working language switcher with all 17 supported languages pre-cached; equalize column heights.

## Why

The v1 widget proved the concept — visitors immediately see the product working — but several seams kept it from feeling like the real product:

- **Column 1 was a dead-end thumbnail.** Clicking opened YouTube in a new tab, breaking the demo's "everything happens here" promise. The transcript chips on `/summary` rely on a mounted player; without one, the chat's `[mm:ss]` chips are silently inert.
- **Transcript was capped at 30 segments and unscrubbable.** That's enough to hint at the feature but not enough to feel real, and clicking a timestamp did nothing.
- **The carousel left visible empty space below the active video** while making the sample-pick feel like a distinct horizontal-scroll surface. A 2×3 grid uses the column real-estate and reads as "pick one of these to demo."
- **Chat was paywalled** for anonymous visitors. The v1 widget ships them straight into a "Sign up to chat" banner the moment they engage with the actually-interactive column. The whole point of the widget is to let them feel the product before commitment.
- **Language switcher was hidden.** Multi-language summarization is a top differentiator; the homepage didn't surface it at all.
- **Column heights drifted.** Col 1 (~370px) was visibly shorter than col 2 (~600px), making the widget feel unbalanced.

This spec closes those seams.

## Goal

An anonymous visitor on `/`:

1. Sees a 3-column hero widget with all three columns sharing the same height (~600px on `lg`).
2. **Column 1**: a real `react-youtube` player (no autoplay) for the active sample, title + channel · duration line, and a 2×3 grid of all six samples below filling the remaining vertical space.
3. **Column 2**: `Summary | Transcript` tabs.
   - Summary tab has a working `LanguagePicker` (all 17 languages); selecting a language swaps the visible summary markdown to a pre-cached translation (lazy-loaded). Picker selection persists across sample switches.
   - Transcript tab renders the full transcript as paragraph-grouped blocks with clickable timestamps that seek the player and play; the active paragraph highlights as the video advances.
4. **Column 3**: live `<ChatTab>` against the active sample. Anonymous visitors can chat freely — no 402, no sign-up wall — for the six demo samples only. Chat answers' `[mm:ss]` chips seek the embedded player.

The new sample is `Yy-EC-BdoNY` (added to the registry; metadata, transcript, and 17-language summaries pre-cached). Total: 6 samples × 17 languages = 102 pre-cached summaries.

Out of scope: pre-caching translated transcripts (transcript stays video-native — the existing product does too); per-language chat (chat continues against the video-native context); language picker on the transcript tab; remembering the user's language pick across sessions (no localStorage); analytics events for language picks (PostHog event added in a follow-up if needed).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Wrap `<HeroDemo>` in `<PlayerRefProvider>` | The chat tab's existing `<TimestampChip>`s call `usePlayerRef().seekTo` — currently a no-op on `/`. With a player mounted and registered via the context, chat-derived timestamps become live. Same pattern `/summary` already uses. |
| 2 | Use the existing `react-youtube` player via a thin `<HeroPlayer>` wrapper, not iframe-only or `<iframe>` directly | Need `seekTo` / `playVideo` / `getCurrentTime` for transcript click-seek + active-paragraph highlight. The IFrame Player API is already a project dependency on `/summary` — reuse it. No autoplay (`playerVars` omits `autoplay: 1`); load-paused matches `/summary` and avoids browser autoplay-policy noise. |
| 3 | Reuse `/summary`'s `<TranscriptParagraphs>` directly, not a hero-specific copy | The component already does paragraph grouping (`groupSegments`), click-to-seek with autoplay-policy-tolerant error handling, active-paragraph polling, manual-scroll grace window, and "Read More" for long paragraphs. A hero-tuned copy would diverge. The component already accepts a `playerRef` prop; pass the same ref the hero player registers. |
| 4 | Anonymous chat allowlist via a single source of truth (`lib/constants/hero-demo-ids.ts`) consumed by both the API route and the data registry | Two consumers must never disagree on "what is a demo video." The constant is referenced by `app/api/chat/stream/route.ts` (to skip the 402) and by `app/components/hero-demo-data/index.ts` (to assert all `SAMPLES[].id` are in the allowlist via a build-time check). Existing rate limits still apply identically. |
| 5 | All 17 supported summary languages pre-cached, lazy-loaded one file at a time | "Show the language switch" must mean it actually works. Pre-caching all languages avoids on-the-fly translation costs from anon visitors and avoids waiting for a live summarize call. Per-language lazy-loading keeps the post-click chunk under ~20KB instead of bundling 17 × ~10KB = ~170KB upfront per sample. |
| 6 | Restructure data files: `app/components/hero-demo-data/<id>/{base,<lang>}.ts`; base = transcript+meta, `<lang>.ts` = summary markdown only | Transcript is video-native and identical regardless of summary language — duplicating it 17× would waste 17× the transcript bytes. Splitting base from per-language summary keeps each file focused and minimizes the post-click payload (one base + one language, not 17 stuffed into one file). |
| 7 | Drop `SEGMENT_LIMIT` from the build script — ship the full transcript per sample | Transcript becomes useful (every paragraph clickable) only at full fidelity. Per-sample base file grows from ~5KB (30 segments) to ~30–80KB (full transcript) — still acceptable for a lazy-loaded chunk. |
| 8 | All three columns share an explicit height on `lg` (`h-[600px]`); col 1 grid block uses `flex-1 min-h-0`; col 3 chat uses `lg:h-full` | Grid items default to row-stretch, but col 2's content uses `max-h-[560px]` on inner scroll containers + ~40px tabs list ≈ 600px. Pinning all columns to the same `lg:h-[600px]` and letting col 1's bottom block flex-fill the remaining space removes the drift. Mobile keeps the existing single-column stack — no shared-height constraint. |
| 9 | Sixth sample is `Yy-EC-BdoNY` | User-specified. Slot 6 was left open in v1 (decision #9 of the v1 spec). |
| 10 | Data-prep is a step inside execute, not a separate PR | Code change is meaningless without 102 cached summaries in prod. Bundling code + generated data files in one PR avoids a known-broken state on `main`. The seeding script and build script are part of this PR; the output `.ts` files are committed with the code that consumes them. |
| 11 | 2×3 grid is `grid grid-cols-3 gap-3` on every breakpoint (no responsive collapse) | Six thumbnails at three across read clearly even on a phone (~33% viewport each). Two-across would leave a ragged 6-th tile or force 3 rows on mobile, hurting density. |

## Architecture

### Files added

```
app/components/hero-player.tsx                          # react-youtube wrapper, registers playerRef in PlayerRefProvider
app/components/hero-thumbnail-grid.tsx                  # 2×3 toggle-button grid
app/components/__tests__/hero-player.test.tsx
app/components/__tests__/hero-thumbnail-grid.test.tsx
app/components/hero-demo-data/Yy-EC-BdoNY/base.ts       # transcript + meta for new sample
app/components/hero-demo-data/Yy-EC-BdoNY/<17 lang>.ts  # one per supported language
app/components/hero-demo-data/<existing-5-ids>/base.ts  # restructured from flat <id>.ts
app/components/hero-demo-data/<existing-5-ids>/<17 lang>.ts
lib/constants/hero-demo-ids.ts                          # HERO_DEMO_VIDEO_IDS readonly tuple
scripts/seed-hero-demo-translations.ts                  # Playwright-driven seeder for prod cache (102 combos)
```

### Files modified

```
app/components/hero-demo.tsx                            # restructured: PlayerRefProvider wrapper, hero-player + transcript-paragraphs + language-picker, 2×3 grid swap, equalized heights
app/components/hero-demo-data/index.ts                  # SAMPLES gains loadBase + loadSummary(lang); add 6th entry; assert SAMPLES.map(s=>s.id) === HERO_DEMO_VIDEO_IDS
app/api/chat/stream/route.ts                            # skip 402 when youtube_url's id is in HERO_DEMO_VIDEO_IDS
app/api/chat/stream/__tests__/route.test.ts             # cover allowlist branch
app/components/__tests__/hero-demo.test.tsx             # extend: language pick swaps summary, transcript click-seek, anon chat OK on demo IDs
scripts/build-hero-demo-data.ts                         # rewritten: emit per-id directories with base + 17 per-language files; remove SEGMENT_LIMIT; require all 17 lang rows present per id
```

### Component shape

```tsx
// app/components/hero-demo.tsx
import { PlayerRefProvider } from "@/lib/contexts/player-ref";

export default function HeroDemo() {
  useAnonSession();
  const [activeId, setActiveId] = useState(SAMPLES[0].id);
  const [tab, setTab] = useState<"summary"|"transcript">("summary");
  const [base, setBase] = useState<HeroSampleBase | null>(null);
  const [language, setLanguage] = useState<SupportedLanguageCode>("en");
  const [summary, setSummary] = useState<HeroSampleSummary | null>(null);
  const [browserLanguage, setBrowserLanguage] = useState<SupportedLanguageCode>("en");
  const [fading, setFading] = useState(false);
  const playerRef = useRef<YouTubePlayer | null>(null);

  // On mount: pick browser default language (does not auto-select; just tags
  // the picker entry).
  useEffect(() => { /* setBrowserLanguage(pickDefaultLanguage(...)) */ }, []);

  // On activeId change: load base (transcript + meta).
  useEffect(() => { /* dynamic import sample.loadBase() */ }, [activeId]);

  // On (activeId, language) change: load summary.
  useEffect(() => { /* dynamic import sample.loadSummary(language) with 250ms fade */ }, [activeId, language]);

  return (
    <PlayerRefProvider>
      <section className="mx-auto max-w-page px-4 mb-16 w-full">
        <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr] lg:items-stretch">
          <div className="flex flex-col gap-4 min-w-0 lg:h-[600px]">
            <HeroPlayer key={activeId} videoId={activeId} playerRef={playerRef} />
            <div>
              <h3 className="text-h5 line-clamp-2">{sample.title}</h3>
              <p className="text-body-sm text-text-muted mt-1">{sample.channel} · {formatDuration(sample.durationSec)}</p>
            </div>
            <div className="flex-1 min-h-0">
              <HeroThumbnailGrid samples={SAMPLES} activeId={activeId} onSelect={handleSelect} />
            </div>
          </div>
          <div className={cn("flex flex-col min-w-0 lg:h-[600px]", fading && "opacity-0", "motion-safe:transition-opacity duration-base")}>
            {/* Summary | Transcript tabs; LanguagePicker rendered above Summary content; Transcript renders <TranscriptParagraphs segments={base.segments} playerRef={playerRef} /> */}
          </div>
          <div className="min-w-0 lg:h-[600px]">
            <ChatTab youtubeUrl={youtubeUrlFor(activeId)} active={true} className="h-full" />
          </div>
        </div>
      </section>
    </PlayerRefProvider>
  );
}
```

### Data shape

```ts
// app/components/hero-demo-data/index.ts
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { HERO_DEMO_VIDEO_IDS } from "@/lib/constants/hero-demo-ids";

export interface HeroSampleBase {
  readonly id: string;
  readonly segments: ReadonlyArray<{ text: string; start: number; duration: number }>;
  readonly nativeLanguage: SupportedLanguageCode | null;  // detected at seed time, null if unknown
}

export interface HeroSampleSummary {
  readonly id: string;
  readonly language: SupportedLanguageCode;
  readonly summary: string;       // markdown
  readonly model: string;
}

export interface SampleMeta {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly loadBase: () => Promise<HeroSampleBase>;
  readonly loadSummary: (lang: SupportedLanguageCode) => Promise<HeroSampleSummary>;
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  // 6 entries; loadSummary uses a lang→loader map per id
];

// Build-time invariant: SAMPLES IDs must equal the allowlist.
const sampleIds = SAMPLES.map(s => s.id);
if (sampleIds.length !== HERO_DEMO_VIDEO_IDS.length || sampleIds.some((id, i) => id !== HERO_DEMO_VIDEO_IDS[i])) {
  throw new Error("HERO_DEMO_VIDEO_IDS and SAMPLES must stay in lockstep.");
}
```

### API allowlist branch

```ts
// app/api/chat/stream/route.ts (around line 88)
const isAnonymous = user.is_anonymous ?? false;
const videoId = extractYoutubeId(youtube_url);  // existing util
const isDemoVideo = videoId !== null && (HERO_DEMO_VIDEO_IDS as readonly string[]).includes(videoId);

if (isAnonymous && !isDemoVideo) {
  return new Response(JSON.stringify({
    message: "Sign up to chat about your videos.",
    errorCode: "anon_chat_blocked",
    tier: "anon",
    upgradeUrl: "/auth/sign-up",
  }), { status: 402, headers: { "Content-Type": "application/json" } });
}

// Existing rate-limit code path runs unchanged for both anon-on-demo and signed-in users.
```

### Build script changes

`scripts/build-hero-demo-data.ts` is rewritten to:

1. Read `/tmp/yt-demo-data/all.json`. The dump shape is now `Record<id, { base: { segments, nativeLanguage }, summaries: Record<lang, { summary, model }> }>` (driven by an updated `seed-hero-demo-translations.ts` step described below).
2. For each of the 6 ids:
   - Write `app/components/hero-demo-data/<id>/base.ts` with the full transcript (no SEGMENT_LIMIT) and metadata.
   - For each of the 17 languages, assert the row exists and write `app/components/hero-demo-data/<id>/<lang>.ts` with that language's summary markdown.
3. Index file (`hero-demo-data/index.ts`) is hand-curated; the script logs but does not regenerate it.

If a (id, lang) pair is missing, the script halts with a clear `MISSING (id, lang)` error so seeding gaps are visible immediately.

### Data-prep operational step (run during execute)

`scripts/seed-hero-demo-translations.ts` (new):

1. Reads test creds from `~/.config/claude-test-creds/youtubeai.env`.
2. Uses Playwright (already a project dependency) to sign in once on `https://www.youtubeai.chat`.
3. For each of the 6 × 17 = 102 (id, lang) pairs not already cached: navigate to `/summary?url={youtubeUrlFor(id)}&lang={lang}`, wait for the streaming-complete sentinel, move on. Skips combos already cached by checking the response shape.
4. After all 102 are present in prod, dump `youtube_summaries` and `youtube_segments` rows for the 6 ids via the Supabase MCP server (or direct CLI) into `/tmp/yt-demo-data/all.json` in the new shape.
5. The build script then materializes the per-id directories.

Wall-clock budget: ~30–60 minutes for the seeding step (parallelism 4–5 tabs). Script is resumable — re-running skips combos already present in cache.

This step lives in the plan as its own task, with a clear pre-condition (test account works on prod) and post-condition (all 102 .ts files generated and committed).

## Tests

**Unit / integration:**

- `app/api/chat/stream/__tests__/route.test.ts` — anon user + demo video URL → 200; anon user + non-demo URL → 402; signed-in user unchanged.
- `app/components/__tests__/hero-demo.test.tsx`:
  - On mount, English summary loads; switching to a non-current language loads the corresponding language file and replaces summary text.
  - Clicking a transcript paragraph timestamp calls `playerRef.seekTo(start, true)` then `playVideo()`.
  - Switching samples preserves the language selection.
  - Clicking a thumbnail in the 2×3 grid changes `activeId` and emits the existing PostHog `hero_demo_sample_selected` event.
- `app/components/__tests__/hero-player.test.tsx` — registers a player handle on `onReady`; clears it on unmount.
- `app/components/__tests__/hero-thumbnail-grid.test.tsx` — 6 cells; `aria-pressed` tracks active id; click fires `onSelect(id)`.

**E2E (Playwright, signed-out, against `pnpm dev` on `:3000`):**

1. Land on `/`. Verify HeroDemo widget renders, English summary visible.
2. Click a paragraph timestamp in the Transcript tab. Assert YouTube player network requests reflect a seek (or, if the seek isn't observable from the browser, assert the active-paragraph highlight moves to the clicked paragraph within ~500ms after a programmatic playback start).
3. Open language picker. Select a non-English language (e.g. `es`). Assert summary text content changes (use a stable Spanish heading like `## Resumen` if the summary contains one — or fall back to "summary text changes from baseline").
4. In the chat input, send "What's this video about?". Assert no 402 banner appears, response streams in. (Anon allowlist working.)
5. Click a different thumbnail in the 2×3 grid. Assert player swaps videoId, summary loads for the new sample but **language stays Spanish**.

Per `youtubeai_chat/CLAUDE.md`, Playwright e2e is mandatory before reporting work done. The test-creds env file format requires `set -a; source ...; set +a` per memory.

**Lint:** `pnpm lint` clean.

## Deployment notes

- Migrations: none. The change is code-only on the frontend; prod cache rows are populated via existing `/summary` flow.
- Vercel: per memory, `main`→prod auto-deploy is unreliable. Post-merge: run `vercel --prod --yes` to force the deploy, then re-run the e2e against `https://www.youtubeai.chat` to confirm the live widget works (especially that the prod-cached translations resolve correctly).

## Module risks

- **Bundle size growth.** Per-sample lazy chunk grows from ~10KB (truncated transcript + 1 summary) to ~30–80KB base + ~15KB summary = ~45–95KB on first sample selection in a given language. Subsequent language switches add ~15KB each. Initial homepage chunk is unchanged.
- **Player autoplay-policy interactions.** Browsers block `playVideo()` until the user has interacted with the page. The transcript click counts as a user gesture, so click-to-seek will play correctly. No special handling needed beyond what `<TranscriptParagraphs>` already does.
- **Anon allowlist scope creep.** The allowlist is a literal 6-id tuple. Tests assert that the API route only opens chat for these exact ids — preventing future drift where a sample gets dropped from the demo but stays in the allowlist (or vice-versa).
- **Seed-script flakiness.** Hitting prod 102 times depends on the live transcription + summarize service holding up. Script is resumable; partial failures recover by re-running and skipping cached combos.
