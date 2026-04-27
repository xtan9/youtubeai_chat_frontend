# Frontend Test Coverage Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `youtubeai_chat_frontend` to a regression-catching test posture — Trophy pyramid, tier-by-tier mocking, surface checklist + low coverage floor — so the upcoming dependency modernization can land safely.

**Architecture:** Add coverage tooling and React-hook testing setup, then close the surface-list gaps from the spec in five logically grouped PRs (tooling → unit → integration → auth E2E → summary E2E). Each PR is independently reviewable, deployable, and revertable. CI runs `pnpm test --coverage` and fails on threshold drop.

**Tech Stack:** Vitest 4, `@vitest/coverage-v8` (new), `@testing-library/react` (new), `happy-dom` (new), Playwright 1, `@supabase/supabase-js` admin client, `vi.fn()` for fetch boundary mocking.

---

## File structure

**New files (tests + helpers):**
- `lib/hooks/__tests__/useClipboard.test.ts`
- `lib/hooks/__tests__/usePersistedUrl.test.ts`
- `lib/hooks/__tests__/useYouTubeSummarizer.test.ts`
- `lib/services/__tests__/models.test.ts`
- `lib/supabase/__tests__/middleware.test.ts`
- `smoke-tests/__tests__/admin-helpers.test.ts`
- `smoke-tests/e2e-auth-signup.spec.ts`
- `smoke-tests/e2e-auth-login.spec.ts`
- `smoke-tests/e2e-auth-password-reset.spec.ts`
- `smoke-tests/e2e-summary-cjk.spec.ts`
- `smoke-tests/e2e-summary-errors.spec.ts`
- `smoke-tests/e2e-summary-rate-limit.spec.ts`
- `smoke-tests/e2e-landing-to-summary.spec.ts`
- `CONTRIBUTING.md` (new at repo root)

**Modified files:**
- `package.json` — new devDeps
- `vitest.config.ts` — coverage block + happy-dom for hook test scope
- `.github/workflows/ci.yml` — `pnpm test --coverage` in test job
- `smoke-tests/helpers.ts` — admin-client helpers (signup/cleanup/recovery link); extended cred loader

**Out of scope for plan but flagged:** No expansion of `lib/services/__tests__/llm-client.test.ts` — Task 10 documents the audit finding (existing 33 cases already cover SSE chunk fragmentation, malformed chunks, abort, mid-stream failures, and env handling).

---

## Phase 0 — Tooling foundation (PR 1)

### Task 1: Add `@vitest/coverage-v8` and configure thresholds

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `vitest.config.ts`

- [ ] **Step 1.1: Install coverage provider**

```bash
pnpm add -D @vitest/coverage-v8@^4.1.4
```

Expected: `@vitest/coverage-v8` appears in `package.json` devDependencies; `pnpm-lock.yaml` updated.

- [ ] **Step 1.2: Update `vitest.config.ts` with coverage block**

Replace entire file with:

```ts
import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Playwright owns `smoke-tests/*.spec.ts`. Vitest still runs unit
    // tests nested in `smoke-tests/__tests__/*.test.ts` (helpers).
    exclude: [...configDefaults.exclude, "smoke-tests/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Floors are regression alarms, NOT targets. If they fire on an
      // unrelated PR, lower the floor or expand exclusions; do not write
      // filler tests to clear the gate.
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 50,
        statements: 50,
      },
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "components/ui/**",
        "app/**/page.tsx",
        "app/**/layout.tsx",
        "smoke-tests/**",
        ".next/**",
      ],
    },
  },
});
```

- [ ] **Step 1.3: Run coverage locally to verify wiring + capture baseline**

Run: `pnpm test --coverage`
Expected: vitest runs the existing suite, prints coverage table, reports a baseline %.
- If thresholds fail on the first run, the floors are too high. Lower lines/statements to a value 5 percentage points below the actual baseline (e.g. baseline 47% → set floor to 42%). Update `vitest.config.ts` and re-run.

- [ ] **Step 1.4: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "$(cat <<'EOF'
test: add v8 coverage with low floor as regression alarm

Provider + thresholds (lines 50 / branches 40 / functions 50 /
statements 50). Excludes shadcn primitives and route/layout files since
those are covered by E2E. Thresholds are alarms, not targets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add React hook testing tooling

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 2.1: Install testing library + DOM env**

```bash
pnpm add -D @testing-library/react@^16.1.0 happy-dom@^15.11.7
```

Expected: two packages added; `pnpm-lock.yaml` updated.

- [ ] **Step 2.2: Smoke-check imports load**

Run:
```bash
pnpm exec node -e "import('@testing-library/react').then(m => console.log(typeof m.renderHook))"
```

Expected: prints `function`. Confirms the package resolves.

- [ ] **Step 2.3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
test: add testing-library/react + happy-dom for hook testing

renderHook + happy-dom let us cover useClipboard, usePersistedUrl, and
useYouTubeSummarizer without booting a browser. Per-test environment
pragma keeps existing Node-env tests untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `pnpm test --coverage` into CI

**Files:**
- Modify: `.github/workflows/ci.yml` (test job)

- [ ] **Step 3.1: Replace `pnpm test` with `pnpm test --coverage` in test job**

Find the `test:` job in `.github/workflows/ci.yml` and change its final step from `- run: pnpm test` to `- run: pnpm test --coverage`. Leave lint, typecheck, and build jobs untouched.

- [ ] **Step 3.2: Verify locally that the modified workflow still parses**

Run:
```bash
pnpm exec js-yaml .github/workflows/ci.yml > /dev/null && echo "yaml ok"
```

Expected: prints `yaml ok`. (`js-yaml` ships with vitest's tree.) If `js-yaml` is unavailable, fall back to `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "yaml ok"`.

- [ ] **Step 3.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: gate test job on coverage thresholds

Vitest fails the run when floors drop, so a PR that deletes tests or
introduces large untested code paths can't merge silently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add CONTRIBUTING.md test policy

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 4.1: Write `CONTRIBUTING.md`**

Create `CONTRIBUTING.md` with this content:

```markdown
# Contributing to youtubeai_chat_frontend

