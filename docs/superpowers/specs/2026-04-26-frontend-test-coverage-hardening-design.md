# Frontend test-coverage hardening

**Date:** 2026-04-26
**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Owner:** xingdi

## Problem

The next planned cycle is an aggressive dependency modernization (Next.js, React, Zod, Recharts, Radix, etc.) — a "latest of all libs" sweep with framework majors on the table. Aggressive bumps with thin regression coverage produce silent prod failures and slow, painful bisection.

Current frontend coverage is uneven:

- **Strong:** API routes (`app/api/health`, `app/api/summarize/stream`) and almost every `lib/services/*` module have Vitest tests. `lib/utils/*` and `lib/prompts/*` are covered. The service repo (`youtube-ai-service`) has 212+ tests and is not in scope for this cycle.
- **Thin:** End-to-end coverage is two specs (`e2e-summarize`, `e2e-language-picker`). No auth flow E2E. No regression test locking the recent zh-caption fix. No coverage of orchestration hooks (`useYouTubeSummarizer`). No coverage tooling, no CI gate.

This spec hardens the frontend before the upgrade cycle, so behavior changes introduced by dependency bumps surface as failing tests rather than user reports.

## Goal

Get the frontend to a place where the upcoming dependency-modernization PRs can land with confidence: every critical user journey has an E2E spec, every API route and orchestration service has an integration test, every non-trivial hook has a unit test, and CI enforces a coverage floor so the suite cannot quietly rot.

Non-goals:

- Achieving a high global coverage percentage. The goal is regression-catching, not number-chasing. The CI floor is a *low* alarm threshold, not a target.
- Visual regression testing. Deferred to the design-system cycle (B), where it is load-bearing.
- Component-render tests for `components/ui/*` shadcn primitives — third-party scaffolding.
- Page-level snapshot tests — brittle, low value.
- Expanding `youtube-ai-service` coverage — already strong.
- Mutation testing, performance budgets — out of scope.

## Approach

**Test pyramid: Testing Trophy.** Heavy weight on E2E (real-stack) and integration (real route handlers + Zod schemas, mocked at the `fetch` boundary), thin layer of unit tests for pure logic only. Trophy survives upgrades; classic pyramid breaks on every refactor because it tests implementation details.

**Tier-by-tier mocking altitudes:**

| Tier | Tool | Where it runs | Mocks | Asserts |
|---|---|---|---|---|
| **E2E** | Playwright | `pnpm dev` (CI) + `https://www.youtubeai.chat` (post-deploy smoke) | Nothing on the happy path — real Supabase auth (test creds), real VPS, real LLM. **Failure-path tests only**: Playwright `page.route()` interception to simulate network failures (e.g. VPS unreachable) when the real failure mode cannot be reliably triggered. | User-visible behavior end-to-end |
| **Integration** | Vitest | Node, in-process | `globalThis.fetch` via `vi.fn()` per test; Supabase admin client mocked | Route handlers + service orchestration with real schemas, real composition |
| **Unit** | Vitest | Node, in-process | Everything except the unit under test | Pure logic only |

**Why `vi.fn()` over MSW for integration:** ~10 routes total. MSW pays off at scale; we'd be adding a dependency for ergonomics we don't need yet. Revisit if route count grows past ~30 or if we want to share request handlers between integration and E2E.

**Test code organization:** stays as-is — colocated `__tests__/` next to source. Already the codebase convention.

## Surface list

### E2E specs to add (`smoke-tests/`)

Existing: `e2e-summarize.spec.ts`, `e2e-language-picker.spec.ts`. Add:

1. `e2e-auth-signup.spec.ts` — signup form → confirm landing page renders. Uses a fresh randomized email per run (e.g. `signup-test-${randomUUID()}@example.test`) to ensure signup is not a no-op against an existing user. Cleanup via `supabase.auth.admin.deleteUser` in test teardown so test users do not accumulate.
2. `e2e-auth-login.spec.ts` — login → logout round-trip; assert authenticated state on home page after login, unauthenticated state after logout.
3. `e2e-auth-password-reset.spec.ts` — forgot-password → reset link → update-password → re-login. Bypasses real email by calling `supabase.auth.admin.generateLink({ type: 'recovery', email })` from the test (admin client, service-role key from test creds) to obtain the recovery link directly, then driving the browser through it.
4. `e2e-summary-cjk.spec.ts` — Chinese (`xMZqTuLWSA4`) and Japanese videos render summaries containing `\p{Script=Han}` / `\p{Script=Hiragana}` characters. Locks the recent zh-caption fix as a regression test.
5. `e2e-summary-errors.spec.ts` — invalid YouTube URL, age-restricted video, VPS unreachable (mock at network layer via Playwright route interception). Asserts user-visible error UI, not silent failure.
6. `e2e-summary-rate-limit.spec.ts` — exhaust the per-user rate limit; assert paywall/limit UI renders.
7. `e2e-landing-to-summary.spec.ts` — `app/page.tsx` CTA → URL submitted → streaming render; covers the landing-page hero CTA path that bypasses direct `/summary?url=` deep links.

### Integration specs to add

