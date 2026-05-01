# Hero Demo Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iterate on the v1 hero demo on `/` — playable embed, full clickable transcript, 2×3 thumbnail grid, sixth sample, anon-chat allowlist, working language picker with all 17 languages pre-cached, equalized column heights.

**Architecture:** Wrap `<HeroDemo>` in `<PlayerRefProvider>` and mount `react-youtube` via a slim `<HeroPlayer>` wrapper. Reuse `/summary`'s existing `<TranscriptParagraphs>` for click-to-seek transcript. Restructure per-sample data to `<id>/{base,<lang>}.ts` and lazy-load summary per language. API route gains an allowlist branch keyed off a single `HERO_DEMO_VIDEO_IDS` constant. Operational task seeds prod cache for 6 × 17 = 102 (id, lang) summaries via a Playwright-driven script before the build script materializes per-language data files.

**Tech Stack:** Next.js 15, React 19, TypeScript, react-youtube, Tailwind v4, Vitest, Playwright, Supabase (cache), Tailwind design-system tokens.

---

## Spec reference

`docs/superpowers/specs/2026-04-30-hero-demo-improvements-design.md`

## Working directory

All paths in this plan are relative to `/home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend` unless otherwise noted.

---

## Task 1: HERO_DEMO_VIDEO_IDS constant

**Files:**
- Create: `lib/constants/hero-demo-ids.ts`

- [ ] **Step 1: Create the constant file**

```ts
// lib/constants/hero-demo-ids.ts
/**
 * Single source of truth for "what counts as a hero-demo sample." Two
 * consumers depend on this list staying in lockstep:
 *   - `app/components/hero-demo-data/index.ts` (the SAMPLES registry,
 *     which asserts its ids equal this tuple at module-eval time).
 *   - `app/api/chat/stream/route.ts` (which lifts the anon-chat 402
 *     for these ids only).
 *
 * Keep this tuple sorted in the visible-grid order — the registry
 * iterates in this order to render the 2×3 thumbnail grid.
 */
export const HERO_DEMO_VIDEO_IDS = [
  "Hrbq66XqtCo",  // Jensen × Dwarkesh
  "nm1TxQj9IsQ",  // Huberman Sleep
  "Mde2q7GFCrw",  // Lex × Yuval Harari
  "csA9YhzYvmk",  // Mo Gawdat E101
  "BWJ4vnXIvts",  // Robert Greene 12 Laws of Power
  "Yy-EC-BdoNY",  // Sample 6 (added in this PR)
] as const;

export type HeroDemoVideoId = (typeof HERO_DEMO_VIDEO_IDS)[number];

export function isHeroDemoVideoId(id: string | null | undefined): id is HeroDemoVideoId {
  return id !== null && id !== undefined && (HERO_DEMO_VIDEO_IDS as readonly string[]).includes(id);
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm tsc --noEmit lib/constants/hero-demo-ids.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/constants/hero-demo-ids.ts
git commit -m "feat(hero): add HERO_DEMO_VIDEO_IDS allowlist constant"
```

---

## Task 2: API route allowlist branch + tests

**Files:**
- Modify: `app/api/chat/stream/route.ts:88-100`
- Modify: `app/api/chat/stream/__tests__/route.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Append two new test cases inside the existing `describe` block (find the existing "returns 402 with anon_chat_blocked for anonymous Supabase users" test around line 177 and add these immediately after):

```ts
  it("allows anonymous Supabase users to chat hero-demo videos (allowlist)", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "anon-1", is_anonymous: true } },
      error: null,
    });
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: true });
    mocks.checkChatEntitlement.mockResolvedValueOnce({ allowed: true });
    mocks.getCachedSummary.mockResolvedValueOnce(SUMMARY_FIXTURE);
    mocks.getCachedTranscript.mockResolvedValueOnce(TRANSCRIPT_FIXTURE);
    mocks.listChatMessages.mockResolvedValueOnce([]);
    mocks.appendChatUserMessage.mockResolvedValueOnce({ id: "m1" });
    mocks.streamChatCompletion.mockResolvedValueOnce(
      new ReadableStream({ start(c) { c.close(); } }),
    );

    const { POST } = await import("../route");
    const HERO_URL = "https://www.youtube.com/watch?v=Hrbq66XqtCo";
    const response = await POST(
      new Request("http://test/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtube_url: HERO_URL, message: "hi" }),
      }),
    );

    expect(response.status).not.toBe(402);
    expect(mocks.checkRateLimit).toHaveBeenCalled();
  });

  it("still 402s anonymous users on non-allowlisted videos", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "anon-2", is_anonymous: true } },
      error: null,
    });

    const { POST } = await import("../route");
    const NON_DEMO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const response = await POST(
      new Request("http://test/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtube_url: NON_DEMO, message: "hi" }),
      }),
    );

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.errorCode).toBe("anon_chat_blocked");
  });