## Testing

We use a Testing Trophy: heavy E2E + integration, thin unit layer for pure logic.

### What test goes where

| Change you're making | Required test | Where |
|---|---|---|
| New API route under `app/api/**` | Integration test (real handler, real Zod, mocked `globalThis.fetch` via `vi.fn()`) | `app/api/<route>/__tests__/route.test.ts` |
| New `lib/services/*` module | Integration test if it composes other modules; unit test if pure | `lib/services/__tests__/<name>.test.ts` |
| New `lib/hooks/*` with state or side-effects | Unit test (renderHook, happy-dom env) | `lib/hooks/__tests__/<name>.test.ts` |
| New user-visible flow (anything routable a user reaches) | E2E spec | `smoke-tests/e2e-<name>.spec.ts` |
| New `components/*` (non-`ui/`) component with non-trivial logic | Optional unit test; rely on E2E for the flow | colocated `__tests__/` |
| Bug fix | Regression test at the lowest tier that exercises the fix | as above |

### Running tests

```bash
pnpm test               # vitest unit + integration
pnpm test --coverage    # with coverage gate (matches CI)
pnpm test:watch         # interactive
pnpm smoke:api          # production API smoke (Node script)
pnpm smoke:e2e          # Playwright E2E
```

### Coverage policy

CI enforces a floor (currently 50% lines / 40% branches / 50% functions / 50% statements). The floor is a *regression alarm*, not a target. If it fires on a PR that legitimately should not be raising coverage, lower the floor or expand exclusions in `vitest.config.ts` — do not write filler tests.

### Mocking altitude

- **E2E** (Playwright): real Supabase auth, real VPS, real LLM on the happy path. Use `page.route()` only to simulate network failures the real stack cannot reliably reproduce.
- **Integration** (Vitest): real route handlers, real Zod schemas, real composition. Mock at the `fetch` boundary using `vi.stubGlobal("fetch", vi.fn())`. Mock the Supabase admin client when used.
- **Unit** (Vitest): pure logic only. Mock everything else.
```

- [ ] **Step 4.2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "$(cat <<'EOF'
docs: codify testing policy in CONTRIBUTING.md

Trophy pyramid + tier-by-tier mocking + surface-driven what-to-test
table. Anchors the coverage gate as an alarm, not a target.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Open PR 1 (tooling)

- [ ] **Step 5.1: Push branch and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "test: coverage tooling + test policy (A0 PR 1/5)" --body "$(cat <<'EOF'
## Summary

First of five PRs implementing the A0 test-coverage hardening spec
(\`docs/superpowers/specs/2026-04-26-frontend-test-coverage-hardening-design.md\`).

This PR adds the foundation: coverage tooling, hook-testing tooling, CI
gate, and \`CONTRIBUTING.md\` test policy. No new test files yet —
those land in follow-up PRs (one per tier).

## Test plan

- [ ] \`pnpm test --coverage\` passes locally
- [ ] CI passes (lint, typecheck, test+coverage, build)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5.2: Wait for CI and merge after review**

After CI green and approval: squash-merge.

---

## Phase 1 — Unit tests (PR 2)

### Task 6: `lib/hooks/__tests__/useClipboard.test.ts`

**Files:**
- Create: `lib/hooks/__tests__/useClipboard.test.ts`

- [ ] **Step 6.1: Write the test file**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClipboard } from "../useClipboard";

describe("useClipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with copied=false", () => {
    const { result } = renderHook(() => useClipboard());
    expect(result.current.copied).toBe(false);
  });

  it("writes text to clipboard and flips copied to true", async () => {
    const { result } = renderHook(() => useClipboard());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.copyToClipboard("hello");
    });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(returned).toBe(true);
    expect(result.current.copied).toBe(true);
  });

  it("auto-resets copied to false after 2s", async () => {
    const { result } = renderHook(() => useClipboard());
    await act(async () => {
      await result.current.copyToClipboard("hello");
    });
    expect(result.current.copied).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("returns false and leaves copied=false when clipboard write rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useClipboard());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.copyToClipboard("hello");
    });
    expect(returned).toBe(false);
    expect(result.current.copied).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      "Failed to copy:",
      expect.any(Error)
    );
  });
});
```

- [ ] **Step 6.2: Run test, verify pass**

Run: `pnpm test lib/hooks/__tests__/useClipboard.test.ts`
Expected: 4 tests pass.

---

### Task 7: `lib/hooks/__tests__/usePersistedUrl.test.ts`

**Files:**
- Create: `lib/hooks/__tests__/usePersistedUrl.test.ts`

- [ ] **Step 7.1: Write the test file**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePersistedUrl } from "../usePersistedUrl";

const KEY = "pending-youtube-data";