Existing integration coverage is strong. Gaps:

- `lib/services/__tests__/models.test.ts` — `lib/services/models.ts` is currently untested.
- `lib/supabase/__tests__/middleware.test.ts` — auth-redirect / session-refresh logic. Mock the Supabase server client.
- Audit `lib/services/__tests__/llm-client.test.ts` for SSE edge cases (chunk fragmentation across reads, empty deltas, error frames mid-stream); expand if the audit shows gaps.

### Unit specs to add

Existing unit coverage is strong. Gaps:

- `lib/hooks/__tests__/useClipboard.test.ts` — clipboard write success / failure paths.
- `lib/hooks/__tests__/usePersistedUrl.test.ts` — localStorage round-trip, hydration, malformed-value handling.
- `lib/hooks/__tests__/useYouTubeSummarizer.test.ts` — orchestration hook driving the streaming flow. Highest value-per-test in this batch. Mock `fetch` at the boundary (`vi.fn()`) and assert the state machine the hook exposes (idle → fetching → streaming → done; error transitions; abort).

## Tooling

- **`@vitest/coverage-v8`** added as a devDependency.
- **`vitest.config.ts`** updated with:
  ```ts
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json-summary'],
    thresholds: { lines: 50, branches: 40, functions: 50, statements: 50 },
    exclude: [
      'components/ui/**',
      'app/**/page.tsx',
      'app/**/layout.tsx',
      '**/*.config.*',
      'smoke-tests/**',
      'node_modules/**',
      '.next/**',
    ],
  }
  ```
  Thresholds are *floors* — regression alarms, not targets. If they fire on unrelated PRs in early A1 work, lower the floor or expand exclusions; don't write filler tests to clear the gate.
- **CI**: extend `.github/workflows/ci.yml` to run `pnpm test --coverage`. Build fails if any threshold drops below floor. Coverage summary visible in CI logs (no extra GitHub Actions integration; revisit if PR-comment visibility becomes a felt need).
- **Playwright E2E**: `pnpm smoke:e2e` continues to run as it does today (against `pnpm dev` in CI runner; a dedicated post-deploy run against `https://www.youtubeai.chat` after each PR merges).

## Test-data strategy

- **E2E auth:** uses the existing test user at `~/.config/claude-test-creds/youtubeai.env` for login/logout/summary flows. The same creds file holds (or will be extended to hold) a Supabase service-role key, used by the signup and password-reset specs to generate confirmation/recovery links directly via `supabase.auth.admin` and to clean up randomized signup users in teardown — bypassing real email entirely.
- **E2E summary:** real VPS, real LLM. Costs token spend per CI run; acceptable at current PR cadence. Revisit if CI volume grows.
- **Integration:** inline fixtures in test files; no shared fixture file unless reuse appears.
- **Unit:** pure inputs.

## Test policy (codified in `CONTRIBUTING.md`)

A new `## Testing` section in `youtubeai_chat_frontend/CONTRIBUTING.md` documents the contributor expectations. ~30 lines. Content:

- **New API route?** → Integration test required, colocated in `app/api/<route>/__tests__/route.test.ts`. Mock `globalThis.fetch` with `vi.fn()`. Use the real Zod schema; no schema mocking.
- **New `lib/services/*` module?** → Integration test required if it composes other modules; unit test if pure.
- **New `lib/hooks/*`?** → Unit test required if it has state or side-effects; skip for trivial wrappers.
- **New user-visible flow** (anything routable a user reaches)? → E2E spec required.
- **New `components/*` (non-`ui/`) component?** → Optional. Add a unit test only for non-trivial logic; rely on the E2E for the flow it participates in.
- **Bug fix?** → Add a regression test at the lowest tier that exercises the fix (unit if possible, integration if needed, E2E if user-visible).

## Definition of done

1. Every surface in the surface list has a passing test in its tier.
2. `pnpm test` passes locally and in CI.
3. `pnpm test --coverage` passes the configured floor on `main`.
4. `pnpm smoke:e2e` passes against `pnpm dev` locally.
5. `CONTRIBUTING.md` `## Testing` section merged.
6. One full Playwright E2E run against `https://www.youtubeai.chat` after the last A0 PR deploys.

## Risk and rollback

- Each new test is additive — no risk to product code.
- The coverage gate may be too aggressive at first. Mitigation: keep the floor low (50%/40%/50%/50%); if it fires on unrelated PRs, lower the floor or expand exclusions. Do not respond by writing filler tests.
- A new E2E spec might be flaky against real VPS / real LLM. Mitigation: mark the offending case `test.fixme` rather than blocking CI; track the flake in a follow-up. The E2E suite must not become a "rerun until green" liability.

## Out of scope (future cycles)

- **A1 — Dependency modernization.** Sequential follow-on. Assumes A0 is done.
- **B — Design-system rebuild.** Sequential after A1. Visual regression testing belongs to B, not A0.
- **Service-repo coverage expansion.** `youtube-ai-service` already at 212+ tests. Defer until a felt gap appears.
- **Mutation testing, performance budgets, accessibility test gates.** Interesting but not required for upgrade safety. Revisit independently.
