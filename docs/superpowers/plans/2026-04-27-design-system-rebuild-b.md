# B Design System Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the design system to enterprise-grade — comprehensive design tokens + governed 47-component library + MDX docs + Vitest/axe tests — across six sequential vertical-slice PRs.

**Architecture:** All work happens in the `.worktrees/deps-a1/` worktree. Each PR cuts a fresh branch from `origin/main` after the prior PR has merged. Subagent-driven implementer per PR with two-stage review; pr-review-toolkit pre-merge; auto-merge on green CI; smoke watch on each merge commit.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind 4.2 (`@theme` directive), Radix UI, CVA, lucide-react 1, vitest 4, jest-axe (or @axe-core/playwright fallback), MDX (rendered or read-as-source).

**Spec:** `docs/superpowers/specs/2026-04-27-design-system-rebuild-b-design.md`

---

## Universal pre-flight (run before each PR's first commit)

The implementer subagent for **every** PR runs these checks first to establish a clean baseline. If any fails, stop and surface — B assumes a green starting state from A1.

- [ ] `cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1 && git fetch origin && git checkout main && git pull --ff-only`
- [ ] `git checkout -b <branch-name>` (per-PR branch name in each task)
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint` — clean
- [ ] `pnpm exec tsc --noEmit` — clean
- [ ] `pnpm test --run` — all tests pass (490+ baseline from A1)
- [ ] `pnpm build` — clean

---

## Universal pre-push gate

Run all of these green before pushing on every PR. **Pre-push tsc is mandatory** — vitest's transpiler doesn't enforce types; tsc does. A0 had a PR re-push because of this gap.

- [ ] `pnpm lint` — clean (0 warnings/errors)
- [ ] `pnpm exec tsc --noEmit` — clean
- [ ] `pnpm test --coverage --run` — all tests pass; coverage at or above 50/40/50/50 floor
- [ ] `pnpm build` — clean
- [ ] `pnpm dev` for ~10s, console shows no new deprecation warnings
- [ ] At least one Playwright spot-check spec passes locally against `pnpm dev`
- [ ] `git status` clean

If any check fails, fix in-place; do not push red.

---

## Universal post-merge protocol

After each PR is squash-merged:

- [ ] Watch the `smoke` GitHub Action triggered by push-to-main on the merge commit. Use `gh run watch <id>` or poll `gh run view <id> --json status,conclusion`.
- [ ] If `smoke` is **green**: mark task complete, proceed to next PR.
- [ ] If `smoke` is **red**: open a revert PR. Get green smoke before proceeding to next B PR.
- [ ] Document any deviation from the plan as a comment in this file (inline near the affected task).

---

## Universal per-component pipeline (used in PRs 2-6)

For **every component** in a cluster, the implementer subagent runs this pipeline. Each pass should take 15-30 minutes per component.

1. **Read source** — `components/ui/<name>.tsx`. Note CVA variants, prop interface, ref handling, slots, data-slot attributes, focus-visible styling, accessibility patterns (Radix primitive backing if any).

2. **Audit prop API against canonical** — Button (`components/ui/button.tsx`) is the canonical reference for CVA-based components; Dialog (`components/ui/dialog.tsx`) is canonical for slot-based composites; Card (`components/ui/card.tsx`) is canonical for container patterns. Verify:
   - CVA variants follow the same naming conventions
   - Native props are forwarded via spread
   - Refs forward correctly (React 19 ref-as-prop, no `forwardRef` wrapper needed)
   - `data-slot` attributes present on all distinguishable parts
   - Focus-visible ring styling matches: `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`
   - SVG sizing pattern (where applicable): `[&_svg:not([class*='size-'])]:size-4`
   - `disabled:pointer-events-none disabled:opacity-50` on interactive variants
   - `aria-invalid` styling on form inputs
   
   If a component diverges, normalize it (in-PR fix) unless the divergence is intentional and documented in the MDX doc.

3. **Apply tokens** (PRs 2-6 only — PR 1 establishes them) — replace any hand-rolled values with tokens from PR 1's `@theme` directive. Search for: `bg-[#`, `text-[#`, `from-[a-z]+-[0-9]+ to-[a-z]+-[0-9]+`, theme-conditional ternaries (`isDarkMode ? ... : ...`). All should resolve to a token.

4. **Write MDX doc** — `docs/design-system/components/<name>.mdx`. Sections (in order):
   ```mdx
   # <ComponentName>
   
   <one-paragraph overview: what does it do, when to reach for it, what's it built on>
   
   ## Import
   
   ```tsx
   import { <Name> } from "@/components/ui/<name>";
   ```
   
   ## Anatomy
   
   <component breakdown: which sub-components compose it, e.g. Card / CardHeader / CardContent / CardFooter>
   
   ## Props
   
   <prop table: name, type, default, description — derived from the TS interface>
   
   ## Variants
   
   <one TSX block per variant, with the rendered intent in a comment>
   
   ## Accessibility
   
   <which Radix primitive backs it (or "none — pure semantic HTML"), what ARIA is auto-applied, what's the consumer's responsibility (e.g. "always pair Label with Input via htmlFor / id")>
   
   ## Composition examples
   
   <2-3 realistic usage examples, e.g. Form + Input + Label + Button = login form>
   
   ## Token usage
   
   <which design tokens this component reads from — typography, spacing, shadow, radius — so consumers know what brand-shifts will affect it>
   ```

5. **Write Vitest component test** — `components/ui/__tests__/<name>.test.tsx`. Use `@testing-library/react` (already installed). Cover:
   - Default render produces expected DOM
   - Each CVA variant renders correctly
   - Props spread to the underlying element
   - Refs forward (where applicable)
   - Controlled/uncontrolled modes (where applicable, e.g. `value` vs `defaultValue`)
   - Keyboard interactions for interactive components (Tab, Enter, Space, Esc, arrow keys per Radix conventions)
   - Edge states: disabled, error/invalid, loading, empty
   
   Use `vi.fn()` for callback props. No mocking of Radix internals — test against real Radix output.

6. **Write axe a11y test** — `components/ui/__tests__/<name>.a11y.test.tsx`. Use `jest-axe` (Vitest-compatible) or fall back to `@axe-core/playwright` if happy-dom 20 incompatible (PR 2 verifies this). Cover:
   - Default render: zero violations
   - Each variant: zero violations
   - Edge states (disabled, error): zero violations
   - Use `axe.run()` with default rules; do not disable rules unless documented.

7. **Run cluster tests** — `pnpm test components/ui/<name>` should pass. Coverage on the file should hit 70%+ given the test breadth.

8. **Verify in dev** — `pnpm dev`, navigate to a page that uses the component (or use Playwright to render an MDX example) — confirm visual is unchanged from baseline.

If a component requires more than 30 minutes (e.g., complex state machine in `command` or `calendar`), check in via report-back; do not silently expand scope.

---

## Task 1: PR 1 — Token foundation + `input-form.tsx` retrofit

**Branch:** `chore/ds-b-1-tokens`
**Conventional title:** `feat(design-system): tokens foundation + input-form retrofit (B PR 1/6)`

**Files likely touched:**
- `app/globals.css` (add `@theme` directive with all token surfaces)
- `tailwind.config.ts` (possibly minimal — Tailwind 4 prefers `@theme` over config)
- `app/components/input-form.tsx` (retrofit)
- `docs/design-system/README.md` (new — index for the design system docs)
- `docs/design-system/tokens/typography.mdx`, `spacing.mdx`, `radius.mdx`, `shadow.mdx`, `gradient.mdx`, `blur.mdx`, `motion.mdx`
- `vitest.config.ts` (remove `components/ui/**` from coverage exclusions — see plan section "Coverage scope expansion" below)

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/ds-b-1-tokens`.

- [ ] **Step 2: Read Tailwind 4 `@theme` documentation**

WebFetch: `https://tailwindcss.com/docs/theme` — confirm the syntax for defining custom utility tokens (`--font-*`, `--text-*`, `--leading-*`, `--tracking-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--blur-*`, `--ease-*`, `--duration-*`). Note any v4 quirks vs the legacy `tailwind.config.ts theme.extend` pattern.

- [ ] **Step 3: Read existing globals.css and tailwind.config.ts**

Read `app/globals.css` and `tailwind.config.ts`. Identify which existing tokens are already in `@theme` (PR 2 of A1 may have moved some) vs in legacy `:root` CSS variables.

- [ ] **Step 4: Define token surfaces in `app/globals.css`**

Add `@theme` block(s) for:
- **Typography**: `--text-display`, `--text-h1` through `--text-h6`, `--text-body-lg`/`md`/`sm`/`xs`, `--text-caption`. Each with paired `--leading-*` and `--tracking-*` if non-default.
- **Spacing**: `--space-px`, `--space-0` through `--space-32` (4px grid). Eliminate the unused `--spacing-4`/`--spacing-8` placeholders.
- **Radius**: `--radius-none`, `--radius-xs` (2px), `--radius-sm` (4px), `--radius-md` (8px = current `--radius`), `--radius-lg` (12px), `--radius-xl` (16px), `--radius-full` (9999px).
- **Shadow**: `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--shadow-2xl`, `--shadow-inner`. Use Tailwind's default shadow values as a baseline; refine if needed.
- **Gradient**: `--gradient-brand-primary` (formalize current `from-purple-500 to-cyan-500` from `input-form.tsx` line ~132 — preserve exact hue values), `--gradient-brand-soft` (subtle backdrop variant for use behind the brand-primary), `--gradient-error`, `--gradient-success`.
- **Blur**: `--blur-xs`, `--blur-sm`, `--blur-md`, `--blur-lg`, `--blur-xl`, `--blur-2xl`. Match Tailwind's defaults.
- **Motion**: `--duration-instant` (75ms), `--duration-fast` (150ms), `--duration-base` (250ms), `--duration-slow` (400ms), `--duration-slower` (600ms). `--ease-out-soft`, `--ease-in-out-soft` (custom cubic-bezier values for natural-feel motion).

For dark mode, define overrides only for tokens that change — most should be color-mode-independent.

- [ ] **Step 5: Verify Tailwind picks up the tokens**

```bash
pnpm dev &
sleep 10
# Spot-check by writing a temp file using a new utility class:
echo 'export default function T() { return <div className="text-h1 shadow-md p-8 rounded-lg" />; }' > /tmp/token-check.tsx
# Tailwind should compile classes from new tokens. Build check:
pnpm build 2>&1 | grep -E "warning|error" | head -10
# Stop dev:
pkill -f "next dev" || true
rm /tmp/token-check.tsx
```

If a class doesn't resolve, fix the `@theme` declaration syntax.

- [ ] **Step 6: Retrofit `app/components/input-form.tsx`**

Read the current implementation. Replace:
- Theme-conditional `containerBg`/`inputAreaBg` ternaries (lines ~30-40) with semantic classes that resolve via dark mode (e.g., `bg-card text-card-foreground border-border`). The dark/light variants of these tokens already exist; we're using them instead of hand-rolling.
- `from-purple-500 to-cyan-500` (line ~132) → `bg-[image:var(--gradient-brand-primary)]` or equivalent Tailwind 4 utility (verify the correct syntax via the Tailwind 4 `@theme` docs).
- Arbitrary `blur-sm` / `blur-xl` (lines ~76, 92) → named blur utility classes from new scale (`blur-md`, `blur-xl` if applicable).

After retrofit, take before/after screenshots via the `playwright` skill (sign in with creds, navigate to home page, capture). Include both screenshots in the PR description. Visual must be identical (or intentionally improved — flag in PR if so).

- [ ] **Step 7: Write MDX docs for tokens**

Create `docs/design-system/README.md`:
```markdown
# Design System

Source of truth for every design decision in `youtubeai_chat_frontend`.

## Structure
- `tokens/` — design token vocabulary (typography, spacing, shadows, etc.)
- `components/` — per-component documentation
- `patterns/` — composition patterns and accessibility patterns

## Audience
- **Humans:** read or render via Next.js MDX route (if added).
- **Claude (the agent):** reads MDX as source. Token names and component prop APIs are the contract.

## Status
- Tokens: PR 1 (this) — defined in `app/globals.css` `@theme` directive.
- Components: PRs 2-6 — vertical-slice rollout.

## Out of scope
- Brand identity decisions (colors, typography family) — preserved from current state.
- Storybook — chose MDX.
- Visual regression testing — chose behavior + a11y only.
```

Then create one MDX per token category (`typography.mdx`, `spacing.mdx`, etc.). Each lists every token, its CSS value, and the Tailwind utility name (e.g., `--text-h1` → `.text-h1`). Include "when to reach for this" guidance.

- [ ] **Step 8: Coverage scope expansion**

Update `vitest.config.ts`: remove `components/ui/**` from `coverage.exclude`. Floor stays at 50/40/50/50. The components currently have zero tests, so coverage of `components/ui/**` will be near 0 in this PR — that's expected. PRs 2-6 raise it.

To prevent the floor from breaking on this PR: temporarily set `coverage.thresholds = undefined` in `vitest.config.ts`, OR keep the floor but exclude `components/ui/**` until PR 2 lands. Recommendation: keep the exclusion in PR 1 ("coverage scope expansion is a multi-PR effort"); remove it in PR 2 of the cluster pipeline once the forms cluster tests are added.

Actually the simplest path: in PR 1, do NOT change `vitest.config.ts`. PRs 2-6 each remove their cluster from the exclusion as they add tests. Document this approach in `docs/design-system/README.md` so the rollout is clear.

- [ ] **Step 9: Universal pre-push gate.**

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(design-system): tokens foundation + input-form retrofit

Establishes the Tailwind 4 @theme token vocabulary for B's design system
rebuild. Token surfaces: typography, spacing, radius, shadow, gradient,
blur, motion. Existing semantic colors retained.

Retrofits app/components/input-form.tsx to use only token-backed classes
(no theme-conditional ternaries, no arbitrary gradient values, no
hand-rolled blur). Visual unchanged.

MDX docs scaffolded at docs/design-system/.

Part of B (design system rebuild). Spec:
docs/superpowers/specs/2026-04-27-design-system-rebuild-b-design.md
"
```

- [ ] **Step 11: Push and open PR**

```bash
git push -u origin chore/ds-b-1-tokens
gh pr create --title "feat(design-system): tokens foundation + input-form retrofit (B PR 1/6)" \
  --body "$(cat <<'EOF'
## Summary
- Establishes Tailwind 4 `@theme` token vocabulary: typography, spacing, radius, shadow, gradient, blur, motion
- Formalizes existing purple/cyan gradient as `--gradient-brand-primary` (preserves current visual)
- Retrofits `app/components/input-form.tsx` to use only tokens (no inline theme conditionals, no arbitrary values)
- MDX docs scaffolded at `docs/design-system/`

Part of B design system rebuild (6 PRs total, vertical-slice phasing).
Spec: `docs/superpowers/specs/2026-04-27-design-system-rebuild-b-design.md`

## Test plan
- [x] `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test --run`, `pnpm build` all clean locally
- [x] `pnpm dev` runs without new deprecation warnings
- [x] Visual identity: input-form.tsx before/after screenshots attached (or noted identical)
- [ ] CI green
- [ ] Smoke workflow green post-merge against prod

## Screenshots
[attach before/after of input-form.tsx hero]
EOF
)"
```

- [ ] **Step 12: Run pr-review-toolkit on the PR**

Invoke `pr-review-toolkit:review-pr` with the PR number. Address every Critical and Important finding. Push fixup commits per finding.

- [ ] **Step 13: Watch CI, auto-merge on green**

Same pattern as A1.

- [ ] **Step 14: Universal post-merge protocol** — watch smoke workflow.

---

## Task 2: PR 2 — Forms cluster (8 components)

**Branch:** `chore/ds-b-2-forms`
**Conventional title:** `feat(design-system): forms cluster — audit, MDX, tests (B PR 2/6)`

**Components:** button, input, label, form, checkbox, radio-group, switch, textarea (8 total)

**Files likely touched:**
- `components/ui/{button,input,label,form,checkbox,radio-group,switch,textarea}.tsx` (audit + token application; usually minor edits)
- `components/ui/__tests__/<name>.test.tsx` × 8 (new)
- `components/ui/__tests__/<name>.a11y.test.tsx` × 8 (new)
- `docs/design-system/components/{button,input,label,form,checkbox,radio-group,switch,textarea}.mdx` × 8 (new)
- `docs/design-system/components/forms/index.mdx` (new — cluster overview)
- `tests-utils/renderWithProviders.tsx` (new — shared test helper)
- `tests-utils/axe.ts` (new — shared axe helper)
- `vitest.config.ts` (remove `components/ui/**` from coverage exclusion — see PR 1's deferred step)
- `package.json` + `pnpm-lock.yaml` (add `jest-axe` and `@types/jest-axe` if going jest-axe route)

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/ds-b-2-forms`.

- [ ] **Step 2: Add testing dependencies**

```bash
pnpm add -D jest-axe @types/jest-axe
```

If jest-axe pulls in jest peer deps that conflict with our vitest setup, fall back to `@axe-core/playwright` for a11y testing in cluster spot-checks (less ergonomic but works). PR 2 establishes the pattern; PRs 3-6 follow it.

- [ ] **Step 3: Verify happy-dom 20 + jest-axe compatibility**

Write a minimal smoke test:

```tsx
// /tmp/axe-check.test.tsx (run once, then delete)
import { axe } from "jest-axe";
import { render } from "@testing-library/react";
import { Button } from "@/components/ui/button";

test("axe runs in happy-dom", async () => {
  const { container } = render(<Button>Click</Button>);
  const results = await axe(container);
  expect(results.violations).toHaveLength(0);
});
```

```bash
pnpm exec vitest run /tmp/axe-check.test.tsx
```

If green: jest-axe works in our env. Delete the temp file. If red: implement the @axe-core/playwright fallback path; document the choice in `docs/design-system/README.md`.

- [ ] **Step 4: Create shared test helpers**

`tests-utils/renderWithProviders.tsx`:

```tsx
import { render, RenderOptions } from "@testing-library/react";
import { ReactElement } from "react";
import { ThemeProvider } from "@/lib/providers/theme-provider";

// Wraps render() with our app's standard providers (theme, query, etc.).
// Components rendered in tests should match their runtime context.
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <ThemeProvider attribute="class" defaultTheme="light">
        {children}
      </ThemeProvider>
    ),
    ...options,
  });
}

export * from "@testing-library/react";
```

`tests-utils/axe.ts`:

```ts
import { configureAxe, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

expect.extend(toHaveNoViolations);

// Configure axe for our app's a11y standards. WCAG 2.1 AA is our baseline.
export const axe = configureAxe({
  rules: {
    // Add per-rule overrides here as exceptions (with rationale comments).
  },
});
```

If using @axe-core/playwright fallback, adapt accordingly.

- [ ] **Step 5: Re-include `components/ui/**` in coverage**

Edit `vitest.config.ts`: remove `"components/ui/**"` from `coverage.exclude`. Run `pnpm test --coverage --run` to confirm coverage now includes UI components (will be partial until all clusters land).

- [ ] **Step 6: Per-component pipeline (×8)**

For each of `button`, `input`, `label`, `form`, `checkbox`, `radio-group`, `switch`, `textarea`, run the **Universal per-component pipeline** (top of doc, steps 1-8). Order: do `button` first (it's the canonical reference) and use it as the pattern for the rest.

Track progress in the PR body as a checklist.

- [ ] **Step 7: Write cluster index doc**

`docs/design-system/components/forms/index.mdx`:

```mdx
# Forms

Components for collecting structured user input.

## Members
- [Button](../button.mdx) — Primary interactive element. CVA variants (default, destructive, outline, secondary, ghost, link).
- [Input](../input.mdx) — Single-line text input.
- [Label](../label.mdx) — Form field label, paired with form controls via `htmlFor`/`id`.
- [Form](../form.mdx) — react-hook-form integration with shadcn's FormField/FormControl/FormMessage primitives.
- [Checkbox](../checkbox.mdx) — Boolean toggle, supports indeterminate state.
- [RadioGroup](../radio-group.mdx) — Single-selection from a small set.
- [Switch](../switch.mdx) — Boolean toggle for settings/preferences (visually distinct from Checkbox).
- [Textarea](../textarea.mdx) — Multi-line text input.

## Composition example: login form

<see Form.mdx for the full pattern>

## Accessibility patterns
- Always pair Input/Textarea/Checkbox/RadioGroup with Label via `htmlFor`/`id`.
- Use FormDescription for hints, FormMessage for validation errors. Both are auto-linked via `aria-describedby`.
- Disabled state must include `aria-disabled` AND `disabled` for full compatibility.
```

- [ ] **Step 8: Universal pre-push gate.**

- [ ] **Step 9: Commit + push + PR + review + merge**

Title: `feat(design-system): forms cluster — audit, MDX, tests (B PR 2/6)`. Same flow as PR 1. Body summarizes the 8 components, links to the cluster index, lists any audit normalizations.

- [ ] **Step 10: Universal post-merge protocol.**

---

## Task 3: PR 3 — Containers cluster (9 components)

**Branch:** `chore/ds-b-3-containers`
**Conventional title:** `feat(design-system): containers cluster — audit, MDX, tests (B PR 3/6)`

**Components:** card, dialog, popover, drawer, sheet, alert-dialog, tooltip, hover-card, aspect-ratio (9 total)

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/ds-b-3-containers`.

- [ ] **Step 2: Per-component pipeline (×9)**

For each of `card`, `dialog`, `popover`, `drawer`, `sheet`, `alert-dialog`, `tooltip`, `hover-card`, `aspect-ratio`, run the **Universal per-component pipeline**.

Notes:
- `dialog` and `alert-dialog` are similar — share patterns. The MDX for `alert-dialog` should explicitly call out the difference (semantic role, no dismissable backdrop, requires explicit user action).
- `sheet` is a side-mounted dialog; document its intended uses (vs Dialog).
- `tooltip` and `hover-card` differ in interaction: tooltip is keyboard-focus driven, hover-card is hover/focus driven. MDX should explain when to reach for each.
- `aspect-ratio` is a layout primitive; minimal a11y to test (no role, no ARIA), but Vitest test should verify the ratio is correctly computed via CSS.

- [ ] **Step 3: Write cluster index doc** — `docs/design-system/components/containers/index.mdx`. Follow the pattern from PR 2 step 7.

- [ ] **Step 4: Universal pre-push gate.**

- [ ] **Step 5: Commit + push + PR + review + merge.**

- [ ] **Step 6: Universal post-merge protocol.**

---

## Task 4: PR 4 — Navigation cluster (7 components)

**Branch:** `chore/ds-b-4-navigation`
**Conventional title:** `feat(design-system): navigation cluster — audit, MDX, tests (B PR 4/6)`

**Components:** navigation-menu, menubar, tabs, breadcrumb, pagination, command, dropdown-menu (7 total)

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/ds-b-4-navigation`.

- [ ] **Step 2: Per-component pipeline (×7)**

For each component, run the **Universal per-component pipeline**.

Notes:
- `command` (cmdk) is a complex component with its own search/filter state. Test the keyboard navigation thoroughly. MDX should include a concrete example (e.g., command palette).
- `dropdown-menu` and `menubar` share Radix primitives but differ in semantic intent. MDX should call out when to reach for each.
- `breadcrumb` and `pagination` are simpler navigation primitives with minimal interactivity; tests are correspondingly briefer.

- [ ] **Step 3: Write cluster index doc** — `docs/design-system/components/navigation/index.mdx`.

- [ ] **Step 4: Universal pre-push gate.**

- [ ] **Step 5: Commit + push + PR + review + merge.**

- [ ] **Step 6: Universal post-merge protocol.**

---

## Task 5: PR 5 — Data display cluster (11 components)

**Branch:** `chore/ds-b-5-data-display`
**Conventional title:** `feat(design-system): data display cluster — audit, MDX, tests (B PR 5/6)`

**Components:** table, badge, avatar, alert, progress, skeleton, separator, scroll-area, sonner (toast), chart, google-icon (11 total)

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/ds-b-5-data-display`.

- [ ] **Step 2: Per-component pipeline (×11)**

For each component, run the **Universal per-component pipeline**.

Notes:
- `chart` was migrated to recharts 3 in A1 PR 4. Tests should cover the new `TooltipContentProps` shape. MDX should document both bar/line chart usage.
- `sonner` is a toast library wrapper; document the imperative API (`toast()`, `toast.success()`, etc.) and the `<Toaster />` portal placement.
- `google-icon` is a small SVG component; minimal test (renders, accepts className), but it gets MDX docs because it's part of the public surface.
- `skeleton` and `progress` need axe tests for proper `role` and `aria-valuenow` attributes.

- [ ] **Step 3: Write cluster index doc** — `docs/design-system/components/data-display/index.mdx`.

- [ ] **Step 4: Universal pre-push gate.**

- [ ] **Step 5: Commit + push + PR + review + merge.**

- [ ] **Step 6: Universal post-merge protocol.**

---

## Task 6: PR 6 — Composites cluster (12 components) + lint cleanup

**Branch:** `chore/ds-b-6-composites`
**Conventional title:** `feat(design-system): composites cluster + re-enable react-hooks rules (B PR 6/6)`

**Components:** sidebar, calendar, accordion, collapsible, carousel, slider, toggle, toggle-group, context-menu, input-otp, resizable, select (12 total)

### Steps

- [ ] **Step 1: Run universal pre-flight.** Branch: `chore/ds-b-6-composites`.

- [ ] **Step 2: Per-component pipeline (×12)**

For each component, run the **Universal per-component pipeline**.

Notes:
- `sidebar` is the largest component (21KB+); it's currently unused but in scope per the user's "keep all 47" decision. Audit prop API, write MDX with composition example showing it embedded in a layout, write tests covering the open/closed states, mobile breakpoint behavior, keyboard nav.
- `calendar` (react-day-picker 9.x) and `command` (handled in PR 4) share complexity. Tests should cover keyboard nav and date selection.
- `carousel` (embla-carousel-react) — test pagination and keyboard navigation. **Note:** carousel is on the list of files where the disabled `react-hooks/set-state-in-effect` rule fires.
- `input-otp`, `slider` — straightforward; standard pipeline.
- `accordion`/`collapsible` differ in controlled vs uncontrolled patterns; MDX should call out both.
- `resizable` was migrated to react-resizable-panels v4 in A1 PR 4 (`Group`/`Separator` exports). Tests should cover the new export shape.

- [ ] **Step 3: Re-enable disabled react-hooks rules**

In `eslint.config.mjs`, the three rules disabled in A1 PR 1 (`react-hooks/set-state-in-effect`, `set-state-in-render`, `purity`) re-enable here. As we touched offending files in earlier cluster PRs, the violations should be fixed; PR 6 verifies by running `pnpm lint` after re-enabling. If violations remain in unrelated files (e.g., `app/components/*` not touched in B), fix them in this PR with documented refactors (e.g., move setState into a callback) or surface as escalation.

- [ ] **Step 4: Write cluster index doc** — `docs/design-system/components/composites/index.mdx`.

- [ ] **Step 5: Universal pre-push gate.**

- [ ] **Step 6: Commit + push + PR + review + merge.**

- [ ] **Step 7: Universal post-merge protocol.**

---

## Task 7: B final verification

**No new branch.** Run from main with all six PRs merged.

### Steps

- [ ] **Step 1: Pull latest main and reinstall**

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend/.worktrees/deps-a1
git checkout main && git pull --ff-only
pnpm install --frozen-lockfile
```

- [ ] **Step 2: Verify token coverage**

Grep for arbitrary Tailwind values in app code (excluding component internals where intentional):

```bash
grep -rE "bg-\[#|text-\[#|from-[a-z]+-[0-9]+ to-[a-z]+-[0-9]+|className=.*?\?.*?:" app/ 2>&1 | grep -v "^app/.*test" | head -10
```

Expected: zero hits in `app/` source. Hits in test fixtures or component internals are OK if intentional.

- [ ] **Step 3: Verify component coverage**

```bash
pnpm test --coverage --run 2>&1 | tail -30
```

Expected: every component in `components/ui/` has at least one test file. Coverage of `components/ui/**` should be 70%+.

- [ ] **Step 4: Verify MDX docs exist for every component**

```bash
ls components/ui/*.tsx | wc -l    # should be 47
ls docs/design-system/components/*.mdx | wc -l  # should be ~47 (give or take cluster index files)
```

If any component lacks an MDX file, document the gap or fix it.

- [ ] **Step 5: Run smoke against prod**

```bash
set -a && . ~/.config/claude-test-creds/youtubeai.env && set +a
BASE_URL=https://www.youtubeai.chat PROD_URL=https://www.youtubeai.chat \
  pnpm exec playwright test --workers=1 --reporter=list
```

Expected: all specs pass. Visual sanity check that the design system rebuild didn't accidentally regress any user flow.

- [ ] **Step 6: Confirm CI green**

```bash
gh run list --workflow=ci.yml --limit 1
gh run list --workflow=smoke --limit 1
```

Both should show `success` on the latest main commit.

- [ ] **Step 7: Update README**

Add a section to `README.md`:

```markdown
## Design System

Design tokens, component library, and documentation live in [`docs/design-system/`](docs/design-system/README.md). 47 components governed; built on Tailwind 4 `@theme` + Radix UI + CVA. See `docs/design-system/README.md` for the contract.
```

- [ ] **Step 8: Report back to user**

Summary message including: 6 PR numbers + merge commits, per-cluster recap, total components governed, total tests added, MDX docs count, lint-rules re-enabled, any deviations from the spec, and confirmation B is complete.

---

## Plan self-review (ran by writer)

**Spec coverage:**
- Spec §1 Goal — Tasks 1-7 implement and verify; ✓
- Spec §2 Architecture (6 PRs vertical-slice) — Tasks 1-6 are the six PRs in cluster order; ✓
- Spec §3 Per-PR scope detail — Tasks 1-6 detail each cluster; ✓
- Spec §4 Inter-PR contracts — Universal pre-flight + post-merge protocol enforce the strict serial model; ✓
- Spec §5 Error handling — Universal post-merge protocol covers smoke-red revert; per-task escalation triggers in spec §5 referenced; ✓
- Spec §6 Testing strategy — Universal per-component pipeline §5+§6 and Task 1 §8 cover Vitest+axe and coverage scope expansion; ✓
- Spec §7 Token & component naming policy — Task 1 §4 (token surfaces) and per-component pipeline §4 (MDX file naming) implement this; ✓
- Spec §8 Success criteria — Task 7 verifies all 8 bullets explicitly; ✓
- Spec §9 Out of scope — Tasks include only the 47 components, no brand decisions, no Storybook, no visual regression; ✓
- Spec §10 Risks — Task 2 §3 has happy-dom+jest-axe smoke check; Task 6 §3 re-enables the disabled lint rules; Task 1 §6 captures before/after screenshots for visual diff; ✓
- Spec §11 Process — Universal sections + per-task PR/review/merge steps; ✓

**Placeholder scan:**
- "[attach before/after of input-form.tsx hero]" in Task 1 §11 PR body — implementer adds at PR-creation time; this is dynamic, not a placeholder I forgot. Acceptable.
- No "TBD", "TODO", "implement later" in plan steps. ✓

**Type / naming consistency:**
- Branch name pattern `chore/ds-b-N-<slug>` consistent across tasks. ✓
- PR title pattern `feat(design-system): … (B PR N/6)` consistent. ✓
- `Universal pre-flight` / `Universal pre-push gate` / `Universal post-merge protocol` / `Universal per-component pipeline` referenced consistently. ✓
- Component counts: 8 + 9 + 7 + 11 + 12 = 47, matches spec. ✓
- Worktree path repeated identically. ✓

**Caveats / open questions for the implementer:**
- Tailwind 4 `@theme` token-utility-class naming is the part of the plan most likely to need on-the-spot research (Task 1 §2). Plan accommodates by routing implementer to upstream docs first.
- jest-axe vs @axe-core/playwright is a fallback decision; plan accommodates by having Task 2 §3 do an empirical compat check before committing.
- The vitest coverage exclusion handoff (PR 1 keeps it, PR 2 removes it) is documented but cross-PR — flagged in `docs/design-system/README.md` per Task 1 §8.

No issues found that block plan-to-implementation handoff.