describe("usePersistedUrl", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts unhydrated and hydrates with null when storage is empty", async () => {
    const { result } = renderHook(() => usePersistedUrl());
    // First render: not yet hydrated -> pendingUrl masked to null
    expect(result.current.pendingUrl).toBeNull();
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.pendingUrl).toBeNull();
  });

  it("hydrates with the stored URL when present", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ url: "https://youtu.be/abc" })
    );
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.pendingUrl).toBe("https://youtu.be/abc");
  });

  it("savePendingUrl writes to localStorage and updates state", async () => {
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.savePendingUrl("https://youtu.be/xyz");
    });
    expect(result.current.pendingUrl).toBe("https://youtu.be/xyz");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      url: "https://youtu.be/xyz",
    });
  });

  it("clearPendingUrl removes the entry and nulls state", async () => {
    localStorage.setItem(KEY, JSON.stringify({ url: "https://youtu.be/abc" }));
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.clearPendingUrl();
    });
    expect(result.current.pendingUrl).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("logs and continues when stored value is malformed JSON", async () => {
    localStorage.setItem(KEY, "not-json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.pendingUrl).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      "Error reading from localStorage:",
      expect.any(Error)
    );
  });

  it("logs and continues when localStorage.setItem throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.savePendingUrl("https://youtu.be/xyz");
    });
    // In-memory state still updates so the UI isn't blocked
    expect(result.current.pendingUrl).toBe("https://youtu.be/xyz");
    expect(errSpy).toHaveBeenCalledWith(
      "Error saving to localStorage:",
      expect.any(Error)
    );
    setItemSpy.mockRestore();
  });
});
```

- [ ] **Step 7.2: Run test, verify pass**

Run: `pnpm test lib/hooks/__tests__/usePersistedUrl.test.ts`
Expected: 6 tests pass.

---

### Task 8: `lib/hooks/__tests__/useYouTubeSummarizer.test.ts`

The hook depends on `useUser()` from `@/lib/contexts/user-context` and `useRouter()` from `next/navigation`, plus `createClient()` from `@/lib/supabase/client`. Mock all three at module scope. Wrap the hook in a `QueryClientProvider` because it uses `@tanstack/react-query`.

**Files:**
- Create: `lib/hooks/__tests__/useYouTubeSummarizer.test.ts`

- [ ] **Step 8.1: Write the test file**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockPush = vi.fn();
const mockGetSession = vi.fn();
const mockSignInAnonymously = vi.fn();
let mockUserCtx: { user: unknown; session: { access_token: string } | null };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => mockUserCtx,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      signInAnonymously: mockSignInAnonymously,
    },
  }),
}));

import { useYouTubeSummarizer } from "../useYouTubeSummarizer";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function sseStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200 });
}

describe("useYouTubeSummarizer", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetSession.mockReset();
    mockSignInAnonymously.mockReset();
    mockUserCtx = { user: null, session: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provisions an anonymous session when user is logged out and none exists", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "anon-token" } },
      error: null,
    });
    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isAnonymous).toBe(true));
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing anonymous session without re-signing", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "existing-anon" } },
    });
    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isAnonymous).toBe(true));
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("does not provision an anonymous session when a user session exists", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));
    expect(result.current.isAnonymous).toBe(false);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("query is disabled by default (does not fire on mount)", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useYouTubeSummarizer("https://youtu.be/x"), {
      wrapper: makeWrapper(),
    });
    // Give react-query a microtask tick
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to /api/summarize/stream with bearer token and yields streamed summary", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseStream(["partial-1 ", "partial-2"]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x", true, null),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.summarizationQuery.refetch();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/summarize/stream");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-token"
    );
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      youtube_url: "https://youtu.be/x",
      include_transcript: true,
      // outputLanguage=null must NOT serialize the field
    });

    const data = result.current.summarizationQuery.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data!.at(-1)?.summary).toBe("partial-1 partial-2");
  });

  it("includes output_language in body only when provided", async () => {
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseStream(["x"]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x", true, "es"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.summarizationQuery.refetch();
    });

    const body = JSON.parse(
      fetchMock.mock.calls[0][1].body as string
    );
    expect(body.output_language).toBe("es");
  });

  it("throws if no auth token is available when fetch starts", async () => {
    // No user session, anonymous resolution returns null
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    // Wait for anon-resolution attempt to settle
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
      expect(r.error?.message).toMatch(/No authentication available/);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects to /auth/login on 401 for an authenticated user", async () => {
    vi.useFakeTimers();
    mockUserCtx = {
      user: { id: "u1" },
      session: { access_token: "user-token" },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "session expired" }),
        { status: 401 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useYouTubeSummarizer("https://youtu.be/x"),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      const r = await result.current.summarizationQuery.refetch();
      expect(r.isError).toBe(true);
    });

    // The hook schedules push via setTimeout; advance to fire it
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(mockPush).toHaveBeenCalledWith("/auth/login");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 8.2: Run test, verify pass**

Run: `pnpm test lib/hooks/__tests__/useYouTubeSummarizer.test.ts`
Expected: 8 tests pass.

If a test fails because the hook references something not mocked here (e.g. `getAuthErrorInfo` returns different `redirectDelay`), inspect `lib/utils/youtube.ts:getAuthErrorInfo` and adjust the test's `vi.advanceTimersByTime` to match the real delay rather than guessing.

---

### Task 9: PR 2 (unit tests)

- [ ] **Step 9.1: Run full test suite locally**

Run: `pnpm test --coverage`
Expected: all tests pass; coverage % moves up by ~1-3 points.

- [ ] **Step 9.2: Commit and open PR**

```bash
git add lib/hooks/__tests__/useClipboard.test.ts \
        lib/hooks/__tests__/usePersistedUrl.test.ts \
        lib/hooks/__tests__/useYouTubeSummarizer.test.ts
git commit -m "$(cat <<'EOF'
test: cover three hooks at the unit tier

useClipboard: clipboard write + auto-reset + failure path.
usePersistedUrl: hydrate, save, clear, malformed JSON, quota error.
useYouTubeSummarizer: anon-session provisioning, body composition,
auth-token gate, 401 → /auth/login redirect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin <branch-name>
gh pr create --title "test: hook unit tests (A0 PR 2/5)" --body "$(cat <<'EOF'
## Summary

Second of five A0 PRs. Adds unit tests for the three frontend hooks
without existing coverage: useClipboard, usePersistedUrl,
useYouTubeSummarizer.

## Test plan

