# Hero Demo Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the marketing-homepage paste-URL form with an interactive 3-column demo widget that shows the real product (cached summaries, transcripts, live AI chat) running on five sample videos.

**Architecture:** New client component `<HeroDemo>` mounted between the existing `<HeroSection>` and the (relocated) `<InputForm>`. Reuses `<ChatTab>` directly for Col 3 chat — extract the anon-Supabase-session bootstrap into a shared hook so it works without `/summary` being mounted. Reuses the markdown styling from `<SummaryContent>` via a shared renderer module so the demo's summary panel is visually identical to `/summary`. Per-sample data is dynamically imported on first selection to keep initial homepage payload small.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 4 with the project's design-system tokens, Vitest + React Testing Library, Playwright (smoke-tests/), Radix Tabs, react-markdown, posthog-js.

**Spec:** `docs/superpowers/specs/2026-04-30-hero-demo-widget-design.md`

---

## File map

**Created**
- `lib/hooks/useAnonSession.ts` — extracted Supabase-anon-sign-in hook
- `lib/hooks/__tests__/useAnonSession.test.tsx` — unit tests
- `app/summary/components/summary-markdown-renderer.tsx` — shared ReactMarkdown components map
- `app/summary/components/__tests__/summary-markdown-renderer.test.tsx` — unit tests
- `app/components/hero-demo.tsx` — the widget
- `app/components/__tests__/hero-demo.test.tsx` — unit tests
- `app/components/hero-demo-data/index.ts` — SAMPLES metadata array
- `app/components/hero-demo-data/Hrbq66XqtCo.ts` — Jensen × Dwarkesh data
- `app/components/hero-demo-data/nm1TxQj9IsQ.ts` — Huberman Sleep data
- `app/components/hero-demo-data/Mde2q7GFCrw.ts` — Lex × Yuval Harari data
- `app/components/hero-demo-data/csA9YhzYvmk.ts` — Mo Gawdat data
- `app/components/hero-demo-data/BWJ4vnXIvts.ts` — Robert Greene data
- `smoke-tests/e2e-hero-demo.spec.ts` — Playwright e2e
- `scripts/build-hero-demo-data.ts` — one-shot data lifter (run once, generates the 5 data files from `/tmp/yt-demo-data/all.json`; checked in for future regeneration)

**Modified**
- `lib/hooks/useYouTubeSummarizer.ts` — replace inline anon-session block with `useAnonSession()`
- `app/summary/components/summary-content.tsx` — import markdown components from extracted module
- `app/summary/components/chat-tab.tsx` — accept optional `className` prop
- `app/page.tsx` — render HeroDemo, move "Or try your own video" heading + InputForm below it

---

## Task 1: Extract `useAnonSession` hook

**Files:**
- Create: `lib/hooks/useAnonSession.ts`
- Create: `lib/hooks/__tests__/useAnonSession.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// lib/hooks/__tests__/useAnonSession.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAnonSession } from "../useAnonSession";

const mockSignInAnonymously = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInAnonymously: mockSignInAnonymously,
      getSession: mockGetSession,
    },
  }),
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ session: null, user: null }),
}));

describe("useAnonSession", () => {
  beforeEach(() => {
    mockSignInAnonymously.mockReset();
    mockGetSession.mockReset();
  });

  it("calls signInAnonymously when no existing session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "anon-token" } },
      error: null,
    });

    const { result } = renderHook(() => useAnonSession());

    await waitFor(() => {
      expect(result.current.anonSession?.access_token).toBe("anon-token");
    });
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("reuses existing anonymous session without calling signInAnonymously", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "existing-token" } },
    });

    const { result } = renderHook(() => useAnonSession());

    await waitFor(() => {
      expect(result.current.anonSession?.access_token).toBe("existing-token");
    });
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("logs and stays unauthenticated when sign-in errors", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAnonSession());

    await waitFor(() => {
      expect(errSpy).toHaveBeenCalled();
    });
    expect(result.current.anonSession).toBeNull();
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test lib/hooks/__tests__/useAnonSession.test.tsx
```
Expected: FAIL — module `../useAnonSession` not found.

- [ ] **Step 3: Read the existing implementation in useYouTubeSummarizer**

Open `lib/hooks/useYouTubeSummarizer.ts` lines 1–70 and note:
- The existing `useAuth` import path
- The existing `createClient` import path (probably `@/lib/supabase/client`)
- The `debugLog` helper used inside the effect

Use the same imports in the new hook so behavior is identical.

- [ ] **Step 4: Write the hook**

```ts
// lib/hooks/useAnonSession.ts
"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";

const debugLog =
  process.env.NEXT_PUBLIC_DEBUG === "true"
    ? (...args: unknown[]) => console.log("[useAnonSession]", ...args)
    : () => {};

/**
 * Bootstraps a Supabase anonymous session for unauthenticated callers.
 *
 * The flow:
 *   1. If the user is already signed in (real session), do nothing.
 *   2. If a Supabase session already exists in storage, reuse it.
 *   3. Otherwise call `signInAnonymously()` and stash the resulting session.
 *
 * Returns the access token so callers can authenticate fetches against
 * routes that require a Supabase user (chat, summarize). The token is
 * `null` until the effect resolves.
 *
 * Extracted from the original inline block in `useYouTubeSummarizer` so
 * the hero demo widget on `/` can authenticate `<ChatTab>` without
 * mounting the full summarizer hook.
 */
export function useAnonSession(): { anonSession: Session | null } {
  const { session } = useAuth();
  const [anonSession, setAnonSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (session || anonSession || isLoading) return;

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        if (cancelled) return;

        if (sessionData?.session) {
          debugLog("Using existing anonymous session");
          setAnonSession(sessionData.session);
          return;
        }

        debugLog("Signing in anonymously");
        const { data, error } = await supabase.auth.signInAnonymously();
        if (cancelled) return;

        if (error) {
          console.error("Anonymous sign-in error:", error);
          return;
        }
        if (data?.session) {
          debugLog("Anonymous sign-in successful");
          setAnonSession(data.session);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Error during anonymous authentication:", err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, anonSession, isLoading]);

  return { anonSession };
}
```

