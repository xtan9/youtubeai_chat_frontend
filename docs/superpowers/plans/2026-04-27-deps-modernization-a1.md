# A1 Dependency Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all dependencies in `youtubeai_chat` to current latest-major across frontend, service, and CI tooling, in five sequential foundation-first PRs.

**Architecture:** All work happens in the `.worktrees/deps-a1/` worktree (already created on `origin/main`). Each PR uses a fresh branch cut from `origin/main` after the prior PR has merged. Subagent-driven implementer per PR with two-stage review; pr-review-toolkit pre-merge; auto-merge after CI green. Strict serial order — only one A1 PR in flight at a time.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, ESLint 10, zod 4, Tailwind 4, Supabase JS, vitest 4, Playwright, Hono 4 (service).

**Spec:** `docs/superpowers/specs/2026-04-27-deps-modernization-a1-design.md`

---

## Universal pre-flight (run before each PR's first commit)

The implementer subagent for **every** PR runs these checks first to establish a clean baseline. If any fails, stop and surface — A1 assumes a green starting state.

- [ ] `cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1 && git fetch origin && git checkout main && git pull --ff-only`
- [ ] `git checkout -b <branch-name>` (per-PR branch name in each task)
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint` — clean
- [ ] `pnpm exec tsc --noEmit` — clean
- [ ] `pnpm test --run` — 491 tests pass (or current count)
- [ ] `pnpm build` — clean

---

## Universal pre-push gate (run before push on every PR)

The implementer subagent runs all of these green before pushing. **Pre-push tsc is mandatory** — A0 had a PR re-push because vitest's transpiler didn't catch a TS error that `tsc --noEmit` would have.

- [ ] `pnpm lint` — clean (0 warnings/errors)
- [ ] `pnpm exec tsc --noEmit` — clean
- [ ] `pnpm test --coverage --run` — all tests pass; coverage at or above 50/40/50/50 floor
- [ ] `pnpm build` — clean
- [ ] `pnpm dev` for ~10s, console shows no new deprecation warnings (capture and stop)
- [ ] At least one Playwright spot-check spec passes locally against `pnpm dev`
- [ ] `git status` clean (no untracked test artifacts)

If any check fails, fix in-place; do not push red.

---

## Universal post-merge protocol

After each PR is squash-merged:

- [ ] Watch the `smoke` GitHub Action triggered by push-to-main on the merge commit. Use `gh run watch` or poll `gh run view <id> --json status,conclusion`.
- [ ] If `smoke` is **green**: mark task complete, proceed to next PR.
- [ ] If `smoke` is **red**: open a revert PR (`gh pr create` from a branch that reverts the merge commit). Get green smoke before proceeding to next A1 PR.
- [ ] Document any deviation from the plan as a comment in this file (inline near the affected task).

---

## Task 1: PR 1 — Next 16 foundation

**Branch:** `chore/deps-a1-1-next16`
**Conventional title:** `chore(deps): Next.js 16 + companions, pin floating Supabase`

**Files likely touched:**
- `package.json`, `pnpm-lock.yaml`
- `next.config.ts`
- `middleware.ts`
- `app/api/**/route.ts` (route handlers)
- `app/**/page.tsx`, `app/**/layout.tsx` if any async-API call sites
- `lib/supabase/server.ts`, `lib/supabase/middleware.ts` (cookies/headers usage)

### Steps

- [ ] **Step 1: Run universal pre-flight** (see top of doc). Branch: `chore/deps-a1-1-next16`.

- [ ] **Step 2: Bump Next + companions + Supabase pin**

```bash
pnpm add next@16 eslint-config-next@16 @next/third-parties@16 \
  posthog-js@latest posthog-node@latest \
  @supabase/supabase-js@^2.105.0 @supabase/ssr@^0.10.2
```

After the install completes, manually edit `package.json` to confirm `@supabase/ssr` and `@supabase/supabase-js` are pinned to the resolved version (e.g., `^0.10.2` and `^2.105.0`) — **never** `"latest"`. The pin must be a caret-version, not the literal string `latest`.

- [ ] **Step 3: Read upstream migration guide**

Open `https://nextjs.org/docs/app/guides/upgrading/version-16` (use `WebFetch`). Note every breaking change that applies to App Router code, route handlers, middleware, and `cookies()`/`headers()`. The implementer subagent may also use the codemod `npx @next/codemod@canary upgrade latest` if it covers our surface — verify the codemod's diff before committing.