- [ ] \`pnpm test --coverage\` passes locally
- [ ] CI green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9.3: Wait for CI and merge after review**

---

## Phase 2 — Integration tests (PR 3)

### Task 10: Audit `lib/services/__tests__/llm-client.test.ts`

The spec says "audit + expand if needed." The audit finding goes into the PR description; no code changes if existing coverage is sufficient.

- [ ] **Step 10.1: Read existing coverage and write audit note**

Run: `wc -l lib/services/__tests__/llm-client.test.ts && grep -c "it(" lib/services/__tests__/llm-client.test.ts`
Existing audit (recorded at plan-write time): the file already covers env-var trimming (6 cases via `it.each`), missing/whitespace env vars, non-OK status, single + multi chunk happy path, mid-line chunk fragmentation, no-content close, malformed-only chunks, mixed malformed+valid with final-count log, abort-signal forwarding, mid-stream reader failure with partial-content wrap, error cause attachment, model parameter override (explicit + whitespace fallback), and `callLlmJson` (timeout, body-read failure, missing content, signal composition).

**Audit conclusion: no expansion required.** Note this in the PR description for Task 13.

---

### Task 11: `lib/services/__tests__/models.test.ts`

`lib/services/models.ts` is a constants module (`HAIKU`, `SONNET`, `KnownModel` type). Tests verify the constants match the documented contract — wrong values would cause silent gateway failures.

**Files:**
- Create: `lib/services/__tests__/models.test.ts`

- [ ] **Step 11.1: Write the test file**

```ts
import { describe, it, expect } from "vitest";
import { HAIKU, SONNET, type KnownModel } from "../models";

describe("models constants", () => {
  it("HAIKU includes the dated suffix (gateway requirement)", () => {
    // Per models.ts comment: undated `claude-haiku-4-5` returns 502 from
    // CLIProxyAPI ('unknown provider'). Dated form must be preserved.
    expect(HAIKU).toMatch(/^claude-haiku-4-5-\d{8}$/);
  });

  it("SONNET resolves through gateway aliasing (no dated suffix required)", () => {
    // Per models.ts comment: SONNET works undated because its alias is
    // wired through. The exact value is the contract; pin it.
    expect(SONNET).toBe("claude-sonnet-4-6");
  });

  it("HAIKU and SONNET are distinct", () => {
    expect(HAIKU).not.toBe(SONNET);
  });

  it("KnownModel type accepts both constants", () => {
    // Compile-time guarantee, smoke-tested at runtime via assignability
    const a: KnownModel = HAIKU;
    const b: KnownModel = SONNET;
    expect([a, b]).toHaveLength(2);
  });
});
```

- [ ] **Step 11.2: Run test, verify pass**

Run: `pnpm test lib/services/__tests__/models.test.ts`
Expected: 4 tests pass.

---

### Task 12: `lib/supabase/__tests__/middleware.test.ts`

`lib/supabase/middleware.ts` is a Next.js Edge middleware function. Mock `@supabase/ssr` and exercise the redirect logic.

**Files:**
- Create: `lib/supabase/__tests__/middleware.test.ts`

- [ ] **Step 12.1: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockCreateServerClient = vi.fn(() => ({
  auth: { getUser: mockGetUser },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock("../../utils", () => ({
  hasEnvVars: true,
}));

import { updateSession } from "../middleware";

function req(pathname: string): NextRequest {
  return new NextRequest(`https://example.com${pathname}`);
}

describe("updateSession", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockCreateServerClient.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["/", "home"],
    ["/summary", "summary index"],
    ["/summary?url=foo", "summary with query"],
    ["/auth/login", "auth login"],
    ["/auth/sign-up", "auth signup"],
    ["/login", "legacy login"],
    ["/privacy", "privacy"],
    ["/terms", "terms"],
    ["/api/health", "health probe"],
  ])("allows unauthenticated access to %s (%s)", async (pathname) => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req(pathname));
    expect(response.status).toBe(200);
    // No redirect header set
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated request for a protected path to /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/\/auth\/login$/);
  });

  it("allows authenticated request to a protected path", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    const response = await updateSession(req("/dashboard"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("short-circuits without calling supabase when hasEnvVars is false", async () => {
    vi.resetModules();
    vi.doMock("../../utils", () => ({ hasEnvVars: false }));
    const { updateSession: updateSessionNoEnv } = await import("../middleware");
    const response = await updateSessionNoEnv(req("/dashboard"));
    expect(response.status).toBe(200);
    // createServerClient should not have been called this run
    expect(mockCreateServerClient).not.toHaveBeenCalled();
    vi.doUnmock("../../utils");
  });

  it("trims env vars before passing them to createServerClient", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "  https://supabase.example.com  ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "  anon-key\n");
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await updateSession(req("/dashboard"));
    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://supabase.example.com",
      "anon-key",
      expect.any(Object)
    );
  });
});
```

- [ ] **Step 12.2: Run test, verify pass**

Run: `pnpm test lib/supabase/__tests__/middleware.test.ts`
Expected: 13 tests pass (`it.each` expands to 9 + 4 standalone).

If `it.each` cases fail because the path-matching changes (e.g. someone adds `/dashboard` as public), update the table to match.

---

### Task 13: PR 3 (integration tests)

- [ ] **Step 13.1: Run full test suite + coverage**

Run: `pnpm test --coverage`
Expected: all green.

- [ ] **Step 13.2: Commit and open PR**

```bash
git add lib/services/__tests__/models.test.ts \
        lib/supabase/__tests__/middleware.test.ts
git commit -m "$(cat <<'EOF'
test: cover models constants + auth middleware redirect

models.test: pins HAIKU dated-suffix contract and SONNET alias.
middleware.test: enumerates public paths, asserts protected-path
redirect, env-var trim, hasEnvVars short-circuit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin <branch-name>
gh pr create --title "test: integration coverage for models + auth middleware (A0 PR 3/5)" --body "$(cat <<'EOF'
## Summary