- [ ] **Step 5: Run test to verify it passes**

```
pnpm test lib/hooks/__tests__/useAnonSession.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 6: Replace the inline block in useYouTubeSummarizer**

Open `lib/hooks/useYouTubeSummarizer.ts`. Currently lines 31–70 hold the inline anon-session bootstrap. Replace them with a call to the new hook. The diff:

```ts
// Before (lines 31–70):
const [anonSession, setAnonSession] = useState<{...}>(null);
const [isLoading, setIsLoading] = useState<boolean>(false);
useEffect(() => { /* anon-session bootstrap */ }, [...]);

// After:
const { anonSession } = useAnonSession();
```

Add the import at the top:
```ts
import { useAnonSession } from "@/lib/hooks/useAnonSession";
```

Remove now-unused imports (`Session` if it was only used for the local state, etc.) — let TypeScript guide you. The variable name `anonSession` is preserved so downstream code (`accessToken = session?.access_token || anonSession?.access_token`) continues to work.

- [ ] **Step 7: Run all hook tests to verify no regression**

```
pnpm test lib/hooks/__tests__/
```
Expected: all existing tests still pass (`useChatStream`, `useEntitlements`, `useYouTubeSummarizer`, plus the new `useAnonSession`).

- [ ] **Step 8: Commit**

```bash
git add lib/hooks/useAnonSession.ts lib/hooks/__tests__/useAnonSession.test.tsx lib/hooks/useYouTubeSummarizer.ts
git commit -m "$(cat <<'EOF'
refactor(hooks): extract useAnonSession from useYouTubeSummarizer

The hero demo widget on / needs a Supabase anonymous session so the
embedded chat can authenticate, but it doesn't mount the summarizer
hook. Lift the existing inline anon-session bootstrap into a reusable
hook with no behavior change for /summary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract `SummaryMarkdownComponents` map

**Files:**
- Create: `app/summary/components/summary-markdown-renderer.tsx`
- Create: `app/summary/components/__tests__/summary-markdown-renderer.test.tsx`
- Modify: `app/summary/components/summary-content.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/summary/components/__tests__/summary-markdown-renderer.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildSummaryMarkdownComponents } from "../summary-markdown-renderer";

describe("buildSummaryMarkdownComponents", () => {
  it("renders h2 with brand-secondary token", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"## Hello"}
      </ReactMarkdown>
    );
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2).toHaveClass("text-accent-brand-secondary");
  });

  it("renders strong with brand-secondary token", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"**bold**"}
      </ReactMarkdown>
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("bold")).toHaveClass("text-accent-brand-secondary");
  });

  it("renders blockquote with accent-brand border in light mode", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"> quoted"}
      </ReactMarkdown>
    );
    const blockquote = container.querySelector("blockquote");
    expect(blockquote).toHaveClass("border-accent-brand");
    expect(blockquote).toHaveClass("text-slate-800");
  });

  it("switches paragraph text color in dark mode", () => {
    const components = buildSummaryMarkdownComponents({ isDark: true });
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"text"}
      </ReactMarkdown>
    );
    const p = container.querySelector("p");
    expect(p).toHaveClass("text-white");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test app/summary/components/__tests__/summary-markdown-renderer.test.tsx
```
Expected: FAIL — module `../summary-markdown-renderer` not found.

- [ ] **Step 3: Create the renderer module**

Lift `app/summary/components/summary-content.tsx` lines 140–235 (the `components={…}` object literal) into a new module that returns the map as a function of `{ isDark }`. The function form preserves the dark-mode branching that's interleaved with the styling.

```tsx
// app/summary/components/summary-markdown-renderer.tsx
"use client";

import type { Components } from "react-markdown";

interface RendererOptions {
  isDark: boolean;
}

/**
 * Brand-token markdown component map used by the AI-generated video
 * summary (long-form) wherever it renders. Centralised so the hero
 * demo widget on / and the full summary card on /summary share exactly
 * one styling source.
 *
 * Why a function: the light/dark conditionals are interleaved with
 * structure (e.g. h1 border + body text colour), so a function of
 * `isDark` is cleaner than parameterising every call site with a CSS
 * variable. Token usage stays semantic everywhere it doesn't depend
 * on `isDark`.
 */
export function buildSummaryMarkdownComponents(
  opts: RendererOptions
): Components {
  const { isDark } = opts;
  return {
    h1: ({ children }) => (
      <h1
        className={`text-xl font-bold border-accent-brand-secondary/30 ${
          isDark ? "text-white" : "text-slate-900"
        } border-b pb-2 mb-4`}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-lg font-semibold text-accent-brand-secondary mt-6 mb-3">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-base font-medium text-accent-brand mt-4 mb-2">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p
        className={`${
          isDark ? "text-white" : "text-slate-800"
        } leading-relaxed mb-4 text-base`}
      >
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul
        className={`list-disc list-inside space-y-2 ${
          isDark ? "text-white" : "text-slate-800"
        } mb-4 ml-4`}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol
        className={`list-decimal list-inside space-y-2 ${
          isDark ? "text-white" : "text-slate-800"
        } mb-4 ml-4`}
      >
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li
        className={`${
          isDark ? "text-white" : "text-slate-800"
        } leading-relaxed`}
      >
        {children}
      </li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-accent-brand-secondary">
        {children}
      </strong>
    ),
    em: ({ children }) => (
      <em className="italic text-accent-brand-secondary">{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={`border-l-4 border-accent-brand pl-4 italic bg-accent-brand/10 ${
          isDark ? "text-white" : "text-slate-800"
        } py-2 rounded-r-lg`}
      >
        {children}
      </blockquote>
    ),
    code: ({ children }) => (
      <code
        className={`${
          isDark ? "bg-slate-700" : "bg-slate-100"
        } text-accent-brand-secondary px-2 py-1 rounded text-sm font-mono`}
      >
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre
        className={`${
          isDark
            ? "bg-slate-900 text-white border-slate-600"
            : "bg-slate-100 text-slate-800 border-slate-300"
        } p-4 rounded-lg overflow-x-auto border`}
      >
        {children}
      </pre>
    ),
  };
}
```

