# B: Design System Rebuild Design

**Status:** Approved (pending user review of written spec)
**Owner:** Steven Tan
**Decomposition parent:** Original brainstorm decomposed into A0 (test-coverage hardening, complete), A1 (dependency modernization, complete), B (this).
**Predecessor:** A1 — modernized substrate (Next 16 / React 19 / Tailwind 4.2 / TypeScript 6 / zod 4).
**Successor:** Future cycles for brand identity, marketing-component refactor, internationalization audit.

---

## 1. Goal

Bring the design system to enterprise-grade on the modern foundation A1 just established. Comprehensive design tokens + governed 47-component library + MDX docs + Vitest/axe coverage. Optimized for Claude (the agent) to design effectively within: read MDX, trust types, never need to hand-roll Tailwind or invent values.

The user's stated goal: "redo/improve our existing design system to a enterprise level production codebase, so that we can use claude design the best way." The "Claude design effectively" phrase shapes every decision below — Claude reads files, not interactive UIs, so MDX > Storybook. Claude reads types, so token interfaces matter more than runtime examples.

User has accepted breakage risk during A1 ("fine to have downtime, didn't officially release") — same posture applies here.

---

## 2. Architecture

Six sequential PRs, **vertical-slice phasing**, no parallelism. Each PR cuts a fresh branch from `origin/main`. Same merge model as A1 — single PR in flight, smoke green required between PRs, revert if smoke red.

| PR | Title                          | Cluster                | Surface                                                                                                              |
|----|--------------------------------|------------------------|----------------------------------------------------------------------------------------------------------------------|
| 1  | Token foundation               | _system_               | Tailwind 4 `@theme` tokens (typography, spacing, radius, shadow, gradient, blur, motion) + retrofit `input-form.tsx` |
| 2  | Forms cluster                  | 8 components           | button, input, label, form, checkbox, radio-group, switch, textarea                                                  |
| 3  | Containers cluster             | 9 components           | card, dialog, popover, drawer, sheet, alert-dialog, tooltip, hover-card, aspect-ratio                                |
| 4  | Navigation cluster             | 7 components           | navigation-menu, menubar, tabs, breadcrumb, pagination, command, dropdown-menu                                       |
| 5  | Data display cluster           | 11 components          | table, badge, avatar, alert, progress, skeleton, separator, scroll-area, sonner (toast), chart, google-icon          |
| 6  | Composites cluster             | 12 components          | sidebar, calendar, accordion, collapsible, carousel, slider, toggle, toggle-group, context-menu, input-otp, resizable, select |

Total components governed: **47** (matches the existing `components/ui/` count of 47 `.tsx` files). PR 1 is foundational; PRs 2-6 are independent post-tokens and ship complete subsets (audit + MDX + tests in one PR per cluster).

### Why vertical slices over layer-based

User chose vertical slices. Reasoning: each cluster PR delivers an immediately-usable, complete subset — Claude can design with the forms cluster while the navigation cluster is still in progress. Smaller PRs are easier to review. Process gaps in the docs/tests pipeline get caught on PR 2 (forms) instead of buried in a wide layer-PR.

### Why MDX docs over Storybook

User chose MDX. Reasoning: Claude reads files; Storybook's strongest features (interactive playground, visual regression addons) help humans, not the agent. MDX gives human-renderable docs *and* Claude-readable source in one artifact, with no separate build pipeline.

### Why behavior + a11y testing without visual regression

User chose option 2. Reasoning: visual regression is high-maintenance (snapshot churn, font flake across CI runners) with weak ROI for a single-engineer review process. axe + Vitest catches the high-impact regressions (a11y bugs, broken prop passing, ref forwarding mistakes). Visual deltas surface in PR review.

---

## 3. Per-PR scope detail

### PR 1: Token foundation + `input-form.tsx` retrofit

**Goal:** Establish the design token vocabulary in Tailwind 4 `@theme` directive; retrofit the one known offender (`app/components/input-form.tsx`) to prove the tokens cover all needed cases.