Third of five A0 PRs. Closes the integration-tier gaps identified in
the spec: \`lib/services/models.ts\` (constants pinning) and
\`lib/supabase/middleware.ts\` (auth-redirect logic).

## llm-client.test audit

Existing 33 cases already cover env-var trimming (6 via it.each),
missing/whitespace env vars, non-OK status, single + multi-chunk happy
path, mid-line chunk fragmentation, no-content close, malformed-only
chunks, mixed malformed+valid with final-count log, abort signal
forwarding, mid-stream reader failure with partial-content wrap, error
cause attachment, model parameter override, callLlmJson timeout, body
read failure, missing content, signal composition. **No expansion
required.**

## Test plan

- [ ] \`pnpm test --coverage\` passes locally
- [ ] CI green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 13.3: Wait for CI and merge after review**

---

## Phase 3 — E2E auth tests (PR 4)

### Task 14: Extend `smoke-tests/helpers.ts` with admin client helpers

The auth E2E specs need to (a) generate signup/recovery confirmation links without real email, and (b) clean up randomized signup users.

**Files:**
- Modify: `smoke-tests/helpers.ts`

- [ ] **Step 14.1: Append admin helpers to `smoke-tests/helpers.ts`**

Append at the end of the file:

```ts
// --- Admin helpers (E2E auth specs) -----------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminCreds = SmokeCreds & {
  supabaseUrl: string;
  serviceRoleKey: string;
};

/**
 * Same as `loadSmokeCreds` but additionally requires SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY for the admin client. Returns null if
 * either is missing — auth E2E specs should `test.skip` in that case.
 */
export async function loadAdminCreds(): Promise<AdminCreds | null> {
  const base = await loadSmokeCreds();
  if (!base) return null;

  const fromEnv = (k: string) => process.env[k]?.trim();
  let supabaseUrl = fromEnv("SUPABASE_URL");
  let serviceRoleKey = fromEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const { readFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const credPath = path.join(
      os.homedir(),
      ".config/claude-test-creds/youtubeai.env"
    );
    try {
      const raw = await readFile(credPath, "utf8");
      const parsed = parseEnvFile(raw);
      supabaseUrl = supabaseUrl || parsed.SUPABASE_URL?.trim();
      serviceRoleKey =
        serviceRoleKey || parsed.SUPABASE_SERVICE_ROLE_KEY?.trim();
    } catch {
      return null;
    }
  }

  if (!supabaseUrl || !serviceRoleKey) return null;
  return { ...base, supabaseUrl, serviceRoleKey };
}

/** Cached admin client. Built lazily so test files that don't need it
 * never construct it. */
let cachedAdmin: SupabaseClient | null = null;

export async function getAdminClient(creds: AdminCreds): Promise<SupabaseClient> {
  if (cachedAdmin) return cachedAdmin;
  const { createClient } = await import("@supabase/supabase-js");
  cachedAdmin = createClient(creds.supabaseUrl, creds.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/**
 * Generate a recovery (password-reset) action link for an existing
 * user. Bypasses real email — the link is returned directly so the
 * E2E driver can navigate to it.
 */
export async function generateRecoveryLink(
  creds: AdminCreds,
  email: string
): Promise<string> {
  const admin = await getAdminClient(creds);
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) throw error;
  const link = data?.properties?.action_link;
  if (!link) throw new Error("admin.generateLink returned no action_link");
  return link;
}

/**
 * Delete a user by email. Used in test teardown to keep randomized
 * signup users from accumulating. No-op if the user does not exist.
 */
export async function deleteUserByEmail(
  creds: AdminCreds,
  email: string
): Promise<void> {
  const admin = await getAdminClient(creds);
  // listUsers is paginated; we filter manually since admin.getUserByEmail
  // is not exposed in v2.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw error;
  const match = data.users.find((u) => u.email === email);
  if (!match) return;
  const { error: delErr } = await admin.auth.admin.deleteUser(match.id);
  if (delErr) throw delErr;
}
```

- [ ] **Step 14.2: Add unit tests for the new env loader**

Append to `smoke-tests/__tests__/helpers.test.ts`:

```ts
// helpers.test.ts already covers parseEnvFile. Add coverage for the new
// loadAdminCreds env-precedence logic. Filesystem-touching paths are
// covered by the E2E spec actually consuming admin credentials — keep
// these as boundary tests for the env-var precedence only.

import { loadAdminCreds } from "../helpers";

describe("loadAdminCreds", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when SUPABASE_URL or SERVICE_ROLE missing AND file absent", async () => {
    process.env.TEST_USER_EMAIL = "x@example.com";
    process.env.TEST_USER_PASSWORD = "x";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.HOME = "/nonexistent-test-home-xyz";
    const r = await loadAdminCreds();
    expect(r).toBeNull();
  });

  it("returns admin creds when both env vars are set", async () => {
    process.env.TEST_USER_EMAIL = "x@example.com";
    process.env.TEST_USER_PASSWORD = "x";
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const r = await loadAdminCreds();
    expect(r).not.toBeNull();
    expect(r!.supabaseUrl).toBe("https://supabase.example.com");
    expect(r!.serviceRoleKey).toBe("service-role-key");
    expect(r!.email).toBe("x@example.com");
  });
});
```

If `helpers.test.ts` doesn't already import `afterEach` and `describe`/`it`/`expect`, prepend `import { describe, it, expect, afterEach } from "vitest";` to the new section (or check existing imports first).

- [ ] **Step 14.3: Run helper tests**

Run: `pnpm test smoke-tests/__tests__/helpers.test.ts`
Expected: existing tests + 2 new tests pass.

- [ ] **Step 14.4: Commit**

```bash
git add smoke-tests/helpers.ts smoke-tests/__tests__/helpers.test.ts
git commit -m "$(cat <<'EOF'
test: admin client helpers for auth E2E specs