- [ ] **Step 4: Run build, capture errors**

```bash
pnpm build 2>&1 | tee /tmp/a1-pr1-build.log
```

For each error or warning in `/tmp/a1-pr1-build.log`, locate the calling code and fix per the migration guide. Common patterns to expect:
- `cookies()` and `headers()` may need `await` (or no-`await`, depending on Next 16's resolution — read the migration guide section on async APIs).
- `params` in dynamic routes may have changed shape.
- Middleware return type may have changed.
- Removed `experimental` flags must be deleted from `next.config.ts`.

Repeat the build → fix loop until `pnpm build` exits 0 with no warnings.

- [ ] **Step 5: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Fix any type errors. Most should be Next type-package related (handled by `next` itself).

- [ ] **Step 6: Run unit + integration tests**

```bash
pnpm test --run
```

Tests in `lib/supabase/__tests__/middleware.test.ts` may be brittle to Next 16 internals — read each failure carefully. Update test mocks only when the underlying behavior actually changed (test was load-bearing on the old shape).

- [ ] **Step 7: Run lint**

```bash
pnpm lint
```

Address any new warnings from `eslint-config-next@16`.

- [ ] **Step 8: Manual dev smoke**

```bash
pnpm dev
```

Open http://localhost:3000 in a browser via the `playwright` skill, sign in with creds at `~/.config/claude-test-creds/youtubeai.env`, paste a YouTube URL, verify a summary streams. Capture screenshot. Stop the server.

- [ ] **Step 9: Run universal pre-push gate**

If any check fails, fix in-place. Do not push red.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore(deps): Next.js 16 + companions, pin floating Supabase

Upgrades next, eslint-config-next, @next/third-parties to 16.x.
Pins @supabase/ssr and @supabase/supabase-js (were 'latest' — dangerous
floating constraint). Picks up posthog patches as ride-along.

Migration touchpoints:
- [list resolved during step 4 — actual app-code changes made]
"
```

- [ ] **Step 11: Push and open PR**

```bash
git push -u origin chore/deps-a1-1-next16
gh pr create --title "chore(deps): Next.js 16 + companions, pin floating Supabase (A1 PR 1/5)" \
  --body "$(cat <<'EOF'
## Summary
- Bumps next, eslint-config-next, @next/third-parties from 15.5 → 16.x
- Pins @supabase/ssr and @supabase/supabase-js (were "latest" — eliminates dangerous floating constraint)
- Migrates app-code to Next 16 APIs (see commit body for specifics)

Part of A1 dependency modernization (5 PRs total, foundation-first).
Spec: docs/superpowers/specs/2026-04-27-deps-modernization-a1-design.md

## Test plan
- [x] `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test --run`, `pnpm build` all clean locally
- [x] `pnpm dev` runs without new deprecation warnings
- [x] Manual: sign in + summarize a YouTube URL works in dev
- [ ] CI green
- [ ] Smoke workflow green post-merge against prod
EOF
)"
```

- [ ] **Step 12: Run pr-review-toolkit**

Invoke `pr-review-toolkit:review-pr` with the PR number. Address every Critical and Important finding. Push a fixup commit (or commits) per finding. Re-run the toolkit if substantial changes.

- [ ] **Step 13: Watch CI, auto-merge on green**

```bash
# Wait until all checks pass
until [ "$(gh pr view <PR#> --json mergeable -q .mergeable)" = "MERGEABLE" ] && \
      ! gh pr checks <PR#> | grep -q -E "pending|in_progress|queued"; do
  sleep 30