**Token surfaces to define** (all expressed as Tailwind 4 `@theme` CSS in `app/globals.css`, adopting the Tailwind 4 native pattern):
- **Typography scale**: `text-display`, `text-h1`–`text-h6`, `text-body-lg/md/sm/xs`, `text-caption`, with paired line-heights and letter-spacing tokens.
- **Spacing scale**: `space-px`, `space-1` through `space-32` (canonical 4px-grid scale matching Tailwind defaults but explicit) — eliminate the unused `--spacing-4`/`--spacing-8` placeholders in current globals.css.
- **Radius scale**: `radius-none`, `radius-xs`, `radius-sm`, `radius-md` (current `--radius`), `radius-lg`, `radius-xl`, `radius-full` — current single `--radius: 0.5rem` is insufficient.
- **Shadow scale**: `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-inner` — currently undefined; components hand-roll.
- **Gradient tokens**: `gradient-brand-primary` (formalize current purple/cyan from `input-form.tsx` lines ~132), `gradient-brand-soft` (subtle backdrop variant), `gradient-error`, `gradient-success` if needed.
- **Blur scale**: `blur-sm`, `blur-md`, `blur-lg`, `blur-xl`, `blur-2xl` — currently `blur-sm`/`blur-xl` hand-rolled in input-form.
- **Motion tokens**: `duration-fast` (150ms), `duration-base` (250ms), `duration-slow` (400ms); `ease-out-soft`, `ease-in-out-soft` — currently inconsistent across components.

**Retrofit target**: `app/components/input-form.tsx`. Replace:
- `containerBg`/`inputAreaBg` theme-conditional Tailwind ternaries (lines 30-40) with semantic token classes that resolve via dark mode automatically.
- `from-purple-500 to-cyan-500` (line ~132) with `bg-[image:var(--gradient-brand-primary)]` or equivalent.
- Arbitrary `blur-sm`/`blur-xl` (lines ~76, 92) with named `blur-md`/`blur-xl` from new scale.

**Deliverable**: token vocabulary documented in MDX (one doc page per token type — `docs/design-system/tokens/typography.mdx`, `…/spacing.mdx`, etc.), plus `input-form.tsx` retrofitted and visually identical (or intentionally improved — capture before/after screenshots in PR description).

### PRs 2-6: Cluster pipeline

Each cluster PR follows the same pipeline. Components per cluster listed in section 2.

**Per component**:

1. **Prop API audit** — verify CVA variants, ref forwarding (`React.forwardRef` or React 19 ref-as-prop), `data-slot` attributes, native prop spreading, focus-visible ring styling. Normalize against the canonical pattern (likely Button as reference). Flag inconsistencies.
2. **Apply tokens** — replace any hand-rolled values with tokens from PR 1.
3. **MDX doc** — `docs/design-system/components/<name>.mdx`. Sections: overview, prop API table (auto-generatable from TS interface where feasible), variants (visual examples via TSX code blocks), accessibility notes (which Radix primitive backs it, what ARIA attributes are auto-applied, what's the consumer's responsibility), composition examples.
4. **Vitest component test** — `components/ui/__tests__/<name>.test.tsx`. Behavior: variants render correctly, prop spreading works, refs forward, controlled/uncontrolled modes work, key edge cases.
5. **axe a11y test** — `components/ui/__tests__/<name>.a11y.test.tsx`. Renders default + each variant + edge states (disabled, error, loading), runs axe, asserts zero violations.

**Cluster-level deliverables**:
- Cluster index MDX page (`docs/design-system/components/forms/index.mdx`) introducing the cluster's domain and listing components.
- Test snippet pattern: shared helpers (`tests-utils/renderWithProviders`, `tests-utils/axe`) in PR 2 if not already present; reused across PRs 3-6.
- Updated CONTRIBUTING.md or new `docs/design-system/CONTRIBUTING.md` describing the pipeline (tokens → audit → docs → tests).

---

## 4. Inter-PR contracts / data flow

```
PR 1 (tokens)
  │
  ├─► PR 2 (forms)    ← independent post-tokens
  ├─► PR 3 (containers)
  ├─► PR 4 (navigation)
  ├─► PR 5 (data display)
  └─► PR 6 (composites)
```

PRs 2-6 are independent post-PR-1 in principle, but per the user's serial-merge preference we land them in numerical order. Each branch is fresh from `origin/main` after the prior PR has merged.

