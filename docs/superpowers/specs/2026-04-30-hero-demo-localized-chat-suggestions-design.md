# Hero demo: localized chat suggestions

## Problem

The hero demo widget on `/` has a `LanguagePicker` (Summary tab,
column 2) that swaps the rendered summary across 17 languages without
hitting the network — it loads pre-bundled per-`(id, lang)` modules
from `app/components/hero-demo-data/<id>/<lang>.ts`.

The Chat column (column 3) is language-blind. Its empty state shows
three suggested follow-up questions sourced via
`useChatSuggestions(youtubeUrl, active)` → `/api/chat/suggestions`,
which reads/writes the row scoped `output_language IS NULL` and
generates "in the language of the summary" — i.e. the video's native
language.

Result: a visitor switches the picker to Spanish, the summary
re-renders in Spanish, but the chat empty state still shows the three
English (or whatever native-language) suggestions. The demo loses its
"this whole UI is bilingual" story.

## Goal

When the visitor switches the demo's language picker, the chat
empty-state's three suggested questions also switch to that language.
First paint stays deterministic (English by default — no auto-switch).
No runtime LLM cost: the suggestions for all 6 demo videos × 17
languages are pre-generated and bundled into the same per-`(id, lang)`
modules that already carry the translated summary.

This is **demo-only**. The `/summary` page's own chat tab continues to
use the existing native-language API behavior. Localizing chat
suggestions for translated `/summary` views is a separate, larger
product change (would need API + DB schema work) and is **out of
scope**.

## Non-goals

- Localizing `/api/chat/suggestions` for arbitrary translated
  summaries on `/summary`.
- Adding a `language` column to `summaries.suggested_followups`
  caching.
- Auto-detecting browser locale and switching the demo to that
  language on first paint (still a deterministic English first
  paint, matching the summary picker).
- Animating the suggestions swap (the existing column-2 fade is
  scoped to the Summary tab's container; the Chat column does not
  fade and that doesn't need to change for this work).

## Design

### Data shape: bundle suggestions per `(id, lang)`

Extend `HeroSampleSummary` (in `app/components/hero-demo-data/index.ts`)
with a third triple of strings:

```ts
export interface HeroSampleSummary {
  readonly id: HeroDemoVideoId;
  readonly language: string;
  readonly summary: string;
  readonly model: string;
  readonly suggestions: readonly [string, string, string];
}
```

Tuple-of-3 (not `string[]`) so that a regenerated module that emits
the wrong shape fails `tsc` instead of rendering one or two buttons in
the empty state. Matches the existing
`SuggestedFollowupsSchema = z.array(...).min(3).max(3)` invariant on
the API side.

The 102 per-language modules
(`app/components/hero-demo-data/<id>/<lang>.ts`) get a new
`suggestions: [...]` line. They're already auto-generated, so the
edit is in `scripts/build-hero-demo-data.ts`, not by hand.

### Seeding: generate suggestions per `(id, lang)`

Two steps in the existing pipeline:

1. **Generation step.** Add a new one-shot script
   `scripts/seed-hero-demo-suggestions.ts` that, for each of the
   6 × 17 = 102 combos, fetches the prod-cached translated summary
   text (via the same Playwright-authed `request.post` pattern as
   `seed-hero-demo-translations.ts`, hitting `/api/summarize/stream`
   and reading the `summary` event) and calls
   `generateSuggestedFollowups({ summary })` directly (the function is
   already exported from `lib/services/suggested-followups.ts`).
   Output: stash into `/tmp/yt-demo-data/all.json` under
   `summaries[<lang>].suggestions = [q1, q2, q3]`.

   Idempotent: skip combos whose JSON already has a non-null
   `suggestions` field. Run as:

   ```bash
   set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a
   pnpm tsx scripts/seed-hero-demo-suggestions.ts [--concurrency=4] [--only=<id>]
   ```

   Worth noting: this script is a developer tool, run once per data
   refresh — it does not need a CI hook. The existing
   `seed-hero-demo-translations.ts` is similarly run on demand.

2. **Build step.** Update `scripts/build-hero-demo-data.ts` to read
   `summaries[<lang>].suggestions` from `/tmp/yt-demo-data/all.json`
   and emit the new field into each per-`(id, lang)` module. Throw
   loudly with a `MISSING SUGGESTIONS (<id>, <lang>)` message if any
   combo is absent — same as the existing missing-summary guard.

### Wiring: pass suggestions through hero-demo → ChatTab

Add a single new optional prop to `ChatTab`:

```tsx
interface ChatTabProps {
  readonly youtubeUrl: string | null;
  readonly active: boolean;
  readonly className?: string;
  /**
   * Override the suggested-questions empty state. When provided,
   * `useChatSuggestions` is not called — the override wins. Used by
   * the homepage hero demo to ship pre-bundled per-language
   * suggestions that swap when the demo's language picker changes.
   * Pass `undefined` (the default) on `/summary` to keep the existing
   * API-fetched behavior.
   */
  readonly suggestionsOverride?: readonly string[];
}
```

In `ChatTab`:
- Skip `useChatSuggestions` when `suggestionsOverride` is provided
  (don't fire a useless network request — the demo never needs it,
  and the API is summary-cache-gated anyway).
- Pass `suggestionsOverride ?? suggestions.data?.suggestions` as the
  `dynamicSuggestions` prop on `ChatEmptyState`. (`ChatEmptyState`
  already falls back to its three static English suggestions when the
  prop is empty/undefined, which preserves the current `/summary`
  behavior unchanged.)

In `HeroDemoInner`:
- Pass `suggestionsOverride={summary?.suggestions}` to `<ChatTab>`.
  When the language picker fires its `setLanguage(...)` and the new
  summary lazy-load resolves, `summary.suggestions` updates and the
  three buttons in the empty state re-render in the picker language.
- During the 250ms summary fade, `summary` is still the previous
  language; that's fine — the Chat column doesn't fade and the user
  isn't reading both columns simultaneously.

Test impact:
- `app/summary/components/__tests__/chat-tab.test.tsx` — add a case
  that asserts `suggestionsOverride` wins over the hook-fetched data
  and that the hook is not called when it's set (or, more simply,
  that the rendered list matches the override).