```

- [ ] **Step 2: Run tests to verify the allowlist test fails**

Run: `pnpm vitest run app/api/chat/stream/__tests__/route.test.ts`
Expected: the new "allows anonymous … allowlist" test FAILS (status === 402 currently); the "still 402s … non-allowlisted" test PASSES (status === 402 today).

- [ ] **Step 3: Modify the route to honor the allowlist**

In `app/api/chat/stream/route.ts`, replace lines 88–100 (the `isAnonymous` block) with:

```ts
  const isAnonymous = user.is_anonymous ?? false;
  const videoId = (() => {
    const m = youtube_url.match(/[?&]v=([^&#]+)/);
    if (m) return m[1].length === 11 ? m[1] : null;
    const short = youtube_url.match(/youtu\.be\/([^?&#]+)/);
    return short && short[1].length === 11 ? short[1] : null;
  })();
  const isDemoVideo = videoId !== null && (HERO_DEMO_VIDEO_IDS as readonly string[]).includes(videoId);

  if (isAnonymous && !isDemoVideo) {
    return new Response(
      JSON.stringify({
        message: "Sign up to chat about your videos.",
        errorCode: "anon_chat_blocked",
        tier: "anon",
        upgradeUrl: "/auth/sign-up",
      }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }
```

Add to the imports at the top of the file:

```ts
import { HERO_DEMO_VIDEO_IDS } from "@/lib/constants/hero-demo-ids";
```

- [ ] **Step 4: Re-run tests**

Run: `pnpm vitest run app/api/chat/stream/__tests__/route.test.ts`
Expected: all tests PASS, including the new pair.

- [ ] **Step 5: Lint**

Run: `pnpm lint --file app/api/chat/stream/route.ts --file app/api/chat/stream/__tests__/route.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts app/api/chat/stream/__tests__/route.test.ts
git commit -m "feat(chat): allow anonymous chat on hero-demo videos via HERO_DEMO_VIDEO_IDS allowlist"
```

---

## Task 3: New per-sample data shape (types only, no SAMPLES change yet)

**Files:**
- Modify: `app/components/hero-demo-data/index.ts`

- [ ] **Step 1: Add the new types and helpers without removing the old `SampleData`/`SampleMeta` shapes**

Append to `app/components/hero-demo-data/index.ts` (after the existing exports, before `SAMPLES`):

```ts
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { HERO_DEMO_VIDEO_IDS } from "@/lib/constants/hero-demo-ids";

/**
 * Per-sample base payload — transcript + metadata. Identical regardless
 * of summary language; lazy-imported on sample selection.
 */
export interface HeroSampleBase {
  readonly id: string;
  readonly segments: ReadonlyArray<TranscriptSegment>;
  readonly nativeLanguage: SupportedLanguageCode | null;
}

/**
 * Per-sample-per-language summary payload. One file per (id, language)
 * pair; lazy-imported when the user picks a language for the active
 * sample.
 */
export interface HeroSampleSummary {
  readonly id: string;
  readonly language: SupportedLanguageCode;
  readonly summary: string;
  readonly model: string;
}

export interface HeroSampleMeta {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly loadBase: () => Promise<HeroSampleBase>;
  readonly loadSummary: (lang: SupportedLanguageCode) => Promise<HeroSampleSummary>;
}
```

- [ ] **Step 2: Sanity-check compilation**

Run: `pnpm tsc --noEmit`
Expected: no new errors. (Existing `SampleData`/`SampleMeta` exports remain valid; adding interfaces alongside is non-breaking.)

- [ ] **Step 3: Commit**

```bash
git add app/components/hero-demo-data/index.ts
git commit -m "feat(hero): add HeroSampleBase / HeroSampleSummary / HeroSampleMeta types"
```

---

## Task 4: HeroPlayer component

**Files:**
- Create: `app/components/hero-player.tsx`
- Create: `app/components/__tests__/hero-player.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/__tests__/hero-player.test.tsx
// @vitest-environment happy-dom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import type { YouTubePlayer } from "react-youtube";
import { PlayerRefProvider } from "@/lib/contexts/player-ref";
import HeroPlayer from "../hero-player";

vi.mock("react-youtube", () => ({
  default: ({ onReady }: { onReady?: (e: { target: YouTubePlayer }) => void }) => {
    // Fake player that exposes the YouTubePlayer surface tests care about.
    const fakePlayer = {
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(0),
    } as unknown as YouTubePlayer;
    setTimeout(() => onReady?.({ target: fakePlayer }), 0);
    return <div data-testid="yt-iframe-stub" />;
  },
}));

afterEach(() => cleanup());

function Harness({ videoId }: { videoId: string }) {
  const ref = useRef<YouTubePlayer | null>(null);
  return (
    <PlayerRefProvider>
      <HeroPlayer videoId={videoId} playerRef={ref} />
    </PlayerRefProvider>
  );
}

describe("HeroPlayer", () => {
  it("renders the YouTube iframe stub for a given videoId", () => {
    const { getByTestId } = render(<Harness videoId="abc" />);
    expect(getByTestId("yt-iframe-stub")).toBeTruthy();
  });

  it("captures the player handle into the playerRef on ready", async () => {
    const ref: { current: YouTubePlayer | null } = { current: null };
    function Inner() {
      return (
        <PlayerRefProvider>
          <HeroPlayer videoId="xyz" playerRef={ref} />
        </PlayerRefProvider>
      );
    }
    render(<Inner />);
    await new Promise((r) => setTimeout(r, 5));
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.seekTo).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (file missing)**

Run: `pnpm vitest run app/components/__tests__/hero-player.test.tsx`
Expected: FAIL with "Cannot find module '../hero-player'".

- [ ] **Step 3: Create the HeroPlayer component**

```tsx
// app/components/hero-player.tsx
"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import type { YouTubePlayer } from "react-youtube";
import { usePlayerRef } from "@/lib/contexts/player-ref";

const YouTubeNoSSR = dynamic(() => import("react-youtube"), { ssr: false });

interface HeroPlayerProps {
  readonly videoId: string;
  readonly playerRef: MutableRefObject<YouTubePlayer | null>;
}

export default function HeroPlayer({ videoId, playerRef }: HeroPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { registerPlayer } = usePlayerRef();

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    return () => registerPlayer(null);
  }, [registerPlayer]);

  const height = Math.floor((width / 16) * 9);

  return (
    <div ref={containerRef} className="w-full">
      <YouTubeNoSSR
        videoId={videoId}
        iframeClassName="rounded-xl w-full"
        opts={{
          width: String(width || 320),
          height: String(height || 180),
          playerVars: { playsinline: 1 },
        }}
        onReady={(event) => {
          playerRef.current = event.target;
          registerPlayer({
            seekTo: (seconds, allowSeekAhead) =>
              event.target.seekTo(seconds, allowSeekAhead ?? true),
            playVideo: () => event.target.playVideo(),
          });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run app/components/__tests__/hero-player.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/hero-player.tsx app/components/__tests__/hero-player.test.tsx
git commit -m "feat(hero): add HeroPlayer component (react-youtube wrapper)"
```

---

## Task 5: HeroThumbnailGrid component

**Files:**
- Create: `app/components/hero-thumbnail-grid.tsx`
- Create: `app/components/__tests__/hero-thumbnail-grid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/__tests__/hero-thumbnail-grid.test.tsx
// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

import HeroThumbnailGrid from "../hero-thumbnail-grid";

afterEach(() => cleanup());

const SAMPLES = [
  { id: "a1", title: "Alpha One", channel: "Ch", durationSec: 100 },
  { id: "a2", title: "Alpha Two", channel: "Ch", durationSec: 100 },
  { id: "a3", title: "Alpha Three", channel: "Ch", durationSec: 100 },
  { id: "a4", title: "Alpha Four", channel: "Ch", durationSec: 100 },
  { id: "a5", title: "Alpha Five", channel: "Ch", durationSec: 100 },
  { id: "a6", title: "Alpha Six", channel: "Ch", durationSec: 100 },
] as const;

describe("HeroThumbnailGrid", () => {
  it("renders one toggle button per sample", () => {
    render(
      <HeroThumbnailGrid
        samples={SAMPLES}
        activeId="a1"
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByRole("button").length).toBe(6);
  });

  it("marks the active sample with aria-pressed=true and others false", () => {
    render(
      <HeroThumbnailGrid
        samples={SAMPLES}
        activeId="a3"
        onSelect={() => {}}
      />,
    );
    const active = screen.getByRole("button", { name: /Alpha Three/i });
    const other = screen.getByRole("button", { name: /Alpha One/i });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onSelect with the clicked sample's id", () => {
    const onSelect = vi.fn();
    render(
      <HeroThumbnailGrid samples={SAMPLES} activeId="a1" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Alpha Four/i }));
    expect(onSelect).toHaveBeenCalledWith("a4");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run app/components/__tests__/hero-thumbnail-grid.test.tsx`
Expected: FAIL with "Cannot find module '../hero-thumbnail-grid'".

- [ ] **Step 3: Create the component**

```tsx
// app/components/hero-thumbnail-grid.tsx
"use client";

import Image from "next/image";

interface ThumbnailItem {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
}

interface HeroThumbnailGridProps {
  readonly samples: ReadonlyArray<ThumbnailItem>;
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
}

function thumbnailUrlFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

export default function HeroThumbnailGrid({
  samples,
  activeId,
  onSelect,
}: HeroThumbnailGridProps) {
  return (
    <div
      role="group"
      aria-label="Sample videos"
      className="grid grid-cols-3 gap-3 h-full"
    >
      {samples.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            aria-label={s.title}
            onClick={() => onSelect(s.id)}
            className={`flex flex-col gap-1 rounded-lg p-1.5 border transition-colors duration-base cursor-pointer min-w-0 ${
              active
                ? "border-accent-brand ring-2 ring-accent-brand/30"
                : "border-border-subtle hover:border-border-default"
            }`}
          >
            <div className="relative w-full aspect-video rounded overflow-hidden bg-surface-sunken">
              <Image
                src={thumbnailUrlFor(s.id)}
                alt=""
                fill
                sizes="(min-width: 1024px) 100px, 33vw"
                className="object-cover"
              />
            </div>
            <span className="text-body-xs text-text-primary line-clamp-2 text-left leading-snug">
              {s.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run app/components/__tests__/hero-thumbnail-grid.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/hero-thumbnail-grid.tsx app/components/__tests__/hero-thumbnail-grid.test.tsx
git commit -m "feat(hero): add HeroThumbnailGrid (2×3 toggle-button grid)"
```

---

## Task 6: Rewrite scripts/build-hero-demo-data.ts

**Files:**
- Modify: `scripts/build-hero-demo-data.ts` (full rewrite)

The new script consumes a snapshot in this shape:

```json
{
  "<id>": {
    "youtubeId": "<id>",
    "title": "...",
    "channel": "...",
    "durationSec": 1234,
    "nativeLanguage": "en",
    "segments": [...],
    "summaries": {
      "en": { "summary": "...markdown...", "model": "claude-..." },
      "es": { "summary": "...markdown...", "model": "claude-..." },
      ...
    }
  }
}
```

…and emits one `base.ts` plus seventeen `<lang>.ts` files per id.

- [ ] **Step 1: Replace the script body**

Overwrite `scripts/build-hero-demo-data.ts` with:

```ts
/**
 * Materialize per-id directories for the hero demo widget.
 *
 *   /tmp/yt-demo-data/all.json
 *     → app/components/hero-demo-data/<id>/base.ts          (transcript + meta)
 *     → app/components/hero-demo-data/<id>/<lang>.ts        (summary per language, 17 files)
 *
 * Run on demand:
 *   pnpm tsx scripts/build-hero-demo-data.ts
 *
 * The index file (app/components/hero-demo-data/index.ts) is hand-curated;
 * this script does not touch it.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import {
  SUPPORTED_OUTPUT_LANGUAGES,
  type SupportedLanguageCode,
} from "../lib/constants/languages";
import type { TranscriptSegment } from "../app/components/hero-demo-data";

interface CapturedSummary {
  readonly summary: string;
  readonly model: string;
}

interface CapturedRecord {
  readonly youtubeId: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly nativeLanguage: SupportedLanguageCode | null;
  readonly segments: TranscriptSegment[];
  readonly summaries: Record<string, CapturedSummary>;
}

async function main(): Promise<void> {
  const raw = await readFile("/tmp/yt-demo-data/all.json", "utf8");
  const data = JSON.parse(raw) as Record<string, CapturedRecord>;
  const outRoot = "app/components/hero-demo-data";
  const allLangs = SUPPORTED_OUTPUT_LANGUAGES.map((l) => l.code);

  for (const id of HERO_DEMO_VIDEO_IDS) {
    const r = data[id];
    if (!r) {
      throw new Error(`Missing captured data for ${id}`);
    }
    const dir = join(outRoot, id);
    await mkdir(dir, { recursive: true });

    const baseSrc = `// AUTO-GENERATED by scripts/build-hero-demo-data.ts. Do not edit by hand.
// Re-run \`pnpm tsx scripts/build-hero-demo-data.ts\` to refresh.

import type { HeroSampleBase } from "../index";

const data: HeroSampleBase = {
  id: ${JSON.stringify(id)},
  segments: ${JSON.stringify(r.segments)},
  nativeLanguage: ${JSON.stringify(r.nativeLanguage)},
};

export default data;
`;
    await writeFile(join(dir, "base.ts"), baseSrc, "utf8");

    for (const lang of allLangs) {
      const s = r.summaries[lang];
      if (!s) {
        throw new Error(`MISSING (${id}, ${lang})`);
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

    console.log(`wrote ${dir}/{base,<17 langs>}.ts`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script type-checks**

Run: `pnpm tsc --noEmit scripts/build-hero-demo-data.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-hero-demo-data.ts
git commit -m "feat(hero): rewrite build-hero-demo-data to emit per-language data files"
```

---

## Task 7: Seed-prod script (scripts/seed-hero-demo-translations.ts)

**Files:**
- Create: `scripts/seed-hero-demo-translations.ts`
- Modify: `package.json` (add a script alias)

This script signs in once with the test account, iterates the (id, lang) cross-product, and visits `/summary?url=URL&lang=LANG` until the streaming-complete sentinel appears in the DOM. Resumable: skips combos already cached on prod (detected via `data-cached="true"` attribute on the result container or by short-circuit response time).

- [ ] **Step 1: Create the script**

```ts
// scripts/seed-hero-demo-translations.ts
/**
 * Seed prod cache with hero-demo translations: 6 ids × 17 languages = 102
 * (id, lang) summarize calls. Idempotent — combos already cached resolve
 * in <500ms and are skipped via the cached-sentinel check.
 *
 * Auth: test account creds at ~/.config/claude-test-creds/youtubeai.env.
 * Use:
 *   set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a
 *   pnpm tsx scripts/seed-hero-demo-translations.ts [--dry-run] [--concurrency=4]
 *
 * --dry-run:   list combos that WOULD be visited; do not navigate.
 * --concurrency=N: parallel browser tabs (default 4, max 8).
 */
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { HERO_DEMO_VIDEO_IDS } from "../lib/constants/hero-demo-ids";
import { SUPPORTED_OUTPUT_LANGUAGES } from "../lib/constants/languages";

const BASE_URL = process.env.SEED_BASE_URL ?? "https://www.youtubeai.chat";
const SIGN_IN_URL = `${BASE_URL}/auth/login`;
const TEST_EMAIL = process.env.YOUTUBEAI_TEST_EMAIL;
const TEST_PASSWORD = process.env.YOUTUBEAI_TEST_PASSWORD;
const SUMMARY_TIMEOUT_MS = 180_000;
const MAX_CONCURRENCY = 8;

interface Combo {
  readonly id: string;
  readonly lang: string;
}

function parseArgs(): { dryRun: boolean; concurrency: number } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg
    ? Math.min(MAX_CONCURRENCY, Math.max(1, Number(concArg.split("=")[1]) || 4))
    : 4;
  return { dryRun, concurrency };
}

function buildCombos(): Combo[] {
  const langs = SUPPORTED_OUTPUT_LANGUAGES.map((l) => l.code);
  const out: Combo[] = [];
  for (const id of HERO_DEMO_VIDEO_IDS) {
    for (const lang of langs) {
      out.push({ id, lang });
    }
  }
  return out;
}

async function signIn(page: Page): Promise<void> {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Missing YOUTUBEAI_TEST_EMAIL / YOUTUBEAI_TEST_PASSWORD env. `source ~/.config/claude-test-creds/youtubeai.env` first.");
  }
  await page.goto(SIGN_IN_URL);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|summary|history|$)/, { timeout: 30_000 });
}

async function processCombo(context: BrowserContext, combo: Combo): Promise<"cached" | "fresh" | "error"> {
  const page = await context.newPage();
  try {
    const url = `${BASE_URL}/summary?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${combo.id}`)}&lang=${combo.lang}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const transcriptContainer = page.locator('[data-testid="transcript-container"]');
    await transcriptContainer.first().waitFor({ state: "attached", timeout: SUMMARY_TIMEOUT_MS });
    return "fresh";
  } catch (err) {
    console.error(`[seed] (${combo.id}, ${combo.lang}) failed:`, err);
    return "error";
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const { dryRun, concurrency } = parseArgs();
  const combos = buildCombos();
  console.log(`[seed] ${combos.length} combos (concurrency=${concurrency}, dryRun=${dryRun})`);

  if (dryRun) {
    for (const c of combos) console.log(`  ${c.id}\t${c.lang}`);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const authPage = await context.newPage();
  await signIn(authPage);
  await authPage.close();

  let processed = 0;
  let errors = 0;
  const queue = [...combos];
  async function worker() {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) return;
      const result = await processCombo(context, c);
      processed += 1;
      if (result === "error") errors += 1;
      console.log(`[seed] ${processed}/${combos.length} (${c.id}, ${c.lang}) -> ${result}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  await context.close();
  await browser.close();
  console.log(`[seed] done. processed=${processed} errors=${errors}`);
  if (errors > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add a package.json script alias for convenience**

Find the existing `scripts` block in `package.json` and add this entry (preserve the surrounding ordering and trailing comma rules):

```json
    "seed:hero-demo": "tsx scripts/seed-hero-demo-translations.ts",
```

- [ ] **Step 3: Type-check the script**

Run: `pnpm tsc --noEmit scripts/seed-hero-demo-translations.ts`
Expected: no errors.

- [ ] **Step 4: Smoke-test in dry-run mode**

Run: `pnpm tsx scripts/seed-hero-demo-translations.ts --dry-run`
Expected: prints 102 lines (6 ids × 17 langs), no network activity.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-hero-demo-translations.ts package.json
git commit -m "feat(hero): add seed-hero-demo-translations Playwright seeder"
```

---

## Task 8: Run the seed script against prod (operational task)

**Files:** none modified.

This task hits the prod summarize pipeline 102 times via the test account. Runs are idempotent (cached combos resolve in <500ms). Wall-clock budget: ~30–60 minutes at concurrency=4.

- [ ] **Step 1: Source the test creds**

Run:

```bash
set -a; source ~/.config/claude-test-creds/youtubeai.env; set +a
echo "$YOUTUBEAI_TEST_EMAIL"   # must print a non-empty email
```

Expected: prints the test email address.

- [ ] **Step 2: Confirm a single combo works end-to-end**

Run a one-off subset against prod first to catch any auth / DOM-selector regressions before the full sweep:

```bash
node -e "process.env.YOUTUBEAI_TEST_EMAIL && process.exit(0); process.exit(1)"
SEED_ONLY_FIRST=1 pnpm tsx -e "
  import('./scripts/seed-hero-demo-translations.ts').catch((e) => { console.error(e); process.exit(1); });
"
```

If the script exits cleanly on the smoke run, proceed. If it times out at the transcript-container wait, surface the failure to the user; do not push further.

(Note: implement `SEED_ONLY_FIRST` handling in the script if not already — a one-line guard at the top of `main()` that slices `combos` to the first entry when `process.env.SEED_ONLY_FIRST === "1"`.)

- [ ] **Step 3: Add the SEED_ONLY_FIRST guard to the script**

Edit `scripts/seed-hero-demo-translations.ts` `main()`:

```ts
  const combos = buildCombos();
  const trimmed = process.env.SEED_ONLY_FIRST === "1" ? combos.slice(0, 1) : combos;
  console.log(`[seed] ${trimmed.length} combos (concurrency=${concurrency}, dryRun=${dryRun})`);
```

(Replace subsequent uses of `combos` with `trimmed` inside `main()`.)

- [ ] **Step 4: Run the full sweep**

```bash
pnpm seed:hero-demo --concurrency=4 2>&1 | tee /tmp/seed-hero-demo.log
```

Expected: `[seed] done. processed=102 errors=0` at the tail.

If `errors > 0`: re-run (the script is idempotent). If errors persist on a specific (id, lang) combo, halt and surface to the user.

- [ ] **Step 5: No commit (operational step, no file changes)**

This task changes prod cache state, not local files. Proceed to Task 9.

---

## Task 9: Dump prod cache to /tmp/yt-demo-data/all.json

**Files:** none modified (writes to `/tmp/`, not the repo).

We use the existing prod Supabase via the supabase MCP server. The dump shape must match the `CapturedRecord` interface from `scripts/build-hero-demo-data.ts`.

- [ ] **Step 1: Identify the prod project**

Run:

```bash
# Using the supabase MCP. Operator: list_projects, then pick the prod one.
```

Note: this step uses the `mcp__plugin_supabase_supabase__list_projects` and `mcp__plugin_supabase_supabase__execute_sql` tools. Capture the prod project_id for the next step.

- [ ] **Step 2: Run the SQL dump**

Run a SQL query via the supabase MCP (`execute_sql`) against the prod project:

```sql
WITH ids(id) AS (
  VALUES
    ('Hrbq66XqtCo'), ('nm1TxQj9IsQ'), ('Mde2q7GFCrw'),
    ('csA9YhzYvmk'), ('BWJ4vnXIvts'), ('Yy-EC-BdoNY')
),
videos AS (
  SELECT v.id AS uuid_id, v.youtube_id, v.title, v.channel, v.duration_seconds
  FROM videos v
  JOIN ids ON v.youtube_id = ids.id
),
all_segments AS (
  SELECT v.youtube_id,
         jsonb_agg(
           jsonb_build_object(
             'text', s.text,
             'start', s.start_seconds,
             'duration', s.duration_seconds
           ) ORDER BY s.start_seconds
         ) AS segments
  FROM videos v
  JOIN youtube_segments s ON s.video_id = v.uuid_id
  GROUP BY v.youtube_id
),
all_summaries AS (
  SELECT v.youtube_id,
         jsonb_object_agg(
           COALESCE(ys.output_language, 'en'),
           jsonb_build_object('summary', ys.summary, 'model', ys.model)
         ) AS summaries
  FROM videos v
  JOIN youtube_summaries ys ON ys.video_id = v.uuid_id
  GROUP BY v.youtube_id
)
SELECT v.youtube_id,
       v.title,
       v.channel,
       v.duration_seconds AS duration_sec,
       NULL::text AS native_language,
       seg.segments,
       sum.summaries
FROM videos v
JOIN all_segments seg USING (youtube_id)
JOIN all_summaries sum USING (youtube_id);
```

(Adjust column names if the schema check below shows drift — see Step 3.)

- [ ] **Step 3: Verify schema-name consistency**

Before running the dump, run a smaller schema check:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('videos','youtube_segments','youtube_summaries')
ORDER BY table_name, ordinal_position;
```

If `videos.duration_seconds` is named something else (`duration`, `duration_sec`), update the dump SQL accordingly. The columns we depend on:
- `videos`: `id`, `youtube_id`, `title`, `channel`, `duration_seconds` (or alias)
- `youtube_segments`: `video_id`, `text`, `start_seconds`, `duration_seconds`
- `youtube_summaries`: `video_id`, `output_language` (nullable means `en`/native), `summary`, `model`

- [ ] **Step 4: Transform the rows into the expected JSON shape and write to /tmp**

Run a small transformer locally (paste the SQL output as `/tmp/yt-demo-raw.json` first, then):

```bash
node --experimental-strip-types <<'EOF'
import fs from "node:fs";
const raw = JSON.parse(fs.readFileSync("/tmp/yt-demo-raw.json", "utf8"));
const out: Record<string, any> = {};
for (const row of raw) {
  out[row.youtube_id] = {
    youtubeId: row.youtube_id,
    title: row.title,
    channel: row.channel,
    durationSec: row.duration_sec,
    nativeLanguage: row.native_language,
    segments: row.segments,
    summaries: row.summaries,
  };
}
fs.writeFileSync("/tmp/yt-demo-data/all.json", JSON.stringify(out, null, 2));
console.log(`wrote ${Object.keys(out).length} ids`);
EOF
```

Expected output: `wrote 6 ids`.

- [ ] **Step 5: Sanity-check the dump**

```bash
jq 'to_entries | map({id: .key, langs: (.value.summaries | keys | length), segs: (.value.segments | length)})' /tmp/yt-demo-data/all.json
```

Expected: 6 entries; each `langs == 17`, each `segs > 100` (full transcript, not truncated).

- [ ] **Step 6: No commit (writes to /tmp/)**

Proceed to Task 10.

---

## Task 10: Run the build script, commit generated files

**Files:**
- Delete: `app/components/hero-demo-data/Hrbq66XqtCo.ts`, `nm1TxQj9IsQ.ts`, `Mde2q7GFCrw.ts`, `csA9YhzYvmk.ts`, `BWJ4vnXIvts.ts` (flat-file legacy)
- Create: `app/components/hero-demo-data/<id>/base.ts` and `<id>/<lang>.ts` × 17, for all 6 ids (102 + 6 = 108 generated files)

- [ ] **Step 1: Remove the flat legacy data files**

```bash
rm -f \
  app/components/hero-demo-data/Hrbq66XqtCo.ts \
  app/components/hero-demo-data/nm1TxQj9IsQ.ts \
  app/components/hero-demo-data/Mde2q7GFCrw.ts \
  app/components/hero-demo-data/csA9YhzYvmk.ts \
  app/components/hero-demo-data/BWJ4vnXIvts.ts
```

- [ ] **Step 2: Run the build script**

```bash
pnpm tsx scripts/build-hero-demo-data.ts
```

Expected output: 6 `wrote app/components/hero-demo-data/<id>/{base,<17 langs>}.ts` lines.

- [ ] **Step 3: Verify the file count**

```bash
ls app/components/hero-demo-data/*/*.ts | wc -l
```

Expected: `108` (6 ids × 18 files: 1 base + 17 langs).

- [ ] **Step 4: Commit**

```bash
git add app/components/hero-demo-data/
git commit -m "chore(hero): regenerate per-id data with all 17 languages + 6th sample"
```

---

## Task 11: Update SAMPLES registry (index.ts) for the new structure

**Files:**
- Modify: `app/components/hero-demo-data/index.ts`

- [ ] **Step 1: Replace the SAMPLES export and remove the old SampleData/SampleMeta loaders**

Open `app/components/hero-demo-data/index.ts` and replace its entire contents with:

```ts
/**
 * Hero demo widget — sample registry. Lightweight metadata ships with the
 * homepage chunk; per-sample base (transcript + meta) and per-language
 * summary modules are dynamically imported on selection / language pick.
 *
 * Adding a sample:
 *   1. Cache it in prod via /summary?url=URL&lang=<each of 17> (or use scripts/seed-hero-demo-translations.ts).
 *   2. Run pnpm tsx scripts/build-hero-demo-data.ts to regenerate the per-id directory.
 *   3. Add the id to lib/constants/hero-demo-ids.ts AND a row here, in the same order.
 */
import {
  SUPPORTED_OUTPUT_LANGUAGES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import { HERO_DEMO_VIDEO_IDS } from "@/lib/constants/hero-demo-ids";

export interface TranscriptSegment {
  readonly text: string;
  readonly start: number;
  readonly duration: number;
}

export interface HeroSampleBase {
  readonly id: string;
  readonly segments: ReadonlyArray<TranscriptSegment>;
  readonly nativeLanguage: SupportedLanguageCode | null;
}

export interface HeroSampleSummary {
  readonly id: string;
  readonly language: SupportedLanguageCode;
  readonly summary: string;
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

export function youtubeUrlFor(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailUrlFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Per-id summary loader factory. Keeps the dynamic import() literal
// inline (so the bundler emits a code-split chunk per file) while
// presenting a single `loadSummary(lang)` shape to consumers.
function summaryLoaderFor(id: string) {
  return (lang: SupportedLanguageCode): Promise<HeroSampleSummary> => {
    switch (lang) {
      case "en": return import(`./${id}/en`).then((m) => m.default);
      case "es": return import(`./${id}/es`).then((m) => m.default);
      case "pt": return import(`./${id}/pt`).then((m) => m.default);
      case "it": return import(`./${id}/it`).then((m) => m.default);
      case "fr": return import(`./${id}/fr`).then((m) => m.default);
      case "de": return import(`./${id}/de`).then((m) => m.default);
      case "id": return import(`./${id}/id`).then((m) => m.default);
      case "zh": return import(`./${id}/zh`).then((m) => m.default);
      case "ja": return import(`./${id}/ja`).then((m) => m.default);
      case "ko": return import(`./${id}/ko`).then((m) => m.default);
      case "ar": return import(`./${id}/ar`).then((m) => m.default);
      case "hi": return import(`./${id}/hi`).then((m) => m.default);
      case "bn": return import(`./${id}/bn`).then((m) => m.default);
      case "ru": return import(`./${id}/ru`).then((m) => m.default);
      case "vi": return import(`./${id}/vi`).then((m) => m.default);
      case "tr": return import(`./${id}/tr`).then((m) => m.default);
      case "th": return import(`./${id}/th`).then((m) => m.default);
    }
  };
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  {
    id: "Hrbq66XqtCo",
    title: "Jensen Huang – Will Nvidia’s moat persist?",
    channel: "Dwarkesh Patel",
    durationSec: 6191,
    loadBase: () => import("./Hrbq66XqtCo/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("Hrbq66XqtCo"),
  },
  {
    id: "nm1TxQj9IsQ",
    title: "Master Your Sleep & Be More Alert When Awake",
    channel: "Andrew Huberman",
    durationSec: 4923,
    loadBase: () => import("./nm1TxQj9IsQ/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("nm1TxQj9IsQ"),
  },
  {
    id: "Mde2q7GFCrw",
    title:
      "Yuval Noah Harari: Human Nature, Intelligence, Power & Conspiracies #390",
    channel: "Lex Fridman",
    durationSec: 9881,
    loadBase: () => import("./Mde2q7GFCrw/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("Mde2q7GFCrw"),
  },
  {
    id: "csA9YhzYvmk",
    title:
      "The Happiness Expert That Made 51 Million People Happier: Mo Gawdat | E101",
    channel: "The Diary Of A CEO",
    durationSec: 7054,
    loadBase: () => import("./csA9YhzYvmk/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("csA9YhzYvmk"),
  },
  {
    id: "BWJ4vnXIvts",
    title:
      "12 Laws Of Power For Life — Robert Greene | Modern Wisdom Podcast 383",
    channel: "Chris Williamson",
    durationSec: 3930,
    loadBase: () => import("./BWJ4vnXIvts/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("BWJ4vnXIvts"),
  },
  {
    id: "Yy-EC-BdoNY",
    // TODO(hero-demo-followup): pull title/channel/durationSec from the
    // /tmp/yt-demo-data dump instead of hardcoding here. Resolve before
    // PR review.
    title: "TBD-FROM-DUMP",
    channel: "TBD-FROM-DUMP",
    durationSec: 0,
    loadBase: () => import("./Yy-EC-BdoNY/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("Yy-EC-BdoNY"),
  },
];

const sampleIds = SAMPLES.map((s) => s.id);
if (
  sampleIds.length !== HERO_DEMO_VIDEO_IDS.length ||
  sampleIds.some((id, i) => id !== HERO_DEMO_VIDEO_IDS[i])
) {
  throw new Error(
    "HERO_DEMO_VIDEO_IDS and SAMPLES must stay in lockstep (same order, same ids).",
  );
}
```

- [ ] **Step 2: Patch the 6th-sample metadata from the dump**

Read `/tmp/yt-demo-data/all.json` and copy `Yy-EC-BdoNY`'s `title`, `channel`, and `durationSec` into the registry:

```bash
jq -r '.["Yy-EC-BdoNY"] | "title=\(.title)\nchannel=\(.channel)\nduration=\(.durationSec)"' /tmp/yt-demo-data/all.json
```

Expected: prints `title=…\nchannel=…\nduration=…`.

Update the corresponding fields in the SAMPLES entry above; remove the `TODO(hero-demo-followup)` comment.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors. (The flat `<id>.ts` legacy files are gone; only the new directories are referenced.)

- [ ] **Step 4: Commit**

```bash
git add app/components/hero-demo-data/index.ts
git commit -m "feat(hero): SAMPLES registry uses loadBase/loadSummary; adds 6th sample"
```

---

## Task 12: HeroDemo restructure (player + transcript paragraphs + 2×3 grid + language picker + heights)

**Files:**
- Modify: `app/components/hero-demo.tsx` (significant rewrite)

- [ ] **Step 1: Replace the HeroDemo component**

Overwrite `app/components/hero-demo.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";
import type { YouTubePlayer } from "react-youtube";

import { ChatTab } from "@/app/summary/components/chat-tab";
import TranscriptParagraphs from "@/app/summary/components/transcript-paragraphs";
import { LanguagePicker } from "@/app/summary/components/language-picker";
import { useAnonSession } from "@/lib/hooks/useAnonSession";
import { buildSummaryMarkdownComponents } from "@/app/summary/components/summary-markdown-renderer";
import { PlayerRefProvider } from "@/lib/contexts/player-ref";
import { pickDefaultLanguage } from "@/lib/utils/browser-locale";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  SAMPLES,
  formatDuration,
  youtubeUrlFor,
  type HeroSampleBase,
  type HeroSampleSummary,
  type SampleMeta,
} from "./hero-demo-data";

const HeroPlayer = dynamic(() => import("./hero-player"), { ssr: false });
const HeroThumbnailGrid = dynamic(() => import("./hero-thumbnail-grid"), { ssr: false });

export default function HeroDemo() {
  return (
    <PlayerRefProvider>
      <HeroDemoInner />
    </PlayerRefProvider>
  );
}

function HeroDemoInner() {
  useAnonSession();
  const posthog = usePostHog();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const markdownComponents = buildSummaryMarkdownComponents({ isDark });

  const playerRef = useRef<YouTubePlayer | null>(null);
  const [activeId, setActiveId] = useState<string>(SAMPLES[0].id);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [base, setBase] = useState<HeroSampleBase | null>(null);
  const [language, setLanguage] = useState<SupportedLanguageCode>("en");
  const [browserLanguage, setBrowserLanguage] =
    useState<SupportedLanguageCode>("en");
  const [summary, setSummary] = useState<HeroSampleSummary | null>(null);
  const [fading, setFading] = useState(false);

  // Detect browser language once, post-mount, to tag the picker entry.
  // We do NOT auto-switch the picker selection — sticking with English
  // keeps the demo's first paint deterministic.
  useEffect(() => {
    const langs =
      typeof navigator !== "undefined" && navigator.languages
        ? Array.from(navigator.languages)
        : [];
    setBrowserLanguage(pickDefaultLanguage(langs, SUPPORTED_LANGUAGE_CODES));
  }, []);

  // Lazy-load the active sample's base (transcript + meta).
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === activeId);
    if (!sample) return;
    let cancelled = false;
    sample
      .loadBase()
      .then((b) => {
        if (!cancelled) setBase(b);
      })
      .catch((err) => {
        if (!cancelled) console.error(`[hero-demo] loadBase ${activeId}:`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Lazy-load the active (sample, language) summary; fade column 2.
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === activeId);
    if (!sample) return;
    setFading(true);
    let cancelled = false;
    const fadeDelay = setTimeout(() => {
      sample
        .loadSummary(language)
        .then((s) => {
          if (cancelled) return;
          setSummary(s);
          setFading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(
            `[hero-demo] loadSummary ${activeId}/${language}:`,
            err,
          );
          setFading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(fadeDelay);
    };
  }, [activeId, language]);

  const sample = SAMPLES.find((s) => s.id === activeId)! as SampleMeta;
  const sampleUrl = youtubeUrlFor(sample.id);
  const fullSummaryHref = `/summary?url=${encodeURIComponent(sampleUrl)}`;

  const handleSelect = (id: string) => {
    if (id === activeId) return;
    const next = SAMPLES.find((s) => s.id === id);
    if (!next) return;
    setActiveId(id);
    posthog?.capture("hero_demo_sample_selected", {
      sample_id: next.id,
      sample_title: next.title,
    });
  };

  return (
    <section className="mx-auto max-w-page px-4 mb-16 w-full">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr] lg:items-stretch">
        {/* Col 1 — playable video + 2×3 thumbnail grid */}
        <div className="flex flex-col gap-4 min-w-0 lg:h-[600px]">
          <HeroPlayer key={activeId} videoId={activeId} playerRef={playerRef} />
          <div>
            <h3 className="text-h5 text-text-primary line-clamp-2">
              {sample.title}
            </h3>
            <p className="text-body-sm text-text-muted mt-1">
              {sample.channel} · {formatDuration(sample.durationSec)}
            </p>
          </div>
          <div className="flex-1 min-h-0">
            <HeroThumbnailGrid
              samples={SAMPLES}
              activeId={activeId}
              onSelect={handleSelect}
            />
          </div>
        </div>

        {/* Col 2 — Summary | Transcript */}
        <div
          className={`flex flex-col min-w-0 lg:h-[600px] ${
            fading ? "opacity-0" : "opacity-100"
          } motion-safe:transition-opacity duration-base`}
        >
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "summary" | "transcript")}
            className="flex flex-col gap-3 h-full"
          >
            <div className="flex items-center justify-between gap-2">
              <TabsList className="self-start">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
              </TabsList>
              {tab === "summary" && (
                <LanguagePicker
                  currentLanguage={language}
                  browserLanguage={browserLanguage}
                  onSelect={(code) => setLanguage(code)}
                  isDark={isDark}
                />
              )}
            </div>

            <TabsContent value="summary" className="mt-0 flex-1 min-h-0">
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-6 h-full overflow-auto">
                <div className="prose max-w-none dark:prose-invert">
                  {summary ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {summary.summary}
                    </ReactMarkdown>
                  ) : (
                    <SummarySkeleton />
                  )}
                </div>
                <div className="mt-4 pt-4 border-t border-border-subtle">
                  <a
                    href={fullSummaryHref}
                    className="text-body-sm text-accent-brand hover:underline"
                  >
                    View full summary on /summary →
                  </a>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="transcript" className="mt-0 flex-1 min-h-0">
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-2 h-full overflow-hidden">
                {base ? (
                  <TranscriptParagraphs
                    segments={base.segments}
                    playerRef={playerRef}
                  />
                ) : (
                  <TranscriptSkeleton />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Col 3 — Chat */}
        <div className="min-w-0 lg:h-[600px]">
          <ChatTab
            youtubeUrl={sampleUrl}
            active={true}
            className="h-full"
          />
        </div>
      </div>
    </section>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-4 bg-surface-sunken rounded w-3/4" />
      <div className="h-4 bg-surface-sunken rounded w-full" />
      <div className="h-4 bg-surface-sunken rounded w-5/6" />
      <div className="h-4 bg-surface-sunken rounded w-4/5" />
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-2 animate-pulse p-4" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-sunken rounded w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint the file and its imports**

Run: `pnpm lint`
Expected: no new errors. (Existing TODO(B-followup) warnings are pre-existing and out of scope.)

- [ ] **Step 4: Commit**

```bash
git add app/components/hero-demo.tsx
git commit -m "feat(hero): playable video + clickable transcript + language picker + 2×3 grid + equalized heights"
```

---

## Task 13: Update hero-demo unit tests for the new structure

**Files:**
- Modify: `app/components/__tests__/hero-demo.test.tsx`

The existing tests reference `Will Nvidia` (sample 1 title), `Master Your Sleep` (sample 2 title), and assert the carousel button surface. The new test must:

1. Mock the (now async, lang-keyed) `loadBase` and `loadSummary` returns for at least two samples.
2. Mock `<HeroPlayer>` to a stub div so we don't pull `react-youtube`.
3. Mock `<TranscriptParagraphs>` to a stub div that exposes the segment count via a data attribute.
4. Cover: default-active sample, language pick swaps summary, sample switch keeps language, anon-chat-allowlist videoUrl plumbing.

- [ ] **Step 1: Replace the test file**

Overwrite `app/components/__tests__/hero-demo.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hooks/useAnonSession", () => ({
  useAnonSession: () => ({ anonSession: { access_token: "mock" }, isLoading: false }),
}));

vi.mock("@/app/summary/components/chat-tab", () => ({
  ChatTab: ({ youtubeUrl }: { youtubeUrl: string | null }) => (
    <div data-testid="chat-tab" data-yturl={youtubeUrl ?? ""} />
  ),
}));

vi.mock("@/app/summary/components/transcript-paragraphs", () => ({
  default: ({ segments }: { segments: ReadonlyArray<unknown> }) => (
    <div data-testid="transcript-stub" data-segcount={segments.length} />
  ),
}));

vi.mock("../hero-player", () => ({
  default: ({ videoId }: { videoId: string }) => (
    <div data-testid="hero-player" data-vid={videoId} />
  ),
}));

vi.mock("../hero-thumbnail-grid", () => ({
  default: ({
    samples,
    activeId,
    onSelect,
  }: {
    samples: ReadonlyArray<{ id: string; title: string }>;
    activeId: string;
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="hero-grid">
      {samples.map((s) => (
        <button
          key={s.id}
          aria-pressed={s.id === activeId}
          aria-label={s.title}
          onClick={() => onSelect(s.id)}
        >
          {s.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import HeroDemo from "../hero-demo";

afterEach(() => cleanup());

describe("HeroDemo", () => {
  it("activates sample 1 by default and renders its title", async () => {
    render(<HeroDemo />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Will Nvidia/i }),
      ).toBeTruthy();
    });
    const sample1Btn = screen.getByRole("button", { name: /Will Nvidia/i });
    expect(sample1Btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking another sample updates aria-pressed and ChatTab youtubeUrl", async () => {
    render(<HeroDemo />);
    const sample2 = await screen.findByRole("button", {
      name: /Master Your Sleep/i,
    });
    fireEvent.click(sample2);

    await waitFor(() => {
      expect(sample2.getAttribute("aria-pressed")).toBe("true");
    });

    const chat = screen.getByTestId("chat-tab");
    expect(chat.getAttribute("data-yturl")).toBe(
      "https://www.youtube.com/watch?v=nm1TxQj9IsQ",
    );
  });

  it("renders the English summary by default", async () => {
    render(<HeroDemo />);
    await waitFor(() => screen.getByText(/Jensen Huang/i), { timeout: 3000 });
  });

  it("switches to the Transcript tab and renders the TranscriptParagraphs stub with the loaded segments", async () => {
    const user = userEvent.setup();
    render(<HeroDemo />);
    await waitFor(() => screen.getByText(/Jensen Huang/i), { timeout: 3000 });

    const tab = screen.getByRole("tab", { name: /Transcript/i });
    await user.click(tab);

    await waitFor(() => {
      const stub = screen.getByTestId("transcript-stub");
      expect(Number(stub.getAttribute("data-segcount"))).toBeGreaterThan(10);
    });
  });

  it("language picker swaps the rendered summary and persists across sample switches", async () => {
    const user = userEvent.setup();
    render(<HeroDemo />);
    await waitFor(() => screen.getByText(/Jensen Huang/i), { timeout: 3000 });

    // Open the picker (it's labelled "Summary language: English. Click to change.")
    const trigger = screen.getByRole("button", { name: /Summary language/i });
    await user.click(trigger);

    // Pick Spanish
    const esOption = await screen.findByTestId("lang-option-es");
    await user.click(esOption);

    // Wait for Spanish summary to land. The fixture summary's first heading
    // contains "Jensen" in English; the Spanish file likely starts with
    // "Jensen Huang argumenta" or similar — assert the markdown text changed.
    await waitFor(() => {
      const spanishHeading = screen.queryByText(/argumenta|moat|Nvidia/i);
      expect(spanishHeading).toBeTruthy();
    }, { timeout: 3000 });

    // Switch sample — language must persist.
    const sample2 = screen.getByRole("button", { name: /Master Your Sleep/i });
    await user.click(sample2);
    await waitFor(() => {
      expect(sample2.getAttribute("aria-pressed")).toBe("true");
    });
    const triggerAfter = screen.getByRole("button", { name: /Summary language/i });
    expect(triggerAfter.textContent).toMatch(/Español/);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run app/components/__tests__/hero-demo.test.tsx`
Expected: all 5 tests PASS.

If "language picker swaps … " fails because the Spanish copy doesn't match the regex, adjust the regex to a string actually present in the prod-cached Spanish summary (read `app/components/hero-demo-data/Hrbq66XqtCo/es.ts` and pick a stable phrase).

- [ ] **Step 3: Commit**

```bash
git add app/components/__tests__/hero-demo.test.tsx
git commit -m "test(hero): cover new HeroDemo structure (player + transcript + language picker + grid)"
```

---

## Task 14: Pre-push gate — full lint + tests

**Files:** none modified. Verification only.

- [ ] **Step 1: Lint everything**

Run: `pnpm lint`
Expected: clean (no new errors). If lint complains about an arbitrary-pixel `lg:h-[600px]`, replace with the closest grid token (`lg:h-150` ≈ 600px on a 4px base) or add a `// TODO(design-followup)` comment per the design-system contract.

- [ ] **Step 2: Run the full unit-test suite**

Run: `pnpm test --run`
Expected: all PASS, including the chat/stream allowlist tests, all three new component tests (hero-player, hero-thumbnail-grid, hero-demo).

- [ ] **Step 3: Resolve any failures**

Common fix points:
- TranscriptParagraphs unit-test fixtures may need updating if they referenced the legacy SampleData shape (they don't — TranscriptParagraphs is `/summary`-side and untouched).
- Test for chat-tab on `/summary` may have a snapshot referencing height — update snapshot if it broke.

If fixes don't resolve in one attempt, halt and surface to the user.

- [ ] **Step 4: Commit only if fixes were applied**

```bash
git status
# If clean, no commit needed. If files changed for fixes:
git add <fixed-files>
git commit -m "fix(hero): address pre-push gate findings"
```

---

## Task 15: Playwright e2e on local dev

**Files:** none modified (one-shot verification).

Per `youtubeai_chat/CLAUDE.md`, every UI change must run a Playwright e2e before being reported done.

- [ ] **Step 1: Start the dev server in the background**

```bash
pnpm dev &
DEV_PID=$!
sleep 8  # give it time to compile
curl -sf http://localhost:3000/ > /dev/null   # health check
```

- [ ] **Step 2: Run the e2e flow via the playwright skill**

Use the `playwright` skill (or direct browser actions) to drive:

1. Open `http://localhost:3000/` in a fresh anonymous browser context (no auth).
2. Confirm: HeroDemo renders. Player iframe is present. Default English summary text is visible.
3. Switch to the Transcript tab. Click any paragraph timestamp. Assert: the YouTube iframe receives a `seekTo` postMessage (or, if the postMessage isn't directly observable, that the active-paragraph highlight class moves to the clicked paragraph within ~1.5s).
4. Open the language picker. Pick `es`. Wait for the summary text to change. Assert at least one previously-unseen Spanish word/phrase appears.
5. Type "What is this video about?" into the chat input and submit. Assert: NO 402 banner appears, the chat message list grows by one user message and at least one assistant token.
6. Click a different thumbnail in the 2×3 grid. Confirm: the player iframe `data-vid` (or src `?v=` parameter) changed. Confirm the language picker still reads `Español`.

- [ ] **Step 3: Stop the dev server**

```bash
kill $DEV_PID
```

- [ ] **Step 4: No commit (verification only)**

If any step failed, halt and surface to the user with the specific assertion that broke.

---

## Task 16: Push, open PR, run pr-review-toolkit

**Files:** none modified. PR-creation step.

- [ ] **Step 1: Rebase against origin/main (per user's standing preference)**

```bash
git fetch origin
git rebase origin/main
```

If the rebase produces conflicts, resolve them (do not skip), then continue.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 3: Create the PR**

```bash
gh pr create --title "feat(hero): playable embed + clickable transcript + 17-language picker + anon chat + 6th sample" --body "$(cat <<'EOF'
## Summary

- Replace v1 hero's static thumbnail with a real `react-youtube` player; chat `[mm:ss]` chips now seek the embed (was a no-op on `/`).
- Render the full transcript as paragraph-grouped clickable timestamps via the existing `<TranscriptParagraphs>` component (was: 30-segment plain-text cap, no seeking).
- Replace the horizontal carousel with a 2×3 thumbnail grid; add `Yy-EC-BdoNY` as the 6th sample.
- Pre-cache all 17 supported summary languages per sample; expose a working `<LanguagePicker>` above the Summary tab. Language pick persists across sample switches.
- Allow anonymous chat for the 6 demo videos via a single-source allowlist (`HERO_DEMO_VIDEO_IDS`); other videos still require sign-up.
- Equalize all three columns to `lg:h-[600px]`.

## Spec
`docs/superpowers/specs/2026-04-30-hero-demo-improvements-design.md`

## Plan
`docs/superpowers/plans/2026-04-30-hero-demo-improvements.md`

## Test plan
- [x] `pnpm vitest run` — full unit-test suite green (incl. new chat-stream allowlist tests, new hero-player / hero-thumbnail-grid / hero-demo tests).
- [x] `pnpm lint` clean.
- [x] Playwright e2e on local dev: home page renders, transcript click-seek works, language picker swaps summary, anon chat OK on demo IDs, sample switch preserves language.
- [ ] Post-deploy: re-run the same Playwright flow against `https://www.youtubeai.chat` after `vercel --prod --yes`.

## Operational note
Pre-cached translations were seeded on prod via `scripts/seed-hero-demo-translations.ts` (102 (id, lang) summarize calls via the test account). Per-language data files in `app/components/hero-demo-data/<id>/<lang>.ts` were generated via `pnpm tsx scripts/build-hero-demo-data.ts` from a Supabase dump.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Run pr-review-toolkit**

Invoke the `pr-review-toolkit:review-pr` skill with the new PR's URL or number. Address every finding:
- For genuine issues: fix, commit (with a fixup-style message), push.
- For findings you disagree with: invoke `superpowers:receiving-code-review` rigor — verify against actual code, then either fix anyway (defensive) or post a PR review-thread reply explaining why.
- Re-run pr-review-toolkit after any substantial commit.

Loop until zero open findings.

- [ ] **Step 5: Watch CI**

```bash
gh pr checks --watch
```

If a check fails:
1. `gh run view <run-id> --log-failed` to read the log.
2. One auto-fix attempt: identify the cause, fix, push.
3. If the same check fails twice → halt.

---

## Task 17: Merge + post-deploy verification

**Files:** none modified.

- [ ] **Step 1: Merge**

Once CI is green and pr-review-toolkit reports no open findings:

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
```

- [ ] **Step 2: Force prod deploy** (per user memory: main→prod auto-deploy is unreliable)

```bash
vercel --prod --yes
```

Wait for the deploy to finish; capture the deploy URL.

- [ ] **Step 3: Post-deploy Playwright e2e against prod**

Re-run the e2e from Task 15 against `https://www.youtubeai.chat`. Confirm:
- Player loads and seeking works.
- Language picker swaps summary on prod (validates that the prod cache rows the seed script wrote are reachable from prod).
- Anon chat works on demo IDs.

If prod e2e passes: print final SHIPPED report.
If prod e2e fails: do **not** claim success. Halt and surface (per memory: "saying 'should work after deploy' is not a substitute").

- [ ] **Step 4: Final report**

```
SHIPPED ✅
Spec:       docs/superpowers/specs/2026-04-30-hero-demo-improvements-design.md
Plan:       docs/superpowers/plans/2026-04-30-hero-demo-improvements.md
Branch:     feat/hero-demo-improvements (deleted)
PR:         <url>
Merge SHA:  <sha>
Iterations: <plan-commits + execute-commits + fix-commits>
Review cycles: <count>
CI re-runs: <count>
Decisions logged:
- Anon-chat scope: allowlisted to 6 demo IDs (not global).
- Language scope: all 17 supported languages pre-cached (not on-demand).
- Data-prep: seeded prod via Playwright (test account); dumped via Supabase MCP; materialized via build script — bundled in this PR.
- 6th sample metadata: pulled from prod dump after seeding.
```

---

## Self-review

**Spec coverage:**
- ✅ Playable embed in col 1 → Task 4 (HeroPlayer) + Task 12 (HeroDemo wires it).
- ✅ Full clickable transcript → Task 12 (uses `/summary`'s `<TranscriptParagraphs>`); Task 6 (build script removes `SEGMENT_LIMIT`).
- ✅ 2×3 thumbnail grid → Task 5 (component) + Task 12 (uses it).
- ✅ Sixth sample → Tasks 8–11 (seed, dump, build, register).
- ✅ Anon chat allowlist → Tasks 1, 2.
- ✅ Working language picker, all 17 languages → Tasks 6 (build), 7–10 (data prep), 11 (registry), 12 (UI wiring).
- ✅ Equalized column heights → Task 12.

**Placeholder scan:** No "TBD" / "TODO" placeholders in plan steps except the explicit `TODO(hero-demo-followup)` in Task 11 Step 1 which is *fixed* in the same task's Step 2.

**Type consistency:** `HeroSampleBase`, `HeroSampleSummary`, `SampleMeta`, `TranscriptSegment` used consistently across Tasks 3, 6, 11, 12. `loadBase` / `loadSummary` signatures match across the build script, the registry, and the consumer. `HERO_DEMO_VIDEO_IDS` consumed identically by API route (Task 2), build script (Task 6), seed script (Task 7), and registry (Task 11).

**Risk hotspots flagged for execute:**
- Task 8 (run seed against prod) — mutates shared system. Idempotent and resumable, but ~30–60min wall-clock.
- Task 9 (Supabase dump) — read-only.
- Task 17 Step 2 (`vercel --prod --yes`) — ships to live users. Per spec.