loadAdminCreds reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env
or test creds file. generateRecoveryLink + deleteUserByEmail let auth
specs bypass real email and clean up randomized signup users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `smoke-tests/e2e-auth-signup.spec.ts`

**Files:**
- Create: `smoke-tests/e2e-auth-signup.spec.ts`

- [ ] **Step 15.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loadAdminCreds, deleteUserByEmail } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("signup creates a new account and redirects to sign-up-success", async ({
  page,
}) => {
  const creds = await loadAdminCreds();
  test.skip(!creds, "SUPABASE_SERVICE_ROLE_KEY required for signup teardown");
  if (!creds) return;

  const email = `signup-test-${randomUUID()}@youtubeai.chat`;
  const password = `TestPass!${randomUUID().slice(0, 8)}`;

  try {
    await page.goto(`${PROD_URL}/auth/sign-up`);

    // Use role-based locators — survives visual redesigns. Form has
    // distinct password + repeat-password inputs.
    await page.getByLabel(/email/i).fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#repeat-password").fill(password);

    await Promise.all([
      page.waitForURL(/\/auth\/sign-up-success/, { timeout: 15_000 }),
      page.getByRole("button", { name: /sign up/i }).click(),
    ]);

    await expect(
      page.getByText(/check your email|confirmation/i)
    ).toBeVisible();
  } finally {
    // Always clean up — even on test failure — so randomized users
    // don't accumulate in the project.
    await deleteUserByEmail(creds, email).catch((err) => {
      console.warn("[e2e-auth-signup] teardown deleteUser failed:", err);
    });
  }
});
```

- [ ] **Step 15.2: Run against local dev**

Start dev server in another terminal: `pnpm dev`
Run: `pnpm exec playwright test smoke-tests/e2e-auth-signup.spec.ts --project=chromium`
Expected: 1 test passes; user is created in Supabase and deleted in teardown.

If the labels/inputs don't match (auth UI may use different IDs), open `app/auth/sign-up/components/sign-up-form.tsx` and adjust the locators. Prefer `getByRole`/`getByLabel` over CSS selectors.

---

### Task 16: `smoke-tests/e2e-auth-login.spec.ts`

**Files:**
- Create: `smoke-tests/e2e-auth-login.spec.ts`

- [ ] **Step 16.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("login → logout round-trip", async ({ page }) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  // --- Login ---
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Authenticated state signal: the URL input is only rendered on home
  // for authenticated and unauthenticated users alike, so we instead
  // check for an account/menu trigger that's only present when signed in.
  // Adjust the selector to whatever the project surfaces — common patterns:
  //   - getByRole("button", { name: /account|profile|sign out/i })
  //   - getByTestId("user-menu-trigger")
  const accountMenu = page
    .getByRole("button", { name: /account|profile|sign out|logout/i })
    .or(page.getByTestId("user-menu-trigger"));
  await expect(accountMenu).toBeVisible({ timeout: 10_000 });

  // --- Logout ---
  await accountMenu.click();
  // Logout may be inside an open menu, or a direct button.
  const logout = page
    .getByRole("menuitem", { name: /sign out|logout/i })
    .or(page.getByRole("button", { name: /sign out|logout/i }));
  await Promise.all([
    page.waitForURL(/\/(auth\/login)?$/, { timeout: 10_000 }),
    logout.click(),
  ]);

  // Unauthenticated state: account menu must be gone
  await expect(accountMenu).not.toBeVisible();
});
```

- [ ] **Step 16.2: Run against local dev**

Run: `pnpm exec playwright test smoke-tests/e2e-auth-login.spec.ts --project=chromium`
Expected: 1 test passes.

If logout selectors don't match the actual UI, open the relevant component (likely `components/header.tsx` or similar — find via `grep -ril "sign.out\|logout" components/`) and adjust the locators.

---

### Task 17: `smoke-tests/e2e-auth-password-reset.spec.ts`

**Files:**
- Create: `smoke-tests/e2e-auth-password-reset.spec.ts`

- [ ] **Step 17.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { loadAdminCreds, generateRecoveryLink } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("password reset: forgot → recovery link → update → re-login", async ({
  page,
  context,
}) => {
  const creds = await loadAdminCreds();
  test.skip(!creds, "SUPABASE_SERVICE_ROLE_KEY required");
  if (!creds) return;

  // --- Forgot-password form submission (UI signal only) ---
  await page.goto(`${PROD_URL}/auth/forgot-password`);
  await page.fill("#email", creds.email);
  await page.getByRole("button", { name: /send reset|reset password/i }).click();
  await expect(page.getByText(/check your email|sent/i)).toBeVisible({
    timeout: 10_000,
  });

  // --- Skip the email; pull the recovery link via admin API ---
  const recoveryLink = await generateRecoveryLink(creds, creds.email);

  // The recovery link points at the Supabase auth domain; following it in
  // the same browser context preserves the session cookie, which the
  // /auth/update-password page needs.
  await page.goto(recoveryLink);
  await page.waitForURL(/\/auth\/update-password/, { timeout: 15_000 });

  // --- Update password (back to original so subsequent runs work) ---
  await page.locator("#password").fill(creds.password);
  await page.locator("#repeat-password").fill(creds.password);
  await page.getByRole("button", { name: /update password|save/i }).click();

  // Update redirects to home on success (same redirect rule as login)
  await page.waitForURL(`${PROD_URL}/`, { timeout: 10_000 });

  // --- Sanity: log out then log back in with the (re-set-to-original) password ---
  // Log out via cookie clear — reuses session-clearing without needing
  // the menu locator to match.
  await context.clearCookies();
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
});
```

- [ ] **Step 17.2: Run against local dev**

Run: `pnpm exec playwright test smoke-tests/e2e-auth-password-reset.spec.ts --project=chromium`
Expected: 1 test passes.

If `update-password` form submission fails, check that the recovery link redirected the user-agent to a fully authenticated session before navigating to the update page. Supabase recovery flow may require `?type=recovery&access_token=...` parsing handled by `app/auth/callback/route.ts` — inspect that route if the test stalls.

---

### Task 18: PR 4 (auth E2E)

- [ ] **Step 18.1: Run all new E2E specs locally**

Run:
```bash
pnpm dev &  # background
sleep 5  # wait for dev server boot
pnpm exec playwright test smoke-tests/e2e-auth-signup.spec.ts smoke-tests/e2e-auth-login.spec.ts smoke-tests/e2e-auth-password-reset.spec.ts --project=chromium
```

Expected: 3 tests pass.

- [ ] **Step 18.2: Commit and open PR**

```bash
git add smoke-tests/e2e-auth-signup.spec.ts \
        smoke-tests/e2e-auth-login.spec.ts \
        smoke-tests/e2e-auth-password-reset.spec.ts