done
gh pr checks <PR#>  # confirm all SUCCESS
gh pr merge <PR#> --squash --delete-branch
```

If `gh pr merge` fails because of worktree conflict (main checked out elsewhere), fall back to API:
```bash
gh api -X PUT repos/xtan9/youtubeai_chat_frontend/pulls/<PR#>/merge -f merge_method=squash
```

- [ ] **Step 14: Universal post-merge protocol** — watch smoke workflow on merge commit. If red, revert and fix.

---

## Task 2: PR 2 — Type / lint stack

**Branch:** `chore/deps-a1-2-types-lint`
**Conventional title:** `chore(deps): TypeScript 6 + ESLint 10 + @types/node 22`

**Files likely touched:**
- `package.json`, `pnpm-lock.yaml`
- `tsconfig.json` (possibly — if TS 6 deprecates current options)
- `eslint.config.mjs` (possibly — if ESLint 10 removes legacy APIs)
- Various source files where stricter type narrowing surfaces issues

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/deps-a1-2-types-lint`.

- [ ] **Step 2: Bump deps**

```bash
pnpm add -D typescript@6 eslint@10 @types/node@22
```

- [ ] **Step 3: Read upstream changelogs**

Use `WebFetch`:
- TypeScript 6 release notes: `https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/` (or current canonical)
- ESLint 10 migration: `https://eslint.org/docs/latest/use/migrate-to-10.0.0`

Note breaking changes that apply to our codebase. Specifically check:
- Any TS 6 stricter narrowing rules that affect our control flow patterns
- Any ESLint 10 removed APIs used by our `eslint-config-next` (already updated to 16 in PR 1) or by `eslint.config.mjs`

- [ ] **Step 4: Run typecheck**

```bash
pnpm exec tsc --noEmit 2>&1 | tee /tmp/a1-pr2-tsc.log
```

For each error, locate the source. Fix using narrowing, type guards, or explicit casts (only if behavior preserved). Avoid `any` unless documented as a temporary shim.

- [ ] **Step 5: Run lint**

```bash
pnpm lint 2>&1 | tee /tmp/a1-pr2-lint.log
```

Update `eslint.config.mjs` if ESLint 10 removed APIs we used.

- [ ] **Step 6: Run tests**

```bash
pnpm test --run
```

Should be unaffected unless we used a runtime-deprecated API.

- [ ] **Step 7: Run build**

```bash
pnpm build
```

Some Next 16 features rely on TS plugin behavior — verify build still produces the same `.next/` artifacts.

- [ ] **Step 8: Universal pre-push gate.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(deps): TypeScript 6 + ESLint 10 + @types/node 22

Upgrades the type/lint substrate. @types/node tracks Node 22 (the
runtime on Vercel deploys, service Docker, and CI), avoiding type/runtime
drift.
"
```

- [ ] **Step 10: Push, open PR, review, merge.**

Title: `chore(deps): TypeScript 6 + ESLint 10 (A1 PR 2/5)`. Same workflow as Task 1 steps 11–14.

- [ ] **Step 11: Universal post-merge protocol.**

---

## Task 3: PR 3 — zod 4 (frontend + service)

**Branch:** `chore/deps-a1-3-zod4`
**Conventional title:** `chore(deps): zod 4 in frontend + service`

**Files likely touched:**
- `package.json` and `pnpm-lock.yaml` in frontend
- `package.json` and `package-lock.json` in `youtube-ai-service/`
- Every file using `import { z } from "zod"` — find with `rg "from \"zod\""`
- Test files using zod schemas

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/deps-a1-3-zod4`.

- [ ] **Step 2: Find all zod call sites**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1
rg -l '"zod"' --type ts --type tsx
rg -l '"zod"' /home/xingdi/code/youtubeai_chat/youtube-ai-service/src
```

Save the file list — this is the migration surface.

- [ ] **Step 3: Bump deps in both packages**

```bash
# Frontend
pnpm add zod@^4 react-hook-form@latest

# Service
cd /home/xingdi/code/youtubeai_chat/youtube-ai-service
npm install zod@^4
cd -
```

- [ ] **Step 4: Read zod 4 migration guide**

Use `WebFetch` on `https://zod.dev/v4/migration` (or current canonical migration page). Capture every API rename relevant to our usage (likely: `.email()` factory function, refined string formats, union inference, error API).

