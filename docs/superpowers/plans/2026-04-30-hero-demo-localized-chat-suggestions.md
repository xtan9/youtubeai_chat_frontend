# Hero Demo: Localized Chat Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a visitor switches the hero demo's `LanguagePicker`, the chat empty-state's three suggested questions also switch to that language, sourced from per-`(id, lang)` data bundled at build time.

**Architecture:** Pre-bundle a 3-string suggestions tuple alongside the existing per-`(id, lang)` summary modules. Add an opt-in `suggestionsOverride` prop to `ChatTab` that bypasses the live `/api/chat/suggestions` fetch. `HeroDemoInner` plumbs `summary.suggestions` into the override, so language-picker swaps already drive the suggestion update through the existing summary lazy-load path. `/summary` chat behavior stays on the API path (override is opt-in, default-undefined).

**Tech Stack:** TypeScript, Next.js 15, React 19, Tailwind 4, Vitest (happy-dom), Playwright, pnpm. New seeding helper invokes the existing `generateSuggestedFollowups` (LLM gateway round-trip per combo).

---

## Files touched

- Modify `app/components/hero-demo-data/index.ts` — extend `HeroSampleSummary` with `suggestions: readonly [string, string, string]`.
- Modify `app/summary/components/chat-tab.tsx` — add `suggestionsOverride?: readonly string[]` prop; skip `useChatSuggestions` when set; pass through to `ChatEmptyState`.
- Modify `app/components/hero-demo.tsx` — pass `suggestionsOverride={summary?.suggestions}` to `<ChatTab>`.
- Modify `app/summary/components/__tests__/chat-tab.test.tsx` — add cases for the new prop.
- Modify `app/components/__tests__/hero-demo.test.tsx` — assert the chat tab receives per-language suggestions.
- Modify `scripts/build-hero-demo-data.ts` — emit the new `suggestions` field into each per-`(id, lang)` module.
- Create `scripts/seed-hero-demo-suggestions.ts` — reads `/tmp/yt-demo-data/all.json`, fills any `summaries[lang].suggestions` that's missing by calling `generateSuggestedFollowups` directly against the LLM gateway, writes the file back. Idempotent.
- Regenerate `app/components/hero-demo-data/<id>/<lang>.ts` — all 6 × 17 = 102 modules, via the build script. (Mechanically generated — committed file changes only.)
- Create `smoke-tests/e2e-hero-demo-suggestions.spec.ts` — Playwright e2e that switches the picker and asserts the chat empty-state suggestions change.
- Update `app/components/hero-demo-data/Hrbq66XqtCo/en.ts` (and the other 101 modules, via build script) with the new `suggestions` field.

---

### Task 1: Extend `HeroSampleSummary` with the `suggestions` tuple

**Files:**
- Modify: `app/components/hero-demo-data/index.ts:39-44`

- [ ] **Step 1: Inspect the current type**

Read `app/components/hero-demo-data/index.ts` lines 39-44. The current shape is:

```ts
export interface HeroSampleSummary {
  readonly id: HeroDemoVideoId;
  readonly language: string;
  readonly summary: string;
  readonly model: string;
}
```

- [ ] **Step 2: Add the field**

Replace the interface body with:

```ts
export interface HeroSampleSummary {
  readonly id: HeroDemoVideoId;
  readonly language: string;
  readonly summary: string;
  readonly model: string;
  /**
   * Three follow-up questions tailored to this (id, language) summary,
   * pre-generated at seed time by `scripts/seed-hero-demo-suggestions.ts`
   * and emitted by `scripts/build-hero-demo-data.ts`. Tuple-of-3 (not
   * `string[]`) so a mis-shaped regen fails `tsc` instead of rendering
   * one or two buttons in the empty state.
   */
  readonly suggestions: readonly [string, string, string];
}
```

- [ ] **Step 3: Verify the change compiles in isolation**

```bash
pnpm tsc --noEmit app/components/hero-demo-data/index.ts 2>&1 | head -20
```

Expected: errors only inside the per-`(id, lang)` modules that don't have `suggestions` yet (e.g. `Hrbq66XqtCo/en.ts`). The modules will be regenerated in Task 8.

- [ ] **Step 4: Commit**