git commit -m "$(cat <<'EOF'
test: E2E auth flows (signup, login, password reset)

All three bypass real email by using the Supabase admin API for link
generation and randomized-user cleanup. Auto-skip when service role key
is unavailable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin <branch-name>
gh pr create --title "test: auth flow E2E coverage (A0 PR 4/5)" --body "$(cat <<'EOF'
## Summary

Fourth of five A0 PRs. Adds Playwright E2E for the three auth flows:
signup, login/logout round-trip, password reset.

Bypasses real email via Supabase admin client (\`generateLink\`).
Cleans up randomized signup users in test teardown.

## Test plan

- [ ] All three new specs pass locally against \`pnpm dev\`
- [ ] CI green
- [ ] Post-merge: \`pnpm smoke:e2e\` passes against
      \`https://www.youtubeai.chat\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 18.3: Wait for CI and merge after review**

---

## Phase 4 — E2E summary tests (PR 5)

### Task 19: `smoke-tests/e2e-summary-cjk.spec.ts`

This locks the recently-fixed zh-caption regression. Should fail if the bug returns.

**Files:**
- Create: `smoke-tests/e2e-summary-cjk.spec.ts`

- [ ] **Step 19.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const SUMMARY_TIMEOUT_MS = 240_000;

const HAN = /\p{Script=Han}/u;
const HIRAGANA = /\p{Script=Hiragana}/u;

const CASES: Array<{ url: string; label: string; matcher: RegExp }> = [
  {
    url: "https://www.youtube.com/watch?v=xMZqTuLWSA4",
    label: "Chinese (Mandarin)",
    matcher: HAN,
  },
  // Pick a public Japanese video with reliable captions. If this URL
  // becomes unavailable, replace with another public ja video — the
  // assertion target is the script, not the specific content.
  {
    url: "https://www.youtube.com/watch?v=Cjzy46WuBAk",
    label: "Japanese",
    matcher: HIRAGANA,
  },
];

for (const { url, label, matcher } of CASES) {
  test(`${label} video produces a summary in source script`, async ({
    page,
  }) => {
    const creds = await loadSmokeCreds();
    expect(creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required").not.toBeNull();
    if (!creds) return;

    await page.goto(`${PROD_URL}/auth/login`);
    await page.fill("#email", creds.email);
    await page.fill("#password", creds.password);
    await Promise.all([
      page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);

    await page.goto(
      `${PROD_URL}/summary?url=${encodeURIComponent(url)}`,
      { waitUntil: "domcontentloaded" }
    );

    await page.waitForSelector(".prose p", { timeout: SUMMARY_TIMEOUT_MS });
    // Let streaming flush
    await page.waitForTimeout(2_000);

    const summaryText = await page.evaluate(() => {
      const els = document.querySelectorAll(
        ".prose p, .prose li, .prose h1, .prose h2, .prose h3"
      );
      return Array.from(els).map((el) => el.textContent || "").join(" ");
    });

    expect(
      matcher.test(summaryText),
      `summary should contain ${label} script characters`
    ).toBe(true);
  });
}
```

- [ ] **Step 19.2: Run against prod (cold cache may take 60-180s)**

Run: `pnpm exec playwright test smoke-tests/e2e-summary-cjk.spec.ts --project=chromium`
Expected: 2 tests pass.

The Japanese URL (`Cjzy46WuBAk`) is a placeholder. If it fails because the video is unavailable or has no Japanese captions, replace with a known-good public Japanese video. Document the chosen URL in the spec file's comment.

---

### Task 20: `smoke-tests/e2e-summary-errors.spec.ts`

**Files:**
- Create: `smoke-tests/e2e-summary-errors.spec.ts`

- [ ] **Step 20.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

async function login(page: import("@playwright/test").Page) {
  const creds = await loadSmokeCreds();
  if (!creds) return null;
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
  return creds;
}

test("invalid YouTube URL surfaces a user-visible error", async ({ page }) => {
  const creds = await login(page);
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://example.com/not-a-video")}`,
    { waitUntil: "domcontentloaded" }
  );

  const errorBanner = page
    .getByTestId("stream-error-banner")
    .or(page.getByText(/invalid.*url|could not.*load|error/i));
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
});