- [ ] **Step 5: Run typecheck on frontend**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1
pnpm exec tsc --noEmit 2>&1 | tee /tmp/a1-pr3-frontend-tsc.log
```

Fix every type error using the migration guide. Common patterns:
- `z.string().email()` → `z.email()`
- `z.string().url()` → `z.url()`
- `.refine()` callback signature changes
- `z.enum([...] as const)` requirements
- `z.infer<>` results that became stricter

- [ ] **Step 6: Run typecheck on service**

```bash
cd /home/xingdi/code/youtubeai_chat/youtube-ai-service
npx tsc --noEmit 2>&1 | tee /tmp/a1-pr3-service-tsc.log
cd -
```

Apply same migrations.

- [ ] **Step 7: Run frontend tests**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1
pnpm test --run
```

A0's tests use zod in some validators (search for them). Update assertions only where behavior changed; never delete a test to make it pass.

- [ ] **Step 8: Run service tests**

```bash
cd /home/xingdi/code/youtubeai_chat/youtube-ai-service
npm test
cd -
```

- [ ] **Step 9: Manual cross-package smoke**

Both packages must speak the same zod-validated wire. Spot-check by running `pnpm dev` in frontend, ensuring it can call the local service if the test setup supports it; otherwise verify by calling the deployed service from local frontend with `NEXT_PUBLIC_SERVICE_URL` pointing at it. Confirm a YouTube URL summarizes end-to-end.

- [ ] **Step 10: Universal pre-push gate.** Plus: `cd /home/xingdi/code/youtubeai_chat/youtube-ai-service && npm test && cd -`.

- [ ] **Step 11: Commit (single commit covers both packages)**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1
git add -A
# Also stage service changes — the worktree is in frontend, so service paths are at ../../../youtube-ai-service
git -C /home/xingdi/code/youtubeai_chat/youtube-ai-service add -A
# Note: monorepo or separate repos? See repo layout. If separate, two PRs in lockstep.
```

**Important repo-layout check:** if `youtubeai_chat_frontend/` and `youtube-ai-service/` are **separate** git repos, this task becomes **two PRs** (one per repo) merged in lockstep — open both, merge frontend first only after service PR is also approved and ready. The implementer must confirm repo layout in step 1 and adjust.

- [ ] **Step 12: Push, open PR(s), review, merge.**

Title: `chore(deps): zod 4 (frontend + service) (A1 PR 3/5)`.

- [ ] **Step 13: Universal post-merge protocol.**

---

## Task 4: PR 4 — UI / test majors

**Branch:** `chore/deps-a1-4-ui-test`
**Conventional title:** `chore(deps): recharts 3, lucide 1, react-resizable-panels 4, happy-dom 20`

**Files likely touched:**
- `package.json`, `pnpm-lock.yaml`
- `vitest.config.ts` (if happy-dom 20 needs new pragma syntax)
- Every chart component using recharts
- Every file importing icons from `lucide-react`
- Resizable-panel components if any

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/deps-a1-4-ui-test`.

- [ ] **Step 2: Find chart, icon, panel call sites**

```bash
rg -l "from \"recharts\"" --type ts --type tsx
rg -l "from \"lucide-react\"" --type ts --type tsx
rg -l "from \"react-resizable-panels\"" --type ts --type tsx
rg -l "@vitest-environment happy-dom" --type ts
```

Save these as the migration surface.

- [ ] **Step 3: Bump deps**

```bash
pnpm add recharts@^3 lucide-react@^1 react-resizable-panels@^4 \
  tailwindcss@latest @tailwindcss/postcss@latest postcss@latest \
  @tanstack/react-query@latest @tanstack/react-query-devtools@latest \
  @tanstack/eslint-plugin-query@latest \
  vitest@latest @vitest/coverage-v8@latest
pnpm add -D happy-dom@^20
```

- [ ] **Step 4: Read changelogs**

WebFetch:
- recharts 3: `https://github.com/recharts/recharts/releases` (find v3.0.0)
- lucide-react: `https://github.com/lucide-icons/lucide/releases` for breaking changes between 0.x and 1.x
- react-resizable-panels: `https://github.com/bvaughn/react-resizable-panels/releases`
- happy-dom: `https://github.com/capricorn86/happy-dom/releases` for 16/17/18/19/20 majors