- `app/summary/components/__tests__/chat-empty-state.test.tsx` — no
  changes (already covers the `dynamicSuggestions` precedence).

### Hero demo verification

- Update `app/components/__tests__/hero-demo.test.tsx`: with
  `language="en"` the empty state renders the English suggestion
  bundled into `Hrbq66XqtCo/en.ts`; switching the picker to Spanish
  re-renders with the Spanish bundle. Use the existing test helpers
  that drive the picker.
- Add a Playwright e2e at `smoke-tests/e2e-hero-demo-suggestions.spec.ts`
  (or extend `smoke-tests/e2e-hero-demo.spec.ts`):
  1. Visit `/`.
  2. Empty-state suggestion text in the chat column matches the
     English bundle.
  3. Click the language picker, choose Spanish.
  4. Wait for the summary column to settle (look for an `es`-specific
     summary heading).
  5. Empty-state suggestion text now matches the Spanish bundle.

## Data migration

None. The new `suggestions` field lives only in the bundled
client-side modules — no DB schema change. The 102 modules need a
one-time regeneration after the seeding step runs, committed to the
repo like the existing summary modules.

## Failure modes

- **Build script can't find `suggestions` for a combo.** The build
  throws and halts — same loud failure mode as a missing summary.
  The dev re-runs the seed script.
- **LLM produces fewer than 3 suggestions for a given combo.** The
  reused `generateSuggestedFollowups` validates with
  `SuggestedFollowupsSchema.min(3).max(3)` and rejects, so the seed
  script logs and reports `errors=N` at the end. The dev re-runs
  with `--only=<id>` to retry.
- **A language module is hand-edited and ends up with an empty
  `suggestions` tuple.** The tuple-of-3 type prevents this at
  compile time. If somehow it slips through (e.g. cast), the empty
  state's existing fallback logic
  (`dynamicSuggestions.length > 0 ? ... : STATIC_SUGGESTIONS`) shows
  the static English fallback rather than rendering nothing.

## Tradeoffs considered

- **Why not extend `/api/chat/suggestions` with a `language` param
  and cache per-row?** That's the right move for `/summary` long-
  term, but it requires a `summaries.suggested_followups` schema
  rethink (currently scoped to `output_language IS NULL`) and
  invalidation work. The demo would also still hit the API on every
  language switch, defeating the "everything is pre-bundled, swap is
  instant" pattern column 2 already establishes. Filed as a separate
  follow-up; not blocking this work.
- **Why a tuple-of-3 instead of `readonly string[]`?** The schema
  invariant is "exactly three." Making the type tell the truth lets
  `ChatEmptyState`'s fallback path (`length > 0`) stop being a
  defensive check for the demo case — though it stays for the API
  path where the route can return `[]` on its own failure modes.

## Acceptance

- All 6 × 17 = 102 hero-demo modules carry a 3-string `suggestions`
  tuple matching the language of the bundled summary.
- The chat column's empty state on `/` renders those three
  suggestions, swapping when the picker swaps.
- `pnpm test` passes (existing 1962 + new cases).
- `pnpm lint` clean.
- The Playwright spec passes against `pnpm dev`.
- `/summary` chat behavior is unchanged (override is opt-in;
  default-undefined keeps the existing API fetch path).