- [ ] **Step 4: Run new test to verify it passes**

```
pnpm test app/summary/components/__tests__/summary-markdown-renderer.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: Update summary-content.tsx to consume the extracted module**

In `app/summary/components/summary-content.tsx`:

1. Add import at top: `import { buildSummaryMarkdownComponents } from "./summary-markdown-renderer";`
2. Inside the component (after `const isDark = resolvedTheme === "dark";`), add: `const components = buildSummaryMarkdownComponents({ isDark });`
3. Replace `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ /* ~95 lines of object literal */ }}>...` with:

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
  {summary.summary}
</ReactMarkdown>
```

The object literal previously inline at lines 141–236 is now gone — only the call to `buildSummaryMarkdownComponents` remains. The file shrinks ~90 lines.

- [ ] **Step 6: Run existing summary-content tests to verify no regression**

```
pnpm test app/summary/components/__tests__/summary-content.theme.test.tsx
```
Expected: PASS (existing snapshot-style theme tests still match).

- [ ] **Step 7: Run all summary tests as a sanity check**

```
pnpm test app/summary/
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add app/summary/components/summary-markdown-renderer.tsx app/summary/components/__tests__/summary-markdown-renderer.test.tsx app/summary/components/summary-content.tsx
git commit -m "$(cat <<'EOF'
refactor(summary): extract markdown components map for reuse

Lifts the brand-token ReactMarkdown component map out of
SummaryContent into a standalone module so the upcoming hero demo
widget can render summary markdown with identical styling. Pure
refactor — existing /summary snapshots and theme tests pass
unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `className` prop to `<ChatTab>`

**Files:**
- Modify: `app/summary/components/chat-tab.tsx`
- Modify: `app/summary/components/__tests__/chat-tab.test.tsx`

- [ ] **Step 1: Write a failing test that asserts the prop is honoured**

Append to `app/summary/components/__tests__/chat-tab.test.tsx`:

```tsx
import { ChatTab } from "../chat-tab";
// (assume render helpers, mocks, and other setup are already at the top
// of the existing file from prior tests)