test("upstream summary failure (intercepted) surfaces error UI", async ({
  page,
}) => {
  const creds = await login(page);
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  // Force the streaming endpoint to return 502 on the next call, then
  // navigate. Asserts the UI degrades to the error banner rather than
  // silently spinning forever.
  await page.route("**/api/summarize/stream", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ message: "intercepted: simulated upstream 502" }),
    })
  );

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}`,
    { waitUntil: "domcontentloaded" }
  );

  const errorBanner = page
    .getByTestId("stream-error-banner")
    .or(page.getByText(/error|failed|try again/i));
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 20.2: Run against local dev**

Run: `pnpm exec playwright test smoke-tests/e2e-summary-errors.spec.ts --project=chromium`
Expected: 2 tests pass.

The "stream-error-banner" testid is borrowed from the existing `e2e-summarize.spec.ts`. If a different testid is used in the actual UI, the `.or(...)` fallback to text-matching catches it.

---

### Task 21: `smoke-tests/e2e-summary-rate-limit.spec.ts`

**Files:**
- Create: `smoke-tests/e2e-summary-rate-limit.spec.ts`

- [ ] **Step 21.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// Force the rate-limit branch by intercepting and returning the same
// 429 the orchestrator returns when the per-user limit is hit. This
// avoids actually exhausting the prod limit (which would lock out the
// test user for the rest of the day).
test("429 response surfaces rate-limit / paywall UI", async ({ page }) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  await page.route("**/api/summarize/stream", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Rate limit exceeded. Please upgrade or try again later.",
      }),
    })
  );

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}`,
    { waitUntil: "domcontentloaded" }
  );

  const limitUi = page.getByText(/rate.?limit|upgrade|too many requests/i);
  await expect(limitUi).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 21.2: Run against local dev**

Run: `pnpm exec playwright test smoke-tests/e2e-summary-rate-limit.spec.ts --project=chromium`
Expected: 1 test passes.

If the UI's wording doesn't match `/rate.?limit|upgrade|too many requests/i`, inspect `app/summary/components/*` for the actual message and update the regex.

---

### Task 22: `smoke-tests/e2e-landing-to-summary.spec.ts`

**Files:**
- Create: `smoke-tests/e2e-landing-to-summary.spec.ts`

- [ ] **Step 22.1: Write the test file**

```ts
import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const TEST_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SUMMARY_TIMEOUT_MS = 240_000;

test("landing page → input form → summary streaming", async ({ page }) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Should already be on home after login. Confirm the input form is rendered.
  await expect(
    page.getByRole("textbox", { name: /youtube url/i })
  ).toBeVisible();

  await page.getByRole("textbox", { name: /youtube url/i }).fill(TEST_VIDEO);
  await Promise.all([
    page.waitForURL(/\/summary/, { timeout: 15_000 }),
    page.getByRole("button", { name: /summarize video/i }).click(),
  ]);

  // Wait for streamed summary to render
  await page.waitForSelector(".prose p", { timeout: SUMMARY_TIMEOUT_MS });

  const summaryText = await page.evaluate(() => {
    const els = document.querySelectorAll(".prose p, .prose li");
    return Array.from(els).map((el) => el.textContent || "").join(" ");
  });
  expect(summaryText.length).toBeGreaterThan(50);
});
```

- [ ] **Step 22.2: Run against local dev**

Run: `pnpm exec playwright test smoke-tests/e2e-landing-to-summary.spec.ts --project=chromium`
Expected: 1 test passes.

---

### Task 23: PR 5 (summary E2E)

- [ ] **Step 23.1: Run all four new specs locally**

Run:
```bash
pnpm exec playwright test \
  smoke-tests/e2e-summary-cjk.spec.ts \
  smoke-tests/e2e-summary-errors.spec.ts \
  smoke-tests/e2e-summary-rate-limit.spec.ts \
  smoke-tests/e2e-landing-to-summary.spec.ts \
  --project=chromium
```

Expected: 5 tests pass (cjk has 2, others 1 each).

- [ ] **Step 23.2: Commit and open PR**

```bash
git add smoke-tests/e2e-summary-cjk.spec.ts \
        smoke-tests/e2e-summary-errors.spec.ts \
        smoke-tests/e2e-summary-rate-limit.spec.ts \
        smoke-tests/e2e-landing-to-summary.spec.ts
git commit -m "$(cat <<'EOF'
test: E2E summary flows (cjk regression, errors, rate-limit, landing)

cjk: locks the recently-fixed zh-caption fallback.
errors: invalid URL + intercepted 502.
rate-limit: 429 paywall UI.
landing-to-summary: input-form → streaming render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin <branch-name>
gh pr create --title "test: summary flow E2E coverage (A0 PR 5/5)" --body "$(cat <<'EOF'
## Summary

Final A0 PR. Adds four new E2E specs covering summary flows:

- \`e2e-summary-cjk\`: Chinese + Japanese videos render in source script
  (locks the recent zh-caption regression).
- \`e2e-summary-errors\`: invalid URL + intercepted upstream 502.
- \`e2e-summary-rate-limit\`: intercepted 429 surfaces paywall UI
  (does NOT exhaust real prod limit).
- \`e2e-landing-to-summary\`: home → input form → streaming render.

## Test plan

- [ ] All four new specs pass locally against \`pnpm dev\`
- [ ] CI green
- [ ] Post-merge: \`pnpm smoke:e2e\` passes against
      \`https://www.youtubeai.chat\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 23.3: Wait for CI and merge after review**

---

## Phase 5 — Final verification

### Task 24: Full local + post-deploy smoke

- [ ] **Step 24.1: Run full local suite**

Run:
```bash
pnpm test --coverage
pnpm exec playwright test --project=chromium
```

Expected: vitest passes coverage gate; all Playwright specs pass.

- [ ] **Step 24.2: Post-deploy prod smoke**

After PR 5 merges and the deploy completes (watch `gh run watch` on the most-recent workflow run):

Run:
```bash
PROD_URL=https://www.youtubeai.chat pnpm exec playwright test --project=chromium
```

Expected: all specs pass against prod. If `e2e-summary-cjk` fails, the zh-caption regression returned — investigate before declaring A0 done.

- [ ] **Step 24.3: Mark A0 complete and hand off to A1 brainstorm**

A0 done. Next cycle:

```
/superpowers:brainstorming
```

with the topic "A1 — dependency modernization (assumes A0 done)".