```bash
git add app/components/hero-demo-data/index.ts
git commit -m "feat(hero-demo): extend HeroSampleSummary with suggestions tuple

Adds a 3-string tuple field that the per-(id, language) modules will
carry once the seed + build pipeline regenerates them. Tuple-of-3 type
keeps a regenerated module that emits the wrong shape from compiling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `suggestionsOverride` prop to `ChatTab`

**Files:**
- Modify: `app/summary/components/chat-tab.tsx:16-25,32-40`
- Test: `app/summary/components/__tests__/chat-tab.test.tsx`

- [ ] **Step 1: Write the failing test — `suggestionsOverride` wins over the hook**

In `app/summary/components/__tests__/chat-tab.test.tsx`, append (after the `falls back to static suggestions` test):

```ts
  it("renders the suggestionsOverride list when provided, ignoring the API", async () => {
    // The override should win even when the API would have returned a
    // different list — the hero demo uses this to ship pre-bundled
    // per-language suggestions.
    let suggestionsCalled = 0;
    const fetchMock = makeRouter({
      onMessages: () => jsonResponse({ messages: [] }),
      onSuggestions: () => {
        suggestionsCalled += 1;
        return jsonResponse({
          suggestions: [
            "API suggestion 1",
            "API suggestion 2",
            "API suggestion 3",
          ],
        });
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithChatProviders(
      <ChatTab
        youtubeUrl={VALID_URL}
        active={true}
        suggestionsOverride={[
          "Override question 1",
          "Override question 2",
          "Override question 3",
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Override question 1/ }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /Override question 2/ }),
    ).toBeTruthy();
    // None of the API suggestions render.
    expect(
      screen.queryByRole("button", { name: /API suggestion 1/ }),
    ).toBeNull();
    // And the hook never fired the request.
    expect(suggestionsCalled).toBe(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test -- app/summary/components/__tests__/chat-tab.test.tsx --run 2>&1 | tail -20
```

Expected: FAIL — the new prop doesn't exist yet, TypeScript error or runtime "API suggestion 1 not absent".

- [ ] **Step 3: Implement the prop**

Replace the `ChatTabProps` interface and the relevant body in `app/summary/components/chat-tab.tsx`:

```tsx
interface ChatTabProps {
  readonly youtubeUrl: string | null;
  readonly active: boolean;
  /**
   * Override the outer container classes. Lets the hero demo widget on `/`
   * use a shorter column height than `/summary`'s default `h-[640px]`.
   * When omitted, the original hardcoded height applies.
   */
  readonly className?: string;
  /**
   * Override the suggested-questions empty state. When provided, the
   * `/api/chat/suggestions` fetch is skipped — the override wins. Used
   * by the homepage hero demo to ship pre-bundled per-language
   * suggestions that swap when the demo's language picker changes.
   * Pass `undefined` (the default) on `/summary` to keep the existing
   * API-fetched behavior.
   */
  readonly suggestionsOverride?: readonly string[];
}
```

Then update the body. Find this block:

```tsx
export function ChatTab({ youtubeUrl, active, className }: ChatTabProps) {
  const [draftInput, setDraftInput] = useState("");
  ...
  const suggestions = useChatSuggestions(youtubeUrl, active);
```

and change to:

```tsx
export function ChatTab({
  youtubeUrl,
  active,
  className,
  suggestionsOverride,
}: ChatTabProps) {
  const [draftInput, setDraftInput] = useState("");
  // ...same setup as before...
  // Skip the API fetch entirely when an override is provided — the demo
  // never wants the server-generated native-language suggestions.
  const suggestions = useChatSuggestions(
    youtubeUrl,
    active && suggestionsOverride === undefined,
  );
```

Then find the `<ChatEmptyState ... dynamicSuggestions={suggestions.data?.suggestions} />` line and change to:

```tsx
        <ChatEmptyState
          onPickSuggestion={handlePickSuggestion}
          dynamicSuggestions={
            suggestionsOverride ?? suggestions.data?.suggestions
          }
        />
```

- [ ] **Step 4: Run the new test, expect PASS**

```bash
pnpm test -- app/summary/components/__tests__/chat-tab.test.tsx --run 2>&1 | tail -20
```

Expected: PASS for the new case AND all existing chat-tab cases still green (the override is opt-in).

- [ ] **Step 5: Commit**

```bash
git add app/summary/components/chat-tab.tsx app/summary/components/__tests__/chat-tab.test.tsx
git commit -m "feat(chat-tab): accept suggestionsOverride to bypass API fetch

When the prop is provided the useChatSuggestions hook is disabled and
the override list goes straight to ChatEmptyState. Default-undefined
keeps the existing /summary behavior. Used next by the hero demo to
ship pre-bundled per-language suggestions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire `HeroDemoInner` to pass `suggestionsOverride`

**Files:**
- Modify: `app/components/hero-demo.tsx:271-278`
- Test: `app/components/__tests__/hero-demo.test.tsx`

- [ ] **Step 1: Update the hero-demo test mock to expose the new prop**

Replace the `vi.mock("@/app/summary/components/chat-tab", ...)` block in `app/components/__tests__/hero-demo.test.tsx`:

```ts
vi.mock("@/app/summary/components/chat-tab", () => ({
  ChatTab: ({
    youtubeUrl,
    suggestionsOverride,
  }: {
    youtubeUrl: string | null;
    suggestionsOverride?: readonly string[];
  }) => (
    <div
      data-testid="chat-tab"
      data-yturl={youtubeUrl ?? ""}
      data-suggestions={(suggestionsOverride ?? []).join("|")}
    />
  ),
}));
```

- [ ] **Step 2: Add a failing test for the language → suggestions handoff**

Append a new case to `describe("HeroDemo", ...)` at the bottom (before the recovery test):

```ts
  it("hands per-language suggestions to ChatTab; switching language updates them", async () => {
    const user = userEvent.setup();
    render(<HeroDemo />);

    // Wait for the English summary to land, then capture the current
    // suggestions string from the stub.
    await waitFor(
      () =>
        expect(
          (document.body.textContent ?? "").includes("Jensen Huang argues"),
        ).toBe(true),
      { timeout: 8000 },
    );
    const chat = screen.getByTestId("chat-tab");
    const englishSuggestions = chat.getAttribute("data-suggestions") ?? "";
    expect(englishSuggestions.length).toBeGreaterThan(0);
    expect(englishSuggestions.split("|").length).toBe(3);

    // Switch the picker to Spanish.
    const trigger = screen.getByRole("button", { name: /Summary language/i });
    await user.click(trigger);
    const esOption = await screen.findByTestId("lang-option-es");
    await user.click(esOption);

    // Wait for the suggestions string to change.
    await waitFor(
      () => {
        const updated =
          screen.getByTestId("chat-tab").getAttribute("data-suggestions") ?? "";
        expect(updated).not.toBe(englishSuggestions);
        expect(updated.split("|").length).toBe(3);
      },
      { timeout: 8000 },
    );
  });
```

- [ ] **Step 3: Run the test, expect FAIL**

```bash
pnpm test -- app/components/__tests__/hero-demo.test.tsx --run 2>&1 | tail -20
```

Expected: FAIL — `englishSuggestions` is empty because the demo isn't passing `suggestionsOverride` yet.

- [ ] **Step 4: Wire the prop**

In `app/components/hero-demo.tsx`, find the chat column block (lines ~271-278):

```tsx
        {/* Col 3 — Chat */}
        <div className="min-w-0 lg:h-150">
          <ChatTab
            youtubeUrl={sampleUrl}
            active={true}
            className="h-full"
          />
        </div>
```

Replace with:

```tsx
        {/* Col 3 — Chat */}
        <div className="min-w-0 lg:h-150">
          <ChatTab
            youtubeUrl={sampleUrl}
            active={true}
            className="h-full"
            // Per-(id, language) bundle. While the lazy-load is in flight
            // (`summary` is null after a language switch) the override is
            // undefined → ChatEmptyState renders its static fallback for
            // the brief loading window. Once the new module lands the
            // localized suggestions take over.
            suggestionsOverride={summary?.suggestions}
          />
        </div>
```

- [ ] **Step 5: Run the test, expect PASS**

```bash
pnpm test -- app/components/__tests__/hero-demo.test.tsx --run 2>&1 | tail -20
```

Expected: PASS. (NOTE: this requires Task 8 to have actually populated the per-(id, lang) modules with suggestions. If Task 8 has not run yet, this test will fail with `englishSuggestions.length` being 0 because `summary.suggestions` is undefined. Plan executes in order — see Task 8 placement.)

- [ ] **Step 6: Commit**

```bash
git add app/components/hero-demo.tsx app/components/__tests__/hero-demo.test.tsx
git commit -m "feat(hero-demo): pass per-language suggestions to ChatTab override

Plumbs summary.suggestions through to ChatTab.suggestionsOverride so a
language-picker swap drives the chat empty-state through the existing
lazy-load fade. Test mock now exposes data-suggestions for assertion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Update `build-hero-demo-data.ts` to emit the new field

**Files:**
- Modify: `scripts/build-hero-demo-data.ts:38-105`

- [ ] **Step 1: Update the `CapturedSummary` interface and language emission**

In `scripts/build-hero-demo-data.ts`, replace the `CapturedSummary` interface (line 38-41):

```ts
interface CapturedSummary {
  readonly summary: string;
  readonly model: string;
  readonly suggestions: readonly [string, string, string];
}
```

Then update the per-language module emission (lines 82-100). Find:

```ts
    for (const lang of allLangs) {
      const s = r.summaries[lang];
      if (!s) {
        throw new Error(`MISSING (${id}, ${lang}) — re-run the seed script.`);
      }
      const langSrc = `// AUTO-GENERATED by scripts/build-hero-demo-data.ts. Do not edit by hand.

import type { HeroSampleSummary } from "../index";

const data: HeroSampleSummary = {
  id: ${JSON.stringify(id)},
  language: ${JSON.stringify(lang)},
  summary: ${JSON.stringify(s.summary)},
  model: ${JSON.stringify(s.model)},
};

export default data;
`;
      await writeFile(join(dir, `${lang}.ts`), langSrc, "utf8");
    }
```

Replace with:

```ts
    for (const lang of allLangs) {
      const s = r.summaries[lang];
      if (!s) {
        throw new Error(`MISSING (${id}, ${lang}) — re-run the seed script.`);
      }
      // Same loud-failure mode as the missing-summary guard: the build
      // halts so the dev re-runs `seed-hero-demo-suggestions.ts` rather
      // than silently emitting an `undefined` field.
      if (
        !Array.isArray(s.suggestions) ||
        s.suggestions.length !== 3 ||
        !s.suggestions.every((q) => typeof q === "string" && q.length > 0)
      ) {
        throw new Error(
          `MISSING SUGGESTIONS (${id}, ${lang}) — run scripts/seed-hero-demo-suggestions.ts`,
        );
      }
      const langSrc = `// AUTO-GENERATED by scripts/build-hero-demo-data.ts. Do not edit by hand.

import type { HeroSampleSummary } from "../index";

const data: HeroSampleSummary = {
  id: ${JSON.stringify(id)},
  language: ${JSON.stringify(lang)},
  summary: ${JSON.stringify(s.summary)},
  model: ${JSON.stringify(s.model)},
  suggestions: ${JSON.stringify(s.suggestions)} as const,
};

export default data;
`;
      await writeFile(join(dir, `${lang}.ts`), langSrc, "utf8");
    }
```

The `as const` cast on the `suggestions` array literal is what makes the readonly tuple type from Task 1 satisfied.

- [ ] **Step 2: Commit**

```bash
git add scripts/build-hero-demo-data.ts
git commit -m "build(hero-demo): emit suggestions tuple in per-(id, lang) modules

Build now reads summaries[lang].suggestions from /tmp/yt-demo-data/all.json
and writes a 3-string readonly tuple into each generated module. Loud
failure mode if any combo lacks suggestions (mirrors the missing-summary
guard) — the seed script must run first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create the seeding script `seed-hero-demo-suggestions.ts`

**Files:**
- Create: `scripts/seed-hero-demo-suggestions.ts`

- [ ] **Step 1: Write the script**

Create `scripts/seed-hero-demo-suggestions.ts`:

```ts
/**
 * Fill `/tmp/yt-demo-data/all.json` with per-(id, lang) suggested
 * follow-up questions. Reads each `summaries[lang].summary` already in
 * the file (placed there by `seed-hero-demo-translations.ts` + the prod
 * dump) and calls `generateSuggestedFollowups({ summary })` directly
 * against the LLM gateway.
 *
 * Idempotent: combos whose `summaries[lang].suggestions` is already a
 * valid 3-string array are skipped.
 *
 * Requires LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY env vars (pull them
 * from prod with `vercel env pull .env.production.local --environment=production`
 * once and source via `set -a; source .env.production.local; set +a`).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   pnpm tsx scripts/seed-hero-demo-suggestions.ts [--concurrency=4] [--only=<id>]
 *
 * --concurrency=N:  parallel LLM calls (default 4, max 8).
 * --only=<id>:      only seed combos for one specific id.
 */
import { readFile, writeFile } from "node:fs/promises";

import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import { SUPPORTED_OUTPUT_LANGUAGES } from "../lib/constants/languages";
import {
  generateSuggestedFollowups,
  type SuggestedFollowups,
} from "../lib/services/suggested-followups";

const DATA_PATH = "/tmp/yt-demo-data/all.json";
const PER_CALL_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 8;

interface CapturedSummary {
  summary: string;
  model: string;
  suggestions?: SuggestedFollowups;
}

interface CapturedRecord {
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number | null;
  nativeLanguage: string | null;
  segments: unknown[];
  summaries: Record<string, CapturedSummary>;
}

interface Combo {
  readonly id: string;
  readonly lang: string;
}

function parseArgs(): { concurrency: number; only: string | null } {
  const args = process.argv.slice(2);
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg
    ? Math.min(MAX_CONCURRENCY, Math.max(1, Number(concArg.split("=")[1]) || 4))
    : 4;
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;
  return { concurrency, only };
}

function isValidSuggestionsTuple(s: unknown): s is SuggestedFollowups {
  return (
    Array.isArray(s) &&
    s.length === 3 &&
    s.every((q) => typeof q === "string" && q.length > 0)
  );
}

async function main(): Promise<void> {
  const { concurrency, only } = parseArgs();
  const raw = await readFile(DATA_PATH, "utf8");
  const data = JSON.parse(raw) as Record<string, CapturedRecord>;
  const allLangs = SUPPORTED_OUTPUT_LANGUAGES.map((l) => l.code);
  const ids = only ? [only] : HERO_DEMO_VIDEO_IDS;

  const todo: Combo[] = [];
  for (const id of ids) {
    const r = data[id];
    if (!r) {
      throw new Error(`Missing record for ${id} in ${DATA_PATH}`);
    }
    for (const lang of allLangs) {
      const s = r.summaries[lang];
      if (!s) {
        throw new Error(
          `Missing summaries.${lang} for ${id} — run seed-hero-demo-translations.ts first`,
        );
      }
      if (!isValidSuggestionsTuple(s.suggestions)) {
        todo.push({ id, lang });
      }
    }
  }

  console.log(
    `[suggestions] ${todo.length} missing combos (concurrency=${concurrency}, only=${only ?? "all"})`,
  );
  if (todo.length === 0) return;

  let processed = 0;
  let okCount = 0;
  let errorCount = 0;
  const errors: { combo: Combo; message: string }[] = [];

  async function worker() {
    while (true) {
      const c = todo.shift();
      if (!c) return;
      const summary = data[c.id].summaries[c.lang].summary;
      const start = Date.now();
      try {
        const followups = await generateSuggestedFollowups({
          summary,
          timeoutMs: PER_CALL_TIMEOUT_MS,
        });
        data[c.id].summaries[c.lang].suggestions = followups;
        okCount += 1;
      } catch (err) {
        errorCount += 1;
        errors.push({
          combo: c,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      processed += 1;
      const elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`.padStart(6);
      console.log(
        `[suggestions] ${String(processed).padStart(3)}/${
          processed + todo.length
        }  ${elapsed}  ${c.id} ${c.lang}`,
      );

      // Checkpoint every 20 successes — protects long runs against a
      // crash that would otherwise lose all in-memory progress.
      if (okCount > 0 && okCount % 20 === 0) {
        await writeFile(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2), "utf8");

  console.log(
    `[suggestions] done. ok=${okCount} errors=${errorCount}`,
  );
  if (errorCount > 0) {
    console.error("[suggestions] errors:");
    for (const e of errors) {
      console.error(`  ${e.combo.id} ${e.combo.lang}: ${e.message}`);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script compiles**

```bash
pnpm tsc --noEmit scripts/seed-hero-demo-suggestions.ts 2>&1 | head -20
```

Expected: clean (no TS errors). Type errors at this point indicate a typo in the imports or the `data` shape.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-hero-demo-suggestions.ts
git commit -m "build(hero-demo): seed-hero-demo-suggestions.ts to populate per-lang followups

One-shot LLM script: reads /tmp/yt-demo-data/all.json, calls
generateSuggestedFollowups for each (id, lang) missing a 3-tuple, writes
back. Idempotent + checkpoints every 20 successes. Requires LLM_GATEWAY
env vars (vercel env pull) — no Playwright auth needed because the
prompt + summary are local.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Pull prod env, run the seeding script

**Files:**
- Use: `.env.production.local` (already pulled via `vercel env pull` during pre-flight; .gitignored)
- Use: `/tmp/yt-demo-data/all.json` (already populated with translated summaries — no need to re-run translations)

- [ ] **Step 1: Verify env vars present**

```bash
grep -E "^LLM_GATEWAY_(URL|API_KEY)=" .env.production.local | wc -l
```

Expected: `2`. If 0, run `vercel env pull .env.production.local --environment=production --yes` (the `.vercel/project.json` is already in place, copied during the worktree pre-flight).

- [ ] **Step 2: Verify the data file shape**

```bash
jq '.["Hrbq66XqtCo"].summaries.en | keys' /tmp/yt-demo-data/all.json
```

Expected: `["model", "summary"]` (no `suggestions` yet).

- [ ] **Step 3: Run the seeding script**

```bash
set -a; source .env.production.local; set +a
pnpm tsx scripts/seed-hero-demo-suggestions.ts --concurrency=4 2>&1 | tail -30
```

Expected: 102 combos processed, `ok=102 errors=0`. Each call ~1-3s; with concurrency 4, full run ~30-90s.

If any error: identify the offending combo from the log, retry with `--only=<id>`. Second attempt of the same combo failing → halt and surface (per ship-it Halt Conditions: pre-push gate fails twice).

- [ ] **Step 4: Verify the file now carries suggestions for every combo**

```bash
jq '[.[] | .summaries | to_entries | map(.value.suggestions | length)] | flatten | {min: min, max: max, count: length}' /tmp/yt-demo-data/all.json
```

Expected: `{"min": 3, "max": 3, "count": 102}`. Anything else means the seed script left holes.

- [ ] **Step 5: No commit yet** — `/tmp/yt-demo-data/all.json` is outside the repo; the next task converts it into committed module files.

---

### Task 7: Run the build script and stage the regenerated modules

**Files:**
- Modify: all 102 files at `app/components/hero-demo-data/<id>/<lang>.ts`

- [ ] **Step 1: Run the build**

```bash
pnpm tsx scripts/build-hero-demo-data.ts 2>&1 | tail -20
```

Expected: `wrote app/components/hero-demo-data/<id>/{base, 17 langs}.ts` six times. No `MISSING SUGGESTIONS` errors.

- [ ] **Step 2: Spot-check one regenerated module**

```bash
head -15 app/components/hero-demo-data/Hrbq66XqtCo/en.ts
```

Expected: the file ends with a `suggestions: [...] as const,` line. Each entry is a non-empty English string ending in `?`.

```bash
head -15 app/components/hero-demo-data/Hrbq66XqtCo/es.ts
```

Expected: the same structural shape, but the suggestion strings are in Spanish.

- [ ] **Step 3: Verify the type checker is happy**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: clean. The `suggestions: [...] as const` literal must satisfy `readonly [string, string, string]`.

- [ ] **Step 4: Run all tests**

```bash
pnpm test --run 2>&1 | tail -20
```

Expected: 1962+ tests pass (existing 1962 + the 2 new cases from Task 2/Task 3).

- [ ] **Step 5: Commit the data**

```bash
git add app/components/hero-demo-data
git commit -m "data(hero-demo): regenerate per-(id, lang) modules with suggestions

Output of \`pnpm tsx scripts/build-hero-demo-data.ts\` after the seeding
step populated /tmp/yt-demo-data/all.json with 102 (id, lang) tuples.
Each module now carries a 3-string suggestions tuple in the same
language as the summary it ships next to.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add the Playwright e2e for language-driven suggestion swap

**Files:**
- Create: `smoke-tests/e2e-hero-demo-suggestions.spec.ts`

- [ ] **Step 1: Write the spec**

Create `smoke-tests/e2e-hero-demo-suggestions.spec.ts`:

```ts
// Hero demo widget — language picker drives the chat empty state.
// Asserts the three suggestion buttons in column 3 change content when
// the picker swaps from English to Spanish, sourced from the bundled
// per-(id, lang) modules (no API call).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Hero demo — localized chat suggestions", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("picker swap rewrites the empty-state suggestion buttons", async ({
    page,
  }) => {
    await page.goto(BASE_URL + "/");

    // Wait for the demo to mount.
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The "Ask anything about this video" empty state lives in column 3.
    const emptyStateCopy = page.getByText(
      /Ask anything about this video, or start with a suggestion/i,
    );
    await expect(emptyStateCopy).toBeVisible({ timeout: 10_000 });

    // The empty-state buttons live in a <ul> alongside the prompt copy —
    // grab their text snapshot before switching language.
    const buttonsBefore = await page
      .locator("ul li button")
      .filter({ hasText: /\?$/ })
      .allInnerTexts();
    expect(buttonsBefore).toHaveLength(3);
    expect(buttonsBefore.every((t) => t.trim().length > 0)).toBe(true);

    // Switch the picker to Spanish.
    await page.getByRole("button", { name: /Summary language/i }).click();
    await page.getByTestId("lang-option-es").click();

    // Wait for the suggestion buttons to swap. Equality on the array
    // proves the swap happened; the new text doesn't need to be
    // language-detected, just *different*.
    await expect(async () => {
      const buttonsAfter = await page
        .locator("ul li button")
        .filter({ hasText: /\?$/ })
        .allInnerTexts();
      expect(buttonsAfter).toHaveLength(3);
      expect(buttonsAfter).not.toEqual(buttonsBefore);
    }).toPass({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Start the dev server**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
```

Wait for the server to listen:

```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q 200; do sleep 1; done
```

- [ ] **Step 3: Run the spec**

```bash
pnpm playwright test smoke-tests/e2e-hero-demo-suggestions.spec.ts --reporter=list 2>&1 | tail -30
```

Expected: 1 passed.

- [ ] **Step 4: Stop the dev server**

```bash
pkill -f "next dev" || true
```

- [ ] **Step 5: Commit**

```bash
git add smoke-tests/e2e-hero-demo-suggestions.spec.ts
git commit -m "test(hero-demo): e2e for picker-driven suggestion swap

Asserts the three chat empty-state buttons change text when the demo's
language picker swaps from English to Spanish. Doesn't assert specific
copy (translated text can drift) — equality-not-equals proves the swap
happened.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Pre-push gate — full lint + tests + Playwright sweep

- [ ] **Step 1: Lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: 0 errors. Fix any new violations before continuing.

- [ ] **Step 2: Unit + integration tests**

```bash
pnpm test --run 2>&1 | tail -10
```

Expected: 1964 tests pass (1962 baseline + 2 new).

- [ ] **Step 3: Hero-demo Playwright suite (existing + new)**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q 200; do sleep 1; done
pnpm playwright test smoke-tests/e2e-hero-demo.spec.ts smoke-tests/e2e-hero-demo-suggestions.spec.ts --reporter=list 2>&1 | tail -20
pkill -f "next dev" || true
```

Expected: all hero-demo specs pass.

If any step fails: fix in place, amend the most recent atomic commit (or open a new one if it's outside that task's scope), and re-run. Two failures of the same step → halt per ship-it spec.

---

### Task 10: Push and open the PR

- [ ] **Step 1: Rebase onto origin/main**

Per the user's standing rebase-before-push preference:

```bash
git fetch origin main
git rebase origin/main
```

If conflicts: this is a merge-conflict halt condition. Surface to the user.

- [ ] **Step 2: Push**

```bash
git push -u origin HEAD 2>&1
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat(hero-demo): localized chat suggestions per language" --body "$(cat <<'EOF'
## Summary
- Hero demo's chat empty-state suggestions now switch language when the picker swaps. 6 ids × 17 langs = 102 pre-bundled tuples.
- Adds `suggestionsOverride` prop to `ChatTab` so the demo can bypass the live `/api/chat/suggestions` API path. `/summary` chat is unchanged (override is opt-in).
- New seed script `scripts/seed-hero-demo-suggestions.ts` generates the 102 tuples by calling `generateSuggestedFollowups` per cached translated summary.
- Build script now emits the new field; loud-fail if a combo is missing.

## Spec
`docs/superpowers/specs/2026-04-30-hero-demo-localized-chat-suggestions-design.md`

## Test plan
- [x] `pnpm test` — 1964 unit/integration tests pass
- [x] `pnpm lint` — clean
- [x] Playwright `e2e-hero-demo.spec.ts` (existing) and `e2e-hero-demo-suggestions.spec.ts` (new) pass against `pnpm dev`
- [x] Spot-checked `Hrbq66XqtCo/{en,es}.ts` — suggestions are in the right language

## Out of scope
- Localizing `/api/chat/suggestions` for `/summary`'s own translated views (separate, larger product change).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL from the output.

---

### Task 11: PR review loop

Per ship-it spec — invoke `pr-review-toolkit:review-pr`, triage findings, fix or rebut, re-review until zero open. No iteration cap.

- [ ] **Step 1: Run review**

Invoke `pr-review-toolkit:review-pr` against the PR.

- [ ] **Step 2: Triage each finding**

For each finding:
- **Genuine issue** → fix, commit (atomic, with a clear message), push.
- **Disagreement** → apply `superpowers:receiving-code-review`, verify against actual code, post a PR review-thread reply explaining why with line refs.
- **Unsure** → treat as right, fix.

- [ ] **Step 3: Re-run review after substantial follow-up commits.**

Loop until zero open findings.

---

### Task 12: CI gate + merge

- [ ] **Step 1: Watch CI**

```bash
gh pr checks --watch
```

- [ ] **Step 2: One auto-fix attempt on any red check**

```bash
gh run view <run-id> --log-failed
```

Read the failing log, fix locally, push. Re-watch.

If the same check fails twice → halt per ship-it Halt Conditions.

- [ ] **Step 3: Merge**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Sync local main**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend
git checkout main
git pull
```

- [ ] **Step 5: Print final report** per ship-it skill format.

---

## Self-review

**Spec coverage check:**

- "Bundle suggestions per (id, lang)" → Task 1 (type), Task 4 (build emit), Task 6 (seed), Task 7 (regen). ✓
- "Tuple-of-3 not string[]" → Task 1. ✓
- "Generation script reads `/tmp/yt-demo-data/all.json` and calls `generateSuggestedFollowups`" → Task 5. ✓ (note: spec mentioned fetching prod summaries via Playwright, but `all.json` already contains them from prior runs — simpler and faster, doesn't change the contract).
- "Build script emits the new field, loud-fail if missing" → Task 4. ✓
- "ChatTab gets `suggestionsOverride`, skips `useChatSuggestions` when set" → Task 2. ✓
- "HeroDemo plumbs `summary?.suggestions` into the override" → Task 3. ✓
- "Static fallback when override is empty/undefined" → relies on existing `ChatEmptyState` behavior; `suggestionsOverride={undefined}` during loading → no override → hook + static fallback. ✓
- "Hero-demo test asserts language-driven suggestions update" → Task 3. ✓
- "Playwright e2e" → Task 8. ✓
- "/summary unchanged" → opt-in prop, no callers updated. ✓

**Placeholder scan:** none. Every step has full code or a runnable command.

**Type consistency:** the `readonly [string, string, string]` from Task 1 is satisfied by `[...] as const` literals from Task 4's build emit (each suggestion is a `string`, three elements). The `SuggestedFollowups` type from `lib/services/suggested-followups` is `readonly string[]` of length 3 (`z.array(z.string()).min(3).max(3)`) — assigning it directly to the tuple field requires the `as const` cast on the literal output, which Task 4 includes.

**Spec ambiguities resolved:**

- The spec's seeding section mentioned re-fetching translated summaries via Playwright + `/api/summarize/stream`. Since `/tmp/yt-demo-data/all.json` already carries them (a prior run's output), Task 5/6 reads from that file directly — same end state, no extra prod auth or network. Documented in the seed script's docstring.
- The spec said tests should "assert suggestions render in the picker language." The hero-demo test mocks `ChatTab` (so its rendered output isn't visible) — the test instead asserts that `suggestionsOverride` flowing through is non-empty and changes shape across language picks. The Playwright e2e covers the rendered-button-text axis end to end.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-30-hero-demo-localized-chat-suggestions.md`.

This is being executed under `/ship-it` autonomous mode — proceed via `superpowers:executing-plans` (inline; the LLM-bound seed task in Task 6 must run on a stable channel rather than a fresh subagent).