describe("ChatTab className prop", () => {
  it("merges a custom className onto the outer container", () => {
    const { container } = renderChatTabWithMocks(
      <ChatTab youtubeUrl={null} active={false} className="h-[480px] custom-cls" />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("h-[480px]");
    expect(root.className).toContain("custom-cls");
    // Existing structural classes still present
    expect(root.className).toContain("flex");
    expect(root.className).toContain("flex-col");
  });
});
```

If the existing test file lacks a `renderChatTabWithMocks` helper, define a small one inline that wraps `render(<ChatTab .../>)` after mocking the four hooks (`useChatStream`, `useChatThread`, `useChatSuggestions`, `useEntitlements`) the same way the existing tests do.

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test app/summary/components/__tests__/chat-tab.test.tsx -t "className prop"
```
Expected: FAIL — `Property 'className' does not exist on type 'IntrinsicAttributes & ChatTabProps'` (TypeScript surfaces this during the test compile).

- [ ] **Step 3: Add the prop to the component**

Edit `app/summary/components/chat-tab.tsx`:

1. Add `className?: string;` to the `ChatTabProps` interface.
2. Destructure it in the component arguments.
3. Merge onto the outer wrapper div via `cn()` (or template literal if `cn` isn't imported here):

```tsx
// Before:
return (
  <div className="flex h-[640px] flex-col rounded-lg border border-border-default bg-surface-base">

// After:
return (
  <div
    className={cn(
      "flex h-[640px] flex-col rounded-lg border border-border-default bg-surface-base",
      className
    )}
  >
```

If `cn` is the project utility (check `lib/utils.ts`), use it. Otherwise import from `clsx` / `class-variance-authority` whichever the rest of the file uses.

The default `h-[640px]` stays as the fallback. Callers that pass a className with their own height override (e.g. `"h-[480px] lg:h-[560px]"`) win because Tailwind's last-class-wins rule.

- [ ] **Step 4: Run test to verify it passes**

```
pnpm test app/summary/components/__tests__/chat-tab.test.tsx
```
Expected: all chat-tab tests PASS, including the new one.

- [ ] **Step 5: Commit**

```bash
git add app/summary/components/chat-tab.tsx app/summary/components/__tests__/chat-tab.test.tsx
git commit -m "$(cat <<'EOF'
feat(chat-tab): accept optional className prop

Prepares ChatTab for reuse in the hero demo widget where the column
needs a different height than /summary's hardcoded 640px. No behavior
change for existing callers — they pass no className and the
fallback wins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Generate per-video sample data files

**Files:**
- Create: `scripts/build-hero-demo-data.ts`
- Create: `app/components/hero-demo-data/Hrbq66XqtCo.ts`
- Create: `app/components/hero-demo-data/nm1TxQj9IsQ.ts`
- Create: `app/components/hero-demo-data/Mde2q7GFCrw.ts`
- Create: `app/components/hero-demo-data/csA9YhzYvmk.ts`
- Create: `app/components/hero-demo-data/BWJ4vnXIvts.ts`

- [ ] **Step 1: Confirm captured data file exists**

```bash
ls -la /tmp/yt-demo-data/all.json
```
Expected: 1.2MB file present (lifted from Supabase during the design phase).

If missing, regenerate by running the SQL query from the spec (`SELECT v.youtube_url, v.title, v.channel_name, v.language, s.summary, s.transcribe_time_seconds, s.summarize_time_seconds, s.model, vt.segments, ((vt.segments->-1->>'start')::numeric + (vt.segments->-1->>'duration')::numeric)::int AS computed_duration_sec FROM videos v JOIN summaries s ON s.video_id = v.id LEFT JOIN video_transcripts vt ON vt.video_id = v.id WHERE v.youtube_url ~ 'Hrbq66XqtCo|nm1TxQj9IsQ|Mde2q7GFCrw|csA9YhzYvmk|BWJ4vnXIvts'`) via Supabase MCP and write to `/tmp/yt-demo-data/all.json`.

- [ ] **Step 2: Define the shared data shape**

Write the per-video shape that data files must export. We'll put the type in `index.ts` (Task 5) and reference it here. For now define the inline contract:

```ts
// each per-video file exports default of this shape:
interface SampleData {
  readonly id: string;
  readonly summary: string;
  readonly segments: ReadonlyArray<{ text: string; start: number; duration: number }>;
  readonly model: string;
}
```

- [ ] **Step 3: Write the data builder script**

```ts
// scripts/build-hero-demo-data.ts
/**
 * One-shot script: lifts the captured /tmp/yt-demo-data/all.json (DB
 * snapshot of 5 cached video summaries + transcript segments) into
 * typed per-video TypeScript modules under app/components/hero-demo-data/.
 *
 * Run on demand to refresh demo data when the cached summaries drift:
 *   pnpm tsx scripts/build-hero-demo-data.ts
 *
 * Re-running overwrites the per-video files. Index file (index.ts) is
 * NOT regenerated — that's hand-curated.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const VIDEO_IDS = [
  "Hrbq66XqtCo",
  "nm1TxQj9IsQ",
  "Mde2q7GFCrw",
  "csA9YhzYvmk",
  "BWJ4vnXIvts",
] as const;

const SEGMENT_LIMIT = 30; // Truncate to keep per-file payload small

interface CapturedRecord {
  youtubeId: string;
  youtubeUrl: string;
  title: string;
  channel: string;
  durationSec: number;
  summary: string;
  segments: Array<{ text: string; start: number; duration: number }>;
  model: string;
}

async function main() {
  const raw = await readFile("/tmp/yt-demo-data/all.json", "utf8");
  const data = JSON.parse(raw) as Record<string, CapturedRecord>;
  const outDir = "app/components/hero-demo-data";
  await mkdir(outDir, { recursive: true });

  for (const id of VIDEO_IDS) {
    const r = data[id];
    if (!r) throw new Error(`Missing captured data for ${id}`);

    const truncated = r.segments.slice(0, SEGMENT_LIMIT);

    const file = `// AUTO-GENERATED by scripts/build-hero-demo-data.ts. Do not edit by hand.
// Re-run \`pnpm tsx scripts/build-hero-demo-data.ts\` to refresh.

import type { SampleData } from "./index";

const data: SampleData = {
  id: ${JSON.stringify(id)},
  summary: ${JSON.stringify(r.summary)},
  segments: ${JSON.stringify(truncated)},
  model: ${JSON.stringify(r.model)},
};

export default data;
`;
    await writeFile(join(outDir, `${id}.ts`), file, "utf8");
    console.log(`wrote ${outDir}/${id}.ts (${file.length.toLocaleString()} chars)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the script**

```bash
pnpm tsx scripts/build-hero-demo-data.ts
```
Expected output:
```
wrote app/components/hero-demo-data/Hrbq66XqtCo.ts (~12,000 chars)
wrote app/components/hero-demo-data/nm1TxQj9IsQ.ts (~7,000 chars)
wrote app/components/hero-demo-data/Mde2q7GFCrw.ts (~13,000 chars)
wrote app/components/hero-demo-data/csA9YhzYvmk.ts (~14,000 chars)
wrote app/components/hero-demo-data/BWJ4vnXIvts.ts (~8,000 chars)
```

If `pnpm tsx` is not the right invocation in this repo, check `package.json` scripts and adapt (likely `pnpm tsx ...` or `pnpm dlx tsx ...`).

- [ ] **Step 5: Spot-check one generated file**

```bash
head -5 app/components/hero-demo-data/Hrbq66XqtCo.ts
```
Expected: an `// AUTO-GENERATED` banner, an import of `SampleData` from `./index`, and a `default` export. The first segment text should be a sentence about Nvidia/electrons (matches the captured Jensen content).

- [ ] **Step 6: Commit**

```bash
git add scripts/build-hero-demo-data.ts app/components/hero-demo-data/
git commit -m "$(cat <<'EOF'
feat(hero-demo): generate per-video sample data files

Lifts cached summaries + first 30 transcript segments for 5 sample
videos (Jensen × Dwarkesh, Huberman Sleep, Lex × Yuval Harari, Mo
Gawdat E101, Robert Greene 12 Laws of Power) into dynamically-
importable TS modules. Also adds the regeneration script for future
refreshes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build `hero-demo-data/index.ts`

**Files:**
- Create: `app/components/hero-demo-data/index.ts`

- [ ] **Step 1: Write the index file**

```ts
// app/components/hero-demo-data/index.ts
/**
 * Hero demo widget — sample registry. Each entry carries lightweight
 * metadata that ships with the homepage chunk; the heavy summary +
 * transcript data lives in the per-video modules and is dynamically
 * imported on first selection so we don't bloat homepage LCP.
 *
 * Adding a sample: cache it via /summary?url=..., then run
 * `pnpm tsx scripts/build-hero-demo-data.ts` to regenerate the per-
 * video file, then add a row here.
 */

export interface SampleData {
  readonly id: string;
  readonly summary: string;
  readonly segments: ReadonlyArray<{
    readonly text: string;
    readonly start: number;
    readonly duration: number;
  }>;
  readonly model: string;
}

export interface SampleMeta {
  readonly id: string;
  readonly youtubeUrl: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly thumbnailUrl: string;
  readonly loadFullData: () => Promise<SampleData>;
}

function ytThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

function ytUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  {
    id: "Hrbq66XqtCo",
    youtubeUrl: ytUrl("Hrbq66XqtCo"),
    title: "Jensen Huang – Will Nvidia's moat persist?",
    channel: "Dwarkesh Patel",
    durationSec: 6191,
    thumbnailUrl: ytThumb("Hrbq66XqtCo"),
    loadFullData: () => import("./Hrbq66XqtCo").then((m) => m.default),
  },
  {
    id: "nm1TxQj9IsQ",
    youtubeUrl: ytUrl("nm1TxQj9IsQ"),
    title: "Master Your Sleep & Be More Alert When Awake",
    channel: "Andrew Huberman",
    durationSec: 4923,
    thumbnailUrl: ytThumb("nm1TxQj9IsQ"),
    loadFullData: () => import("./nm1TxQj9IsQ").then((m) => m.default),
  },
  {
    id: "Mde2q7GFCrw",
    youtubeUrl: ytUrl("Mde2q7GFCrw"),
    title: "Yuval Noah Harari: Human Nature, Intelligence, Power & Conspiracies #390",
    channel: "Lex Fridman",
    durationSec: 9881,
    thumbnailUrl: ytThumb("Mde2q7GFCrw"),
    loadFullData: () => import("./Mde2q7GFCrw").then((m) => m.default),
  },
  {
    id: "csA9YhzYvmk",
    youtubeUrl: ytUrl("csA9YhzYvmk"),
    title: "The Happiness Expert That Made 51 Million People Happier: Mo Gawdat | E101",
    channel: "The Diary Of A CEO",
    durationSec: 7054,
    thumbnailUrl: ytThumb("csA9YhzYvmk"),
    loadFullData: () => import("./csA9YhzYvmk").then((m) => m.default),
  },
  {
    id: "BWJ4vnXIvts",
    youtubeUrl: ytUrl("BWJ4vnXIvts"),
    title: "12 Laws Of Power For Life — Robert Greene | Modern Wisdom Podcast 383",
    channel: "Chris Williamson",
    durationSec: 3930,
    thumbnailUrl: ytThumb("BWJ4vnXIvts"),
    loadFullData: () => import("./BWJ4vnXIvts").then((m) => m.default),
  },
];

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
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
pnpm tsc --noEmit
```
Expected: zero errors. The per-video files now resolve `SampleData` from this module.

- [ ] **Step 3: Commit**

```bash
git add app/components/hero-demo-data/index.ts
git commit -m "$(cat <<'EOF'
feat(hero-demo): add sample registry + duration formatters

Defines SampleMeta + SampleData types, the SAMPLES array, and
duration/timestamp formatters used by the hero demo widget. Each
sample's heavy data is wired through a dynamic-import lambda so
homepage LCP stays small.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Build `<HeroDemo>` skeleton + Col 1

**Files:**
- Create: `app/components/hero-demo.tsx`
- Create: `app/components/__tests__/hero-demo.test.tsx`

- [ ] **Step 1: Write a failing test for Col 1 carousel behavior**

```tsx
// app/components/__tests__/hero-demo.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HeroDemo from "../hero-demo";

vi.mock("@/lib/hooks/useAnonSession", () => ({
  useAnonSession: () => ({ anonSession: { access_token: "mock" } }),
}));

vi.mock("@/app/summary/components/chat-tab", () => ({
  ChatTab: ({ youtubeUrl }: { youtubeUrl: string | null }) => (
    <div data-testid="chat-tab" data-yturl={youtubeUrl} />
  ),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

describe("HeroDemo carousel", () => {
  it("renders sample 1 active by default", async () => {
    render(<HeroDemo />);
    await waitFor(() => {
      expect(screen.getByText(/Will Nvidia's moat persist/)).toBeInTheDocument();
    });
    const sample1Card = screen.getByRole("button", { name: /Will Nvidia's moat persist/ });
    expect(sample1Card).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking another sample updates aria-pressed and chat youtubeUrl", async () => {
    render(<HeroDemo />);
    const sample2 = await screen.findByRole("button", { name: /Master Your Sleep/ });
    fireEvent.click(sample2);
    await waitFor(() => {
      expect(sample2).toHaveAttribute("aria-pressed", "true");
    });
    const chat = screen.getByTestId("chat-tab");
    expect(chat).toHaveAttribute("data-yturl", "https://www.youtube.com/watch?v=nm1TxQj9IsQ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test app/components/__tests__/hero-demo.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the skeleton with Col 1 only (Col 2 + Col 3 stubbed)**

```tsx
// app/components/hero-demo.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChatTab } from "@/app/summary/components/chat-tab";
import { useAnonSession } from "@/lib/hooks/useAnonSession";
import { SAMPLES, formatDuration, type SampleData, type SampleMeta } from "./hero-demo-data";
import { usePostHog } from "posthog-js/react";

export default function HeroDemo() {
  // Bootstrap an anon Supabase session up-front so <ChatTab> can
  // authenticate against the live chat endpoint without the visitor
  // needing to mount /summary first.
  useAnonSession();
  const posthog = usePostHog();
  const [activeId, setActiveId] = useState<string>(SAMPLES[0].id);
  const [data, setData] = useState<SampleData | null>(null);
  const [fading, setFading] = useState(false);

  // Lazy-load the active sample's heavy data with a fade animation.
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === activeId);
    if (!sample) return;
    let cancelled = false;
    setFading(true);
    const t = setTimeout(() => {
      sample.loadFullData().then((d) => {
        if (cancelled) return;
        setData(d);
        setFading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeId]);

  const sample = SAMPLES.find((s) => s.id === activeId)!;

  const handleSelect = (s: SampleMeta) => {
    if (s.id === activeId) return;
    setActiveId(s.id);
    posthog?.capture("hero_demo_sample_selected", {
      sample_id: s.id,
      sample_title: s.title,
    });
  };

  return (
    <section className="mx-auto max-w-page px-4 mb-16 w-full">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr]">
        {/* Col 1 — Active video + carousel */}
        <div className="flex flex-col gap-4">
          <a
            href={sample.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block group relative overflow-hidden rounded-xl border border-border-subtle"
          >
            <div className="relative aspect-video bg-surface-sunken">
              <Image
                src={sample.thumbnailUrl}
                alt={`${sample.title} — thumbnail`}
                fill
                sizes="(min-width: 1024px) 30vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </div>
          </a>
          <div>
            <h3 className="text-h5 text-text-primary line-clamp-2">{sample.title}</h3>
            <p className="text-body-sm text-text-muted mt-1">
              {sample.channel} · {formatDuration(sample.durationSec)}
            </p>
          </div>
          <div
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin"
            role="listbox"
            aria-label="Sample videos"
          >
            {SAMPLES.map((s) => {
              const active = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={s.title}
                  onClick={() => handleSelect(s)}
                  className={`shrink-0 w-[120px] flex flex-col gap-1 rounded-lg p-1.5 border transition-colors ${
                    active
                      ? "border-accent-brand ring-2 ring-accent-brand/30"
                      : "border-border-subtle hover:border-border-default"
                  }`}
                >
                  <div className="relative w-full aspect-video rounded overflow-hidden bg-surface-sunken">
                    <Image
                      src={s.thumbnailUrl}
                      alt=""
                      fill
                      sizes="120px"
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
        </div>

        {/* Col 2 — placeholder (Task 7 fills this in) */}
        <div data-testid="hero-demo-col2" className={`${fading ? "opacity-0" : "opacity-100"} motion-safe:transition-opacity duration-base`}>
          {/* TODO Task 7 */}
          {data && <pre className="hidden">{data.id}</pre>}
        </div>

        {/* Col 3 — Chat */}
        <div>
          <ChatTab
            youtubeUrl={sample.youtubeUrl}
            active={true}
            className="h-[480px] lg:h-[560px]"
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add `next/image` config for ytimg.com if missing**

Open `next.config.ts` (or `.js`). If `i.ytimg.com` is not already in `images.remotePatterns`, add it:

```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "i.ytimg.com" },
    // ...existing
  ],
},
```

If the hostname is already there (the existing /summary YoutubeVideo component likely uses it), skip this step.

- [ ] **Step 5: Run test to verify it passes**

```
pnpm test app/components/__tests__/hero-demo.test.tsx
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app/components/hero-demo.tsx app/components/__tests__/hero-demo.test.tsx next.config.ts
git commit -m "$(cat <<'EOF'
feat(hero-demo): scaffold widget with active video + carousel

First slice of the hero demo widget: 3-column grid layout, Col 1
fully implemented (active thumbnail, click-through, title, channel,
duration, 5-card carousel with active state + aria-pressed),
ChatTab wired in Col 3 with custom height, Col 2 placeholder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Implement Col 2 (Summary + Transcript tabs)

**Files:**
- Modify: `app/components/hero-demo.tsx`
- Modify: `app/components/__tests__/hero-demo.test.tsx`

- [ ] **Step 1: Add a failing test for tab switch behavior**

Append to the test file:

```tsx
import { useTheme } from "next-themes";
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

describe("HeroDemo Col 2 tabs", () => {
  it("renders Summary tab by default with markdown", async () => {
    render(<HeroDemo />);
    await waitFor(() => {
      // The Jensen summary contains a TL;DR strong-tag that uses brand-secondary
      expect(screen.getByText(/Jensen Huang argues/)).toBeInTheDocument();
    });
  });

  it("switches to Transcript tab", async () => {
    render(<HeroDemo />);
    await waitFor(() => screen.getByText(/Jensen Huang argues/));
    const tab = screen.getByRole("tab", { name: /Transcript/i });
    fireEvent.click(tab);
    // First Jensen segment text from the captured snapshot
    await waitFor(() => {
      expect(screen.getAllByText(/0:00|0:01|0:02/)[0]).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test app/components/__tests__/hero-demo.test.tsx -t "Col 2"
```
Expected: FAIL — text not found.

- [ ] **Step 3: Implement Col 2**

In `app/components/hero-demo.tsx`:

1. Add imports at top:
```ts
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "next-themes";
import { buildSummaryMarkdownComponents } from "@/app/summary/components/summary-markdown-renderer";
import { formatTimestamp } from "./hero-demo-data";
```

2. Inside the component, add state and derived values:
```ts
const [tab, setTab] = useState<"summary" | "transcript">("summary");
const { resolvedTheme } = useTheme();
const markdownComponents = buildSummaryMarkdownComponents({
  isDark: resolvedTheme === "dark",
});
```

3. Replace the Col 2 placeholder with:

```tsx
<div className={`flex flex-col ${fading ? "opacity-0" : "opacity-100"} motion-safe:transition-opacity duration-base`}>
  <Tabs value={tab} onValueChange={(v) => setTab(v as "summary" | "transcript")}>
    <TabsList>
      <TabsTrigger value="summary">Summary</TabsTrigger>
      <TabsTrigger value="transcript">Transcript</TabsTrigger>
    </TabsList>
    <TabsContent value="summary">
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-6 max-h-[560px] overflow-auto">
        <div className="prose max-w-none dark:prose-invert">
          {data ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {data.summary}
            </ReactMarkdown>
          ) : (
            <SummarySkeleton />
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <a
            href={`/summary?url=${encodeURIComponent(sample.youtubeUrl)}`}
            className="text-body-sm text-accent-brand hover:underline"
          >
            View full summary on /summary →
          </a>
        </div>
      </div>
    </TabsContent>
    <TabsContent value="transcript">
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-4 max-h-[560px] overflow-auto">
        {data ? (
          <ul className="space-y-3">
            {data.segments.map((seg, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="shrink-0 inline-block bg-surface-sunken text-text-secondary text-caption font-mono rounded px-1.5 py-0.5 mt-0.5">
                  {formatTimestamp(seg.start)}
                </span>
                <span className="text-body-sm text-text-primary leading-relaxed">{seg.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <TranscriptSkeleton />
        )}
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <a
            href={`/summary?url=${encodeURIComponent(sample.youtubeUrl)}`}
            className="text-body-sm text-accent-brand hover:underline"
          >
            View full transcript on /summary →
          </a>
        </div>
      </div>
    </TabsContent>
  </Tabs>
</div>
```

4. Add small skeleton components at the bottom of the file:

```tsx
function SummarySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-surface-sunken rounded w-3/4" />
      <div className="h-4 bg-surface-sunken rounded w-full" />
      <div className="h-4 bg-surface-sunken rounded w-5/6" />
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-sunken rounded w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run all hero-demo tests**

```
pnpm test app/components/__tests__/hero-demo.test.tsx
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/hero-demo.tsx app/components/__tests__/hero-demo.test.tsx
git commit -m "$(cat <<'EOF'
feat(hero-demo): implement Col 2 Summary + Transcript tabs

Renders the active sample's cached markdown summary and first 30
transcript segments via Radix Tabs. Reuses the brand-token markdown
components map extracted in the prior commit so visuals match
/summary exactly. Skeleton placeholders cover the 250ms fade window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire HeroDemo into homepage (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update the home page render order**

Open `app/page.tsx`. Replace the body of `<main>` with:

```tsx
import dynamic from "next/dynamic";
// ...other existing imports

const HeroDemo = dynamic(() => import("./components/hero-demo"), {
  ssr: false,
  loading: () => (
    <section className="mx-auto max-w-page px-4 mb-16 w-full">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr] min-h-[480px]">
        <div className="bg-surface-sunken animate-pulse rounded-xl" />
        <div className="bg-surface-sunken animate-pulse rounded-xl" />
        <div className="bg-surface-sunken animate-pulse rounded-xl" />
      </div>
    </section>
  ),
});

export default function Home() {
  return (
    <main className="flex flex-col items-center px-4">
      <HeroSection />

      <HeroDemo />

      <section className="w-full max-w-6xl mx-auto mb-4 text-center">
        <h2 className="text-h4 text-text-primary mb-1">Or try your own video</h2>
        <p className="text-body-sm text-text-muted">
          Paste any YouTube URL — we'll summarize and let you chat with it.
        </p>
      </section>

      <AnonHomepageGate />

      <section className="w-full max-w-6xl mx-auto mb-16">
        <InputForm />
      </section>

      <Benefits />
      <UseCases />
      <HowItWorks />
      <Testimonials />
      <FAQ />
      <FaqJsonLd />
      <JsonLd id="structured-data-howto" data={buildHowToSchema()} />
    </main>
  );
}
```

The dynamic import ensures the heavy chat code splits out of the initial homepage chunk. The skeleton matches the eventual widget's grid layout so the page doesn't shift when it hydrates.

- [ ] **Step 2: Run page tests if any exist**

```
pnpm test app/__tests__/ app/components/__tests__/anon-homepage-gate.test.tsx
```
Expected: PASS or N/A (no page-level test for the marketing home).

- [ ] **Step 3: Lint**

```
pnpm lint
```
Expected: no errors. Fix any new ones before committing (most likely sourceImport ordering).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): mount HeroDemo widget above InputForm

Adds the new interactive demo widget between the marketing hero and
the paste-URL form. Dynamic-imported with a layout-stable skeleton
to keep initial homepage chunk small. The InputForm and
AnonHomepageGate stay below as the existing anon-summarize path; an
"Or try your own video" heading frames them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Playwright e2e

**Files:**
- Create: `smoke-tests/e2e-hero-demo.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```ts
// smoke-tests/e2e-hero-demo.spec.ts
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * Hero demo widget e2e — runs against `pnpm dev` on :3000 by default,
 * or whatever BASE_URL points to (e.g. a Vercel preview).
 *
 * The widget needs Supabase production-anon-sign-in to work, which
 * requires running against an env that has Supabase configured.
 * Local dev with `.env.local` does have that, so this test can run
 * locally without auth.
 */
test.describe("Hero demo widget", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("renders sample 1 and switches to sample 2", async ({ page }) => {
    await page.goto(BASE_URL + "/");

    // The dynamic-imported widget mounts after first paint; wait for
    // the active sample title to appear (Jensen by default).
    await expect(
      page.getByRole("heading", { name: /Will Nvidia's moat persist/ })
    ).toBeVisible({ timeout: 30_000 });

    // The summary's TL;DR sentence is in the Col 2 markdown
    await expect(page.getByText(/Jensen Huang argues/)).toBeVisible();

    // Click sample 2 (Huberman Sleep)
    await page.getByRole("button", { name: /Master Your Sleep/ }).click();

    // Active title in Col 1 swaps
    await expect(
      page.getByRole("heading", { name: /Master Your Sleep/ })
    ).toBeVisible({ timeout: 5_000 });

    // Col 2 swaps — the Huberman summary mentions "circadian"
    await expect(page.getByText(/circadian/i).first()).toBeVisible();
  });

  test("switches to Transcript tab and shows timestamp pills", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    await expect(
      page.getByRole("heading", { name: /Will Nvidia's moat persist/ })
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: /Transcript/ }).click();

    // Look for an mm:ss formatted timestamp
    await expect(page.getByText(/^\d{1,2}:\d{2}$/).first()).toBeVisible();
  });

  test("InputForm still rendered below the widget", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    await expect(
      page.getByRole("heading", { name: /Will Nvidia's moat persist/ })
    ).toBeVisible({ timeout: 30_000 });

    // The "Or try your own video" framing
    await expect(page.getByRole("heading", { name: /Or try your own video/ })).toBeVisible();

    // The input itself
    await expect(page.getByPlaceholder(/Enter YouTube URL here/)).toBeVisible();
  });
});
```

The chat-streaming assertion from the spec ("type a question, expect a streamed response with timestamp citation") is intentionally omitted from the spec for this PR because:
1. Streaming a real LLM reply mid-test costs API budget per CI run.
2. The chat path is already covered by existing chat-tab unit tests.

If you want chat streaming covered: add a fourth test guarded by `process.env.RUN_LLM_TESTS === "1"`.

- [ ] **Step 2: Run the e2e**

```bash
pnpm exec playwright test smoke-tests/e2e-hero-demo.spec.ts
```

Playwright will auto-start `pnpm dev` on :3000 (per the existing config). First run takes ~30s to compile the dev server. Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add smoke-tests/e2e-hero-demo.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): add Playwright spec for hero demo widget

Covers the three core flows: sample 1 renders by default, switching
samples updates Col 1 + Col 2 content, the InputForm fallback below
the widget is still functional. Anonymous browser context
(clearCookies in beforeEach) so logged-in /dashboard redirect
doesn't fire.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Pre-push gate

- [ ] **Step 1: Full lint**

```bash
pnpm lint
```
Expected: zero errors. Fix any.

- [ ] **Step 2: Full test suite**

```bash
pnpm test
```
Expected: all tests PASS.

- [ ] **Step 3: Type check**

```bash
pnpm tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Run e2e once more in clean env**

```bash
pnpm exec playwright test smoke-tests/e2e-hero-demo.spec.ts
```
Expected: 3 PASS.

If any step fails, fix it, commit the fix, and retry. If a step fails twice → halt and surface to the user (per ship-it skill).

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/hero-demo-widget
```

---

## Self-review checklist (before handing back to ship-it)

- [ ] Every spec section has at least one task implementing it
  - Decision 1 (reuse ChatTab) → Task 6 + 7
  - Decision 2 (extract markdown renderer) → Task 2
  - Decision 3 (extract useAnonSession) → Task 1
  - Decision 4 (className prop) → Task 3
  - Decision 5 (keep InputForm) → Task 8
  - Decision 6 (dynamic import) → Task 8
  - Decision 7 (per-video data files) → Task 4
  - Decision 8 (truncate transcript to 30 segments) → Task 4 (`SEGMENT_LIMIT = 30`)
  - Decision 9 (5 samples for v1) → Task 4 + Task 5
  - Decision 10 (PostHog event) → Task 6 (`hero_demo_sample_selected`)
- [ ] No "TODO/TBD/Add error handling" placeholders
- [ ] Type names consistent: `SampleData` and `SampleMeta` referenced consistently across Tasks 4 + 5 + 6
- [ ] Every test step has actual test code, not "write a test for X"