**Token vocabulary frozen at PR 1 merge.** If a cluster PR discovers a missing token (e.g., a new shadow level), the implementer adds it to the foundation in that PR with a one-line note in the PR body, but never silently. The token vocabulary must remain coherent.

**MDX site infrastructure** (Next route to render `docs/**/*.mdx` if browsable docs are desired) is **scaffolded in PR 1**, populated incrementally PRs 2-6. If we don't render MDX as a site (Claude reads source), the scaffolding step in PR 1 reduces to writing a `docs/design-system/README.md` index pointing at the cluster MDX files.

---

## 5. Error handling / rollback

Same model as A1.

| Mode                                  | Response                                                                                          |
|---------------------------------------|---------------------------------------------------------------------------------------------------|
| CI red before merge                   | Implementer iterates within PR.                                                                   |
| CI green, smoke red post-deploy       | Revert PR (squash-revert), root-cause, retry as fresh PR.                                         |
| Production regression past smoke      | Revert. Add regression test. Re-attempt.                                                          |
| Implementer agent BLOCKED             | Re-dispatch with more context, more capable model, or break into smaller pieces.                  |
| Token vocabulary discovers gap mid-cluster | Add to PR 1's tokens layer in the current cluster PR with rationale; never silently introduce. |

**Hard escalation triggers (subagent must surface, not push through):**
- A token name decision requires product/brand input (e.g., "what's the brand purple's exact hex?"). Default to preserving current values; surface for confirmation.
- A component's audit reveals a bug that requires runtime behavior change (vs. just docs/tests). Out of scope for B; surface and create a follow-up.
- A test must be **deleted** (not updated) to make the suite pass.
- More than 3 components in a single cluster require breaking changes to consumer call sites (would imply A1 missed something).

---

## 6. Testing strategy

**Per-component**:
- **Vitest component test** (`components/ui/__tests__/<name>.test.tsx`): behavior assertions using Testing Library. Covers: each variant renders correct DOM, prop spreading works, refs forward, controlled/uncontrolled modes (where applicable), keyboard interactions for interactive components, edge cases (disabled, error, loading, empty).
- **axe a11y test** (`components/ui/__tests__/<name>.a11y.test.tsx`): renders default state + each variant + edge states; runs `axe.run()`; asserts `violations.length === 0`. Use `jest-axe` (Vitest-compatible) or `@axe-core/playwright` patterns adapted to Vitest.

**Per-cluster**:
- Sub-suite passes locally via `pnpm test components/ui/<cluster>` before push.

**Per-PR**:
- Universal pre-push gate (same as A1): lint, tsc, test --run, build, dev-warning-free, one Playwright spec smoke. Plus: vitest coverage now includes `components/ui/**` (currently excluded).

**Coverage floor revision**: A0 set 50/40/50/50 with `components/ui/**` excluded. PR 1 of B updates `vitest.config.ts` to include `components/ui/**` in coverage scope. New floor: same 50/40/50/50 but now includes the design-system components. By PR 6, expect coverage on `components/ui/**` to be in the 70-90% range based on the per-component tests.

---

## 7. Token & component naming policy

**Tokens** follow Tailwind 4 `@theme` conventions:
- Categorical prefix: `--font-*`, `--text-*`, `--leading-*`, `--tracking-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--gradient-*`, `--blur-*`, `--ease-*`, `--duration-*`.
- Semantic where appropriate: `--color-brand-primary` (not `--purple-500`), `--gradient-brand-primary`.
- No raw aliases that duplicate Tailwind defaults — only deviations get tokens.

**Components** keep current naming (`button.tsx`, `card.tsx`, etc.). No renames in B.

**MDX docs** filenames mirror component names: `docs/design-system/components/button.mdx`.

**Test files** colocate: `components/ui/__tests__/button.test.tsx`, `components/ui/__tests__/button.a11y.test.tsx`.

---

## 8. Success criteria

B is done when **all** of the following hold:

