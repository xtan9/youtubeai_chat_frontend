# A1: Dependency Modernization Design

**Status:** Approved
**Owner:** Steven Tan
**Decomposition parent:** Original brainstorm decomposed into A0 (test-coverage hardening, complete), A1 (this), B (design-system rebuild, future).
**Predecessor:** A0 — frontend test-coverage hardening (491 tests, 89.56% coverage, 9 prod-targeted E2E specs). The new test suite is the regression net for A1.
**Successor:** B — design-system rebuild on the modernized substrate.

---

## 1. Goal

Bring `youtubeai_chat`'s dependencies to current latest-major across **frontend (`youtubeai_chat_frontend/`)**, **service (`youtube-ai-service/`)**, and **CI tooling (`.github/workflows/`)** — so the upcoming design-system rebuild (B) can land on a modern, stable foundation. No new deps. No new features. No architecture changes.

The user has explicitly accepted breakage risk: "fine to have downtime, didn't officially release the product yet." This shapes the sequencing and rollback strategy below.

---

## 2. Architecture

Five sequential PRs, **foundation-first**, no parallelism. Each PR baseline-tests on the prior PR's `main`. If any PR breaks post-deploy, revert it and rebase downstream.

| PR | Title                       | Major bumps                                                        | Ride-along minors                                                                                  |
|----|-----------------------------|--------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| 1  | Next 16 foundation          | `next`, `eslint-config-next`, `@next/third-parties` (15.5 → 16.x)  | pin floating `@supabase/ssr` + `@supabase/supabase-js`, `posthog-js`, `posthog-node`, supabase-js patch |
| 2  | Type / lint stack           | `typescript` 5.9 → 6.0, `eslint` 9 → 10, `@types/node` 20 → 22 (track Node 22, the runtime on Vercel + service Docker + CI)     | none                                                                                               |
| 3  | zod 4                       | `zod` 3 → 4 in **both** packages (frontend + service)              | `react-hook-form` patch                                                                            |
| 4  | UI / test majors            | `recharts` 2 → 3, `lucide-react` 0.511 → 1.x, `react-resizable-panels` 3 → 4, `happy-dom` 15 → 20 | tailwind patches, `@tanstack/react-query` minor batch, vitest patches |
| 5  | Service refresh + tooling   | `youtube-ai-service` vitest 3 → 4, `@types/node` 22 → 25           | Hono minor, `tsx`, GitHub Actions action versions, CI Node version stays at 22 (matches Vercel + service runtime — don't introduce CI/runtime drift)                                 |

**Strict order.** `chore/deps-a1-N-<title>` branch per PR, branched off latest `origin/main`. Implementer agent works in subagent-driven-development mode; pr-review-toolkit runs before merge; auto-merge on green CI.

### Why foundation-first

User chose foundation-first sequencing over risk-balanced. The argument: Next 16 is the largest delta — when it breaks, we want unambiguous attribution. Risk-balanced would back-load Next, which means a Next-16-induced regression could be confused with a zod-4-induced one if both are in flight.

### Why these groupings

- **PR 1** bundles companion deps that *must* move with Next (`eslint-config-next`, `@next/third-parties`) and bundles the floating-`"latest"` Supabase pin because we're already touching `package.json` and the lockfile.
- **PR 2** can't land before PR 1 because `eslint-config-next 16` is required to lint Next 16 code.
- **PR 3** keeps zod in lockstep across `youtubeai_chat_frontend/` and `youtube-ai-service/` (both currently at v3). Splitting them would create a transient state where the frontend and service speak different validator versions.
- **PR 4** batches the leaf UI majors and the test-environment major (`happy-dom`). They don't depend on each other in any meaningful way; bundling reduces CI cycles.
- **PR 5** finishes the service-side dep refresh and CI tooling cleanup (the GitHub Actions Node-20 deprecation warning we observed during A0 final verification).

---

## 3. Components — per-PR scope detail

### PR 1: Next 16 foundation

**Bumps:**
- `next` 15.5.15 → 16.2.x
- `eslint-config-next` 15.5.15 → 16.2.x
- `@next/third-parties` 15.5.15 → 16.2.x
- Pin `@supabase/ssr` (currently `"latest"`) to current resolved version
- Pin `@supabase/supabase-js` (currently `"latest"`) to current resolved version
- Ride-along: `posthog-js`, `posthog-node` patch versions

**App-code migration touchpoints (researcher will dig deeper in plan phase):**
- App Router config rename if any
- `cookies()` / `headers()` async-vs-sync semantics
- Middleware signature
- Route-handler response shape
- Removed deprecated APIs (legacy `next/router`, etc.)
- Turbopack defaults (now stable)

**Surface to verify:**
- All `app/api/**/route.ts` route handlers compile and run
- `middleware.ts` behavior unchanged (auth gating)
- `next.config.ts` valid against new schema
- `pnpm dev`, `pnpm build` clean
- A0's full test suite passes
- Smoke workflow green post-deploy

### PR 2: Type / lint stack

**Bumps:**
- `typescript` 5.9 → 6.0
- `eslint` 9 → 10
- `@types/node` 20 → 22 (track Node 22 — the runtime on Vercel deploys, service Docker `node:22-slim`, and CI `setup-node` matrix)

**Likely friction points:**
- TS 6 stricter narrowing in some control-flow paths
- ESLint 10 flat-config required (we're already using flat config in `eslint.config.mjs`, so should be smooth)
- Removed deprecated TS compiler options

### PR 3: zod 4 (both packages)

**Bumps:**
- `zod` 3 → 4 in `youtubeai_chat_frontend/`
- `zod` 3 → 4 in `youtube-ai-service/`
- Ride-along: `react-hook-form` patch in frontend

**Migration touchpoints:**
- `z.string().email()` → `z.email()` (and analogous changes for `url`, `uuid`, etc.)
- `.refine()` callback shape changes if any
- Inferred-type changes for unions (`z.infer<>`)
- Every form schema, every API validator, every env-var validator

**Why both packages in one PR:** The frontend and service exchange zod-validated payloads. Mixing zod 3 ↔ zod 4 at the wire would create transient inconsistency and a non-deterministic test surface.

### PR 4: UI / test majors

**Bumps:**
- `recharts` 2.15 → 3.x — chart component API rewrite
- `lucide-react` 0.511 → 1.x — graduation to 1.0; some icons renamed/removed
- `react-resizable-panels` 3 → 4 — API changes
- `happy-dom` 15 → 20 — test environment quirks
- Ride-along: `tailwindcss` patches, `@tanstack/react-query` 5.99 → 5.100 family, `vitest` patches

**Surface to verify (manual spot-check before push):**
- Every chart component visually renders the same
- Every icon used appears (run `grep -r "from \"lucide-react\"" app components` and verify no missing-icon imports at build time)
- Resizable panels (if present in current UI) still work
- Hook tests under `lib/hooks/__tests__/` still pass under happy-dom 20

### PR 5: Service refresh + tooling

**Service deps:**
- `youtube-ai-service`: `hono` minor, `vitest` 3 → 4 (frontend already on 4), `tsx` patch, `@types/node` 22 → 22 latest (already correct major), `typescript` 5.7 → 6.0 (tracks the frontend TS 6 jump from PR 2 — keeps stack uniform)
- Verify `youtube-transcript-plus` 2.x still on latest (likely no major)

**CI tooling:**
- `.github/workflows/ci.yml`, `smoke.yml`, `db-migrate.yml`: bump `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `pnpm/action-setup` to latest stable. (We saw the Node-20 deprecation warning during A0 verification.)
- `setup-node` Node version stays at 22 (Vercel and service Docker both run Node 22; bumping CI to 24 would create drift the smoke workflow can't catch)

---

## 4. Data flow / inter-PR contracts

```
PR 1 (Next 16)  ─────►  PR 2 (TS/ESLint)  ─────►  PR 3 (zod 4)  ─────►  PR 4 (UI majors)  ─────►  PR 5 (service+tooling)
   ▲                       ▲ depends on PR 1
   │                       │ (eslint-config-next 16)
   │
   └── Pin floating Supabase rides here
```

Each PR's branch is created **fresh from `origin/main`** after the prior PR has merged. No long-lived branches; no cross-PR rebasing chains. A0 used the same model.

**Hidden contract:** A0's test suite (491 tests + 9 E2E specs) and the smoke workflow are expected to remain green throughout. Any drop is a regression that must be addressed within the offending PR before merge.

---

## 5. Error handling / rollback

**Per-PR failure modes:**

| Mode                                  | Response                                                                                     |
|---------------------------------------|----------------------------------------------------------------------------------------------|
| CI red before merge                   | Implementer iterates within PR until green. No special protocol.                            |
| CI green, smoke red post-deploy       | Revert the PR (squash-revert), root-cause, refine, retry as a fresh PR.                      |
| Production regression past smoke      | Revert the PR. Add a regression test (extends A0's net). Re-attempt with the test in place.  |
| Implementer agent BLOCKED             | Re-dispatch with more context, more capable model, or break the PR into smaller pieces.     |
| Two PRs would conflict on package.json | Strict-order rule prevents this — only one A1 PR in flight at a time.                        |

**Hard escalation triggers (subagent must surface to me, not silently push through):**
- A breaking change in a dep requires a product-level decision (e.g., recharts 3 changes the visual default of a user-facing chart).
- A1's footprint expands beyond "upgrade only" into refactor or feature work.
- A test must be deleted (vs. updated) to make the suite pass.
- Floating `"latest"` is reintroduced for any reason.

---

## 6. Testing strategy

For each PR, before push:

- `pnpm lint` clean
- `pnpm exec tsc --noEmit` clean (this gap caused a A0 PR re-push — pre-push TS check is mandatory)
- `pnpm test --coverage --run` — all 491 tests pass; coverage stays above the 50/40/50/50 floor from A0
- `pnpm build` succeeds
- `pnpm dev` starts cleanly with **no** new deprecation warnings in the console
- `pnpm exec playwright test` against `pnpm dev` for the change surface (spot-check, not full smoke)
- For the service PR: `npm test` in `youtube-ai-service/`

After each merge:

- The smoke workflow auto-runs on push to main. Watch for green.
- For PRs touching observable behavior (zod 4 forms, recharts 3 charts, lucide 1 icons), spot-check the affected pages in dev *and* against `https://www.youtubeai.chat` after deploy.

A0's tests are NOT just for vitest — they're a behavioral contract. If a dep upgrade requires changing test assertions, that's a signal to investigate whether real behavior changed too.

---

## 7. Success criteria

A1 is done when **all** of the following hold:

1. `pnpm outdated` in `youtubeai_chat_frontend/` shows zero major-version diffs.
2. `pnpm outdated` (or `npm outdated`) in `youtube-ai-service/` shows zero major-version diffs.
3. No `package.json` in the repo reads `"latest"` for any dep.
4. CI green: lint, typecheck, test, build, migration-upgrade-test.
5. Smoke workflow green on the post-A1 main.
6. `pnpm dev` shows no deprecation warnings.
7. README or CONTRIBUTING.md updated where developer workflow changed (e.g., new lint config, new dev commands).
8. One full smoke run against `https://www.youtubeai.chat` after the final merge passes.

Then A1 unblocks B (design-system rebuild).

---

## 8. Out of scope

- Design-system component rewrites (that's B).
- Architecture changes (App Router ↔ Pages Router, etc.).
- New features.
- Performance work / bundle-size optimization.
- New dependencies. Only existing ones get bumped.
- Database migrations (none required for upgrades).
- The `llm-gateway/` Go binary — separate stack, not in this repo's pnpm/npm graph.

---

## 9. Risks and known unknowns

- **Next 16 deprecations** may require larger app-code migrations than anticipated. If PR 1's footprint exceeds ~50 changed files outside `package.json`/`pnpm-lock.yaml`, escalate to a sub-decomposition.
- **zod 4 inference changes** could cascade through `react-hook-form` + `@hookform/resolvers` typings. PR 3's surface is potentially every form on the site.
- **lucide-react 1.0** may have renamed icons we use. Build will fail loudly; cost is mechanical rename.
- **happy-dom 20** could expose latent test bugs. A0's hook tests use specific happy-dom quirks (e.g., `Storage` instance spying in `usePersistedUrl`).
- **Vercel deploy compatibility** — Next 16 may require Vercel platform settings updates. Verify on the preview deploy of PR 1 before merging.

---

## 10. Process

- **Workspace:** single git worktree at `.worktrees/deps-a1/` (already created), reused across all five PRs. Each PR branch is created fresh off `origin/main`.
- **Implementation mode:** `superpowers:subagent-driven-development` — fresh subagent per PR with two-stage review (spec compliance → code quality).
- **Pre-merge review:** `pr-review-toolkit:review-pr` (code-reviewer + applicable specialists). Address findings before merge.
- **Auto-merge:** `gh pr merge --squash --delete-branch` after all CI checks pass.
- **Post-merge:** Watch smoke workflow on the merge commit. Revert if red.
- **Reporting:** Single status report when all five PRs are merged.