- [ ] **Step 5: Build, fix recharts/lucide/panel breaks**

```bash
pnpm build 2>&1 | tee /tmp/a1-pr4-build.log
```

For lucide: any "module has no exported member" errors point at renamed icons. Cross-reference the icon name to the new equivalent in the lucide GitHub.

For recharts: prop name changes, component renames (e.g., `XAxis` → `ChartXAxis` if any).

For panels: API shape changes (defaultSize → defaultSizePercent or similar).

- [ ] **Step 6: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Fix surfaced type errors.

- [ ] **Step 7: Run tests**

```bash
pnpm test --run
```

Hook tests (`lib/hooks/__tests__/`) may surface happy-dom 20 issues. The `usePersistedUrl` test specifically uses `vi.spyOn(localStorage, ...)` (instance spy), which is a happy-dom 15 pattern. If 20 changes Storage internals, this may need re-adjustment. **Never** rewrite a test to "make it pass" — confirm what's actually different first.

- [ ] **Step 8: Manual visual spot-check**

```bash
pnpm dev
```

Use the `playwright` skill to navigate to every page that has a chart, icon, or resizable panel. Take a screenshot of each. Verify charts render data, icons display, panels resize. If any visual delta is non-trivial, capture before/after screenshots in the PR description.

- [ ] **Step 9: Universal pre-push gate.**

- [ ] **Step 10: Commit + push + PR + review + merge.**

Title: `chore(deps): UI + test majors (A1 PR 4/5)`. Same workflow.

- [ ] **Step 11: Universal post-merge protocol.**

---

## Task 5: PR 5 — Service refresh + tooling

**Branch:** `chore/deps-a1-5-service-tooling` (or two PRs if separate repos for service)
**Conventional title:** `chore(deps): service refresh + GitHub Actions bumps`

**Files likely touched:**
- `youtube-ai-service/package.json`, `package-lock.json`
- `youtube-ai-service/src/**` (if Hono minor or vitest 4 needs source changes)
- `.github/workflows/ci.yml`
- `.github/workflows/smoke.yml`
- `.github/workflows/db-migrate.yml`

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/deps-a1-5-service-tooling`.

- [ ] **Step 2: Bump service deps**

```bash
cd /home/xingdi/code/youtubeai_chat/youtube-ai-service
npm install hono@latest @hono/node-server@latest \
  vitest@^4 \
  typescript@6 \
  tsx@latest \
  @types/node@22
```

- [ ] **Step 3: Service: typecheck, test, build**

```bash
cd /home/xingdi/code/youtubeai_chat/youtube-ai-service
npx tsc --noEmit
npm test
npm run build
cd -
```

Fix any issues. Hono 4.x is minor-bump only; should be smooth. vitest 3 → 4 may require small config changes — see `https://vitest.dev/guide/migration.html`.

- [ ] **Step 4: Bump GitHub Actions versions**

In `.github/workflows/ci.yml`, `.github/workflows/smoke.yml`, `.github/workflows/db-migrate.yml`, replace:
- `actions/checkout@v4` → `actions/checkout@v5` (or current latest stable)
- `actions/setup-node@v4` → `actions/setup-node@v5`
- `actions/upload-artifact@v4` → `actions/upload-artifact@v5`
- `pnpm/action-setup@v4` → `pnpm/action-setup@v5`

(Verify each exists at the bumped version via `gh api repos/<owner>/<action>/releases/latest`.)

Keep `node-version: "22"` — do **not** bump CI Node to 24. Vercel and the service Docker both run Node 22; CI must match.

- [ ] **Step 5: Validate workflow syntax**

```bash
# If actionlint is available:
actionlint .github/workflows/*.yml
# Otherwise, push to a feature branch and rely on GitHub's syntax validation.
```

- [ ] **Step 6: Universal pre-push gate.**

- [ ] **Step 7: Commit + push + PR + review + merge.**

Title: `chore(deps): service refresh + GitHub Actions bumps (A1 PR 5/5)`.

- [ ] **Step 8: Universal post-merge protocol.**

---

## Task 6: A1 final verification

**No new branch.** Run from main (worktree at `.worktrees/deps-a1/` checked out at `main` with the latest five merge commits).