1. Every token category (typography, spacing, radius, shadow, gradient, blur, motion) defined in `@theme` and documented in MDX.
2. `app/components/input-form.tsx` contains zero arbitrary Tailwind values (no `bg-[#…]`, no `from-purple-500 to-cyan-500`, no theme-conditional ternaries on color).
3. All 47 components in `components/ui/` have:
   - Audited prop API matching the canonical pattern (Button as reference)
   - MDX doc with overview, prop table, variants, a11y notes, composition examples
   - Vitest component test covering variants + key edge cases
   - axe a11y test asserting zero violations across variants/states
4. `vitest.config.ts` includes `components/ui/**` in coverage scope; floor 50/40/50/50.
5. `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test --coverage --run`, `pnpm build` all clean.
6. Smoke workflow green on post-B main.
7. README updated with a pointer to `docs/design-system/`.
8. A `grep -rE "bg-\[#|text-\[#|from-[a-z]+-[0-9]+ to-[a-z]+-[0-9]+|className=.*?\?.*?:" app/ components/` returns no hits in app code (only in test fixtures or component internals where intentional).

Then B unblocks future product iterations on the design system (brand redesign, new components, marketing surface refactor).

---

## 9. Out of scope

- **Brand identity decisions** — primary color shift, typography family change, logo work. The current visual identity (shadcn neutrals + purple/cyan accent gradient) is preserved and *formalized* in tokens. Brand redesign is its own milestone.
- **Storybook setup** — chose MDX.
- **Visual regression testing** — chose behavior + a11y only.
- **Component additions beyond 47** — only governing what already exists.
- **Component removals** — chose to keep all 47 (option 1).
- **Marketing-component refactor** beyond `input-form.tsx` retrofit. The other `app/components/*` files (hero-section, faq, benefits, etc.) get token-applied if it falls naturally out of cluster work, but are not in B's primary scope.
- **i18n / locale work** — separate concern.
- **Accessibility patterns guide** (skip links, semantic toggle/disclosure patterns) beyond per-component axe tests — deferred to a future a11y-focused milestone.
- **Custom brand theme infrastructure** — was Phase 4 in initial decomposition; user picked Phase 1+2+3 only.

---

## 10. Risks and known unknowns

- **MDX rendering route** — if we add a Next route to render `docs/**/*.mdx` as a browsable site, that's net-new infra to design (auth gating? public? deploy?). Recommendation: scaffold as **un-rendered** (just files in `docs/`) for B; add a Next route in a future cycle if humans want to browse. Claude reads files anyway.
- **axe + happy-dom compatibility** — `jest-axe` is Vitest-compatible but happy-dom 20 may have quirks not present in jsdom. PR 2 (the first to add a11y tests) needs to verify axe runs cleanly in our test environment; if not, fall back to running a11y tests against Playwright (`@axe-core/playwright`) on a subset of components.
- **Token retrofit visual diff** — formalizing the purple/cyan gradient and applying named blur/shadow tokens to `input-form.tsx` should be visually identical. If something shifts (e.g., we discover the current gradient was actually `from-purple-600 via-pink-500 to-cyan-500` on a different render path), surface as a brand-decision escalation rather than silently committing the change.
- **Tailwind 4 `@theme` directive maturity** — Tailwind 4 is recent. Edge cases around `@theme inline` vs `@theme` for static values may surface. Spec assumes the standard `@theme` pattern; PR 1's research will confirm.
- **`react-hooks/set-state-in-effect`/`set-state-in-render`/`purity` rules** disabled in PR 1 of A1 — B is the natural place to re-enable them. The audit found ~10 violations across `app/components/*`, `app/summary/components/*`, `lib/hooks/*`, `components/ui/carousel.tsx`. Each cluster PR that touches an offending file should fix the violation; PR 6 (composites includes carousel) explicitly re-enables the rules in `eslint.config.mjs`.

---

## 11. Process

- **Workspace:** Reuse the worktree at `.worktrees/deps-a1/` from A1 (already on `origin/main`). Each PR cuts a fresh branch from `origin/main`.
- **Implementation mode:** `superpowers:subagent-driven-development` — fresh subagent per PR with two-stage review (spec compliance → code quality).
- **Pre-merge review:** `pr-review-toolkit:review-pr` runs on every PR. Address findings before merge.
- **Auto-merge:** squash-merge on green CI, delete branch.
- **Post-merge:** watch smoke workflow on merge commit. Revert if red.
- **Reporting:** single status report when all six PRs are merged.