### Steps

- [ ] **Step 1: Pull main and reinstall**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1
git checkout main && git pull --ff-only
pnpm install --frozen-lockfile
```

- [ ] **Step 2: Confirm zero major-version diffs in frontend**

```bash
pnpm outdated
```

Expected: no `Current` column entry has a different major from `Latest`. Patches and minor diffs are acceptable. If a major remains, document why (e.g., upstream bug blocking us) in this plan as a deviation note.

- [ ] **Step 3: Confirm zero major-version diffs in service**

```bash
cd /home/xingdi/code/youtubeai_chat/youtube-ai-service
npm outdated
cd -
```

- [ ] **Step 4: Confirm no `"latest"` constraints**

```bash
grep '"latest"' /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1/package.json \
  /home/xingdi/code/youtubeai_chat/youtube-ai-service/package.json
```

Expected: no output (no matches).

- [ ] **Step 5: Confirm CI green**

```bash
gh run list --workflow=ci.yml --limit 1
gh run list --workflow=smoke --limit 1
```

Both should show `success` on the latest main commit.

- [ ] **Step 6: Confirm dev runs clean**

```bash
pnpm dev
```

Open browser, sign in, summarize a video, sign out. Verify no console deprecation warnings. Stop server.

- [ ] **Step 7: Run full smoke against prod**

```bash
set -a && . ~/.config/claude-test-creds/youtubeai.env && set +a
BASE_URL=https://www.youtubeai.chat PROD_URL=https://www.youtubeai.chat \
  pnpm exec playwright test --workers=1 --reporter=list
```

Expected: all specs pass. Permitted flake: at most 1 of the prod-rate-limited tests on the first run; retry once. If repeated failure, the deployed version of A1 has a regression — investigate.

- [ ] **Step 8: Update CONTRIBUTING.md**

If any developer-facing workflow changed (lint config, new dev commands, version constraints), add a note to `CONTRIBUTING.md`. Likely additions: TS 6 install requirement (in case engineers were on an older TS).

- [ ] **Step 9: Report back to user**

Summary message including: 5 PR numbers + merge commits, per-PR scope recap, total tests passing, coverage drift (if any), any deviations from the spec, and confirmation A1 is complete and B is unblocked.

---

## Plan self-review (ran by writer)

**Spec coverage:**
- Section 1 Goal — Tasks 1–5 implement; Task 6 verifies. ✓
- Section 2 Architecture — Tasks 1–5 are the five PRs in foundation-first order. ✓
- Section 3 per-PR scope — Each PR's "Files likely touched" + steps map to spec scope. ✓
- Section 4 Inter-PR contracts — Universal pre-flight enforces "fresh from main"; strict serial order documented. ✓
- Section 5 Error handling — Universal post-merge protocol covers smoke-red revert; in-PR escalation triggers in spec section 5 are referenced for the implementer subagent. ✓
- Section 6 Testing — Universal pre-push gate enforces lint/tsc/test/build/dev-warning-free. Task 4 + 6 add visual spot-check via playwright skill. ✓
- Section 7 Success criteria — Task 6 explicitly verifies all 8 bullets. ✓
- Section 8 Out of scope — Tasks include only the bumps and migration touchpoints. ✓
- Section 9 Risks — Plan includes manual visual spot-check (Task 4 step 8), separate-repo handling note (Task 3 step 11), and `tsc --noEmit` as a mandatory pre-push gate (covers the A0 typecheck-gap risk). ✓
- Section 10 Process — Universal sections + per-task PR/review/merge steps. ✓

**Placeholder scan:**
- "[list resolved during step 4 — actual app-code changes made]" in Task 1 step 10 commit body — this is a **dynamic list** the implementer fills based on their fixes. Not a placeholder for me; it's an instruction to the executor. Acceptable.

**Type consistency:**
- Branch names consistent (`chore/deps-a1-N-<slug>`). ✓
- PR titles consistent format (`chore(deps): ... (A1 PR N/5)`). ✓
- Worktree path repeated identically. ✓
- "Universal pre-push gate" and "Universal post-merge protocol" referenced consistently. ✓

No issues found.
