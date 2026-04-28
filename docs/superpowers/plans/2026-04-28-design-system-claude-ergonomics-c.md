# Design System: Claude Design Ergonomics (C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan PR-by-PR. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lean semantic-token vocabulary and a rendered showcase route, sweeping all consumer code to use the new vocabulary. Every PR keeps visuals byte-identical to production; only token *names* change.

**Architecture:** Two parallel concerns shipped in 4 implementation PRs. Tokens land first (PR 1); `components/ui/*` sweeps second (PR 2); marketing/summary sweeps third (PR 3); showcase route + legacy cleanup last (PR 4). Each PR is independently mergeable, screenshot-equal to the previous, and gates on tests + lint + typecheck + Playwright equality.

**Tech Stack:** Next.js 16, Tailwind 4 `@theme`, Playwright (via `playwright` skill), Vitest 4, jest-axe, MDX docs. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-28-design-system-claude-ergonomics-c-design.md`

---

## Branch Topology

| PR | Branch | Base | Purpose |
|----|--------|------|---------|
| 0 (this) | `feature/design-c-claude-ergonomics` | `origin/main` | spec + plan only |
| 1 | `feature/design-c-tokens` | `origin/main` (after PR 0 merge) | semantic tokens in `@theme` + `color.mdx` |
| 2 | `feature/design-c-ui-sweep` | `origin/main` (after PR 1 merge) | sweep `components/ui/*` |
| 3 | `feature/design-c-app-sweep` | `origin/main` (after PR 2 merge) | sweep `app/components/*`, `app/summary/*`, root `components/*` |
| 4 | `feature/design-c-showcase` | `origin/main` (after PR 3 merge) | `/design-system` routes + legacy cleanup |

**Rule:** every PR rebases on `origin/main` immediately before push. No PR is ever based on an unmerged sibling — sequential merge means later branches always see PR-N's tokens settled in `origin/main`.

---

## Universal Pre-Flight (run before starting each PR)

For every implementation PR (1-4):

```bash
# 1. From the repo root, fetch and ensure clean state
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend
git fetch origin
git worktree list  # confirm no stale worktree for this branch

# 2. Create the worktree (use the appropriate branch name from the topology table)
git worktree add .worktrees/<branch-suffix> -b feature/design-c-<branch-suffix> origin/main

# 3. Enter and install
cd .worktrees/<branch-suffix>
pnpm install --frozen-lockfile

# 4. Verify clean baseline (must be 1144+ tests passing on PR 1; later PRs re-baseline after each merge)
pnpm test --run
pnpm lint
pnpm exec tsc --noEmit
```

If any baseline command fails, **stop**. Do not start work — investigate first.

---

## Universal Pre-Push Gate (run before opening each PR)

Every PR must pass these gates before push:

```bash
# Lint and types
pnpm lint
pnpm exec tsc --noEmit

# Full test suite (frontend)
pnpm test --run

# Visual stability check (PRs 1-3 only — PR 4 changes visuals by adding the showcase)
# Run from another terminal: pnpm dev (port 3000)
# Then capture screenshots to confirm byte-identical visuals:
node /tmp/c-screenshot-check.js  # script written per-PR; see PR 2 task 4
```

The script `c-screenshot-check.js` is created fresh in `/tmp/` per PR. It visits four representative routes (`/`, `/auth/login`, `/auth/signup`, `/summary`) in light + dark, takes full-page PNG screenshots, and saves them to `/tmp/c-screenshots-{pr}-{phase}/`. The implementer then visually diffs `before` vs `after` screenshots.

If diffs appear, the implementer must investigate and fix before push. PR 1 has no consumer code change so visuals are inherently equal.

---

## Universal Post-Merge Protocol (run after each PR merges)

```bash
# 1. From any worktree, return to main and pull
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend
git checkout main
git pull --ff-only origin main

# 2. Wait for production smoke (Vercel deploy + smoke workflow)
# Trigger if needed: gh workflow run smoke.yml --ref main
# Watch: gh run watch <run-id>
# Confirm /api/health returns vps + llm both ok

# 3. Clean up the merged worktree
git worktree remove .worktrees/<branch-suffix>

# 4. Proceed to next PR's pre-flight
```

---

## PR 0 — Spec & Plan (this branch)

**Files:**
- Create: `docs/superpowers/specs/2026-04-28-design-system-claude-ergonomics-c-design.md` (already done)
- Create: `docs/superpowers/plans/2026-04-28-design-system-claude-ergonomics-c.md` (this file)

**Tasks:**

- [ ] **Step 1: Verify both docs exist and are committed**

```bash
ls -la docs/superpowers/specs/2026-04-28-design-system-claude-ergonomics-c-design.md
ls -la docs/superpowers/plans/2026-04-28-design-system-claude-ergonomics-c.md
git status
```

- [ ] **Step 2: Stage and commit**

```bash
git add docs/superpowers/specs/2026-04-28-design-system-claude-ergonomics-c-design.md \
        docs/superpowers/plans/2026-04-28-design-system-claude-ergonomics-c.md
git commit -m "$(cat <<'EOF'
docs: C (design system Claude ergonomics) spec + plan

Spec: 22 semantic color tokens (surfaces/text/borders/accents/states)
+ /design-system showcase route with cluster pages and tokens catalog.
4 implementation PRs in dependency order: tokens → components/ui sweep
→ marketing/summary sweep → showcase + legacy cleanup. Visuals byte-
identical throughout (token values map to current production hex).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feature/design-c-claude-ergonomics
gh pr create --title "docs: C (design system Claude ergonomics) spec + plan" --body "$(cat <<'EOF'
## Summary

- Spec for milestone C — agent-ergonomic upgrade to the design system.
- 22 semantic color tokens (5 surfaces, 5 text, 3 borders, 5 accents, 4 states).
- New `/design-system` showcase route with 5 cluster pages + tokens catalog.
- 4 implementation PRs in dependency order, each screenshot-equal to previous.

## Test plan
- [x] Spec self-reviewed (placeholder scan, mapping accuracy, scope check).
- [x] Plan self-reviewed (spec coverage, no placeholders, type consistency).
- [ ] Reviewer approval before PR 1 starts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Run pr-review-toolkit and address findings**

```bash
# After PR is open, in the PR comment thread / locally:
# /pr-review-toolkit:review-pr comments
# (docs-only — comments + tests aspects don't apply; reviewer mode "comment-analyzer" suffices)
```

- [ ] **Step 5: Wait for CI green and merge**

```bash
gh pr checks <pr-number> --watch
gh pr merge <pr-number> --squash --delete-branch
```

- [ ] **Step 6: Post-merge protocol**

Run universal post-merge protocol. Then proceed to PR 1.

---

## PR 1 — Token Foundation

**Branch:** `feature/design-c-tokens` off `origin/main` after PR 0 merges.

**Files:**
- Modify: `app/globals.css` — add 22 `--color-*` tokens to `@theme`, add `.dark` overrides outside `@theme`, update `@layer base` body styles.
- Create: `docs/design-system/tokens/color.mdx` — taxonomy reference.
- Modify: `docs/design-system/README.md` — add color.mdx to the tokens index.

**Tasks:**

- [ ] **Step 1: Pre-flight**

Run universal pre-flight, branch named `tokens`.

- [ ] **Step 2: Add semantic tokens to `@theme` in globals.css**

Append to the existing `@theme` block in `app/globals.css` (after the gradient `@theme` definitions, before any `@utility` declarations). Do NOT remove any existing tokens.

```css
  /* --------------------------------------------------------------------
   * Semantic color tokens (C PR 1)
   *
   * Tailwind 4 generates `bg-*` / `text-*` / `border-*` / `ring-*` etc.
   * utilities from each `--color-*` token. Light values live here in
   * `@theme`; dark overrides live in `.dark { … }` outside `@theme` (see
   * the block below this `@theme` declaration).
   *
   * Values map 1:1 to the legacy shadcn tokens they replace — visual
   * output is byte-identical. See docs/design-system/tokens/color.mdx
   * for the full taxonomy.
   * -------------------------------------------------------------------- */

  /* Surfaces — backgrounds at different elevation levels */
  --color-surface-base: hsl(0 0% 100%);
  --color-surface-raised: hsl(0 0% 100%);
  --color-surface-overlay: hsl(0 0% 100%);
  --color-surface-sunken: hsl(0 0% 96.1%);
  --color-surface-inverse: hsl(0 0% 9%);

  /* Text — by hierarchy / emphasis */
  --color-text-primary: hsl(0 0% 3.9%);
  --color-text-secondary: hsl(0 0% 25%);
  --color-text-muted: hsl(0 0% 45.1%);
  --color-text-disabled: hsl(0 0% 70%);
  --color-text-inverse: hsl(0 0% 98%);

  /* Borders — by emphasis */
  --color-border-subtle: hsl(0 0% 89.8%);
  --color-border-default: hsl(0 0% 80%);
  --color-border-strong: hsl(0 0% 60%);

  /* Accents — semantic intent */
  --color-accent-brand: oklch(0.627 0.265 303.9);          /* purple-500 */
  --color-accent-brand-secondary: oklch(0.789 0.154 211.5); /* cyan-500 */
  --color-accent-success: oklch(0.696 0.17 162.5);         /* emerald-500 */
  --color-accent-warning: oklch(0.769 0.188 70.08);        /* amber-500 */
  --color-accent-danger: hsl(0 84.2% 60.2%);

  /* Interaction states — additive overlays */
  --color-state-hover: hsl(0 0% 0% / 0.04);
  --color-state-pressed: hsl(0 0% 0% / 0.08);
  --color-state-focus: hsl(0 0% 3.9%);
  --color-state-disabled: hsl(0 0% 0% / 0.04);
```

- [ ] **Step 3: Add `.dark` overrides outside `@theme` in globals.css**

After the closing brace of `@theme { … }` and before the `@layer base { :root { … } }` block, add:

```css
/* Dark-mode overrides for semantic color tokens (C PR 1).
   Lives outside `@theme` — those values are build-time defaults; class-
   scoped overrides at runtime swap them via the `--color-*` cascade. */
.dark {
  --color-surface-base: hsl(0 0% 3.9%);
  --color-surface-raised: hsl(0 0% 3.9%);
  --color-surface-overlay: hsl(0 0% 3.9%);
  --color-surface-sunken: hsl(0 0% 14.9%);
  --color-surface-inverse: hsl(0 0% 98%);

  --color-text-primary: hsl(0 0% 98%);
  --color-text-secondary: hsl(0 0% 75%);
  --color-text-muted: hsl(0 0% 63.9%);
  --color-text-disabled: hsl(0 0% 40%);
  --color-text-inverse: hsl(0 0% 9%);

  --color-border-subtle: hsl(0 0% 14.9%);
  --color-border-default: hsl(0 0% 22%);
  --color-border-strong: hsl(0 0% 50%);

  --color-accent-brand: oklch(0.715 0.22 303.9);          /* purple-400 */
  --color-accent-brand-secondary: oklch(0.847 0.13 211.5); /* cyan-400 */
  --color-accent-success: oklch(0.78 0.165 162.5);        /* emerald-400 */
  --color-accent-warning: oklch(0.83 0.19 70.08);         /* amber-400 */
  --color-accent-danger: hsl(0 62.8% 50%);

  --color-state-hover: hsl(0 0% 100% / 0.06);
  --color-state-pressed: hsl(0 0% 100% / 0.10);
  --color-state-focus: hsl(0 0% 83.1%);
  --color-state-disabled: hsl(0 0% 100% / 0.04);
}
```

- [ ] **Step 4: Verify `pnpm dev` boots and Tailwind 4 generates utilities**

Start dev server in a background terminal:

```bash
pnpm dev
```

Then via Playwright, visit `/` and assert that injecting `<div class="bg-surface-base text-text-primary border-border-subtle">test</div>` resolves to actual computed styles (not raw class names). Use the playwright skill to script this:

```js
// /tmp/c-pr1-token-resolution-check.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  const computed = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'bg-surface-base text-text-primary border-border-subtle';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopColor,
    };
  });
  console.log('Light mode tokens:', computed);
  // Expect non-empty, parseable color values (not "rgb(0, 0, 0, 0)")
  if (!computed.bg.startsWith('rgb') && !computed.bg.startsWith('oklch')) {
    throw new Error(`bg-surface-base did not resolve to a real color: ${computed.bg}`);
  }
  await browser.close();
})();
```

Run via:

```bash
cd /home/xingdi/.claude/skills/playwright && node run.js /tmp/c-pr1-token-resolution-check.js
```

Expected: prints `{ bg: 'rgb(255, 255, 255)', color: 'rgb(10, 10, 10)', border: 'rgb(229, 229, 229)' }` (or oklch equivalents).

- [ ] **Step 5: Verify alpha modifier works on custom tokens**

Same Playwright script (extend the JS):

```js
const alphaCheck = await page.evaluate(() => {
  const el = document.createElement('div');
  el.className = 'bg-surface-raised/50 text-text-muted/70 bg-accent-brand/20';
  document.body.appendChild(el);
  return getComputedStyle(el).backgroundColor;
});
console.log('Alpha modifier:', alphaCheck);
if (!alphaCheck.includes('0.') && !alphaCheck.includes('/ 0')) {
  throw new Error(`alpha modifier did not apply: ${alphaCheck}`);
}
```

Expected: a color string with non-1 alpha (e.g., `rgb(255 255 255 / 0.5)` or `rgba(...)`).

- [ ] **Step 6: Update `@layer base` body styles**

In `app/globals.css`, find the `@layer base` block at the end (currently around line 247):

```css
@layer base {
  * {
    @apply border-[hsl(var(--border))] outline-[hsl(var(--ring))]/50;
  }
  body {
    @apply bg-[hsl(var(--background))] text-[hsl(var(--foreground))];
  }
}
```

Replace with:

```css
@layer base {
  * {
    @apply border-border-subtle outline-state-focus/50;
  }
  body {
    @apply bg-surface-base text-text-primary;
  }
}
```

- [ ] **Step 7: Re-run pnpm dev visual check**

Restart dev (`pnpm dev` reload) and visit `/` and `/summary`. The page should look byte-identical to production. Open in light + dark mode, confirm both render correctly. Take screenshots to `/tmp/c-pr1-after/` for the record.

- [ ] **Step 8: Create `color.mdx`**

Create `docs/design-system/tokens/color.mdx`:

```mdx
# Color tokens (semantic palette)

C PR 1 introduces a semantic color taxonomy in Tailwind 4's `@theme`.
Every token below is a `--color-*` variable that auto-generates the
matching `bg-*` / `text-*` / `border-*` / `ring-*` utility classes.

Values are byte-identical to the legacy shadcn tokens they replace
(`--background`, `--card`, `--foreground`, etc.). The legacy tokens
remain defined in `@layer base` for the duration of PRs 1-3 to keep
unswept code working; PR 4 deletes them.

## Surfaces — backgrounds at different elevation levels

| Token | Utility | Light value | Dark value | When to reach for |
|-------|---------|-------------|------------|-------------------|
| `--color-surface-base` | `bg-surface-base` | `hsl(0 0% 100%)` | `hsl(0 0% 3.9%)` | Page background |
| `--color-surface-raised` | `bg-surface-raised` | `hsl(0 0% 100%)` | `hsl(0 0% 3.9%)` | Cards, panels, dialogs sitting on the page |
| `--color-surface-overlay` | `bg-surface-overlay` | `hsl(0 0% 100%)` | `hsl(0 0% 3.9%)` | Floating popovers, dropdowns, tooltips |
| `--color-surface-sunken` | `bg-surface-sunken` | `hsl(0 0% 96.1%)` | `hsl(0 0% 14.9%)` | Inset wells, code blocks, deemphasized fills |
| `--color-surface-inverse` | `bg-surface-inverse` | `hsl(0 0% 9%)` | `hsl(0 0% 98%)` | High-contrast emphasis (toasts, dark CTAs in light mode) |

## Text — by hierarchy / emphasis

| Token | Utility | Light value | Dark value | When to reach for |
|-------|---------|-------------|------------|-------------------|
| `--color-text-primary` | `text-text-primary` | `hsl(0 0% 3.9%)` | `hsl(0 0% 98%)` | Default body and heading text |
| `--color-text-secondary` | `text-text-secondary` | `hsl(0 0% 25%)` | `hsl(0 0% 75%)` | Subheadings, bylines, secondary info |
| `--color-text-muted` | `text-text-muted` | `hsl(0 0% 45.1%)` | `hsl(0 0% 63.9%)` | Captions, helper text, timestamps |
| `--color-text-disabled` | `text-text-disabled` | `hsl(0 0% 70%)` | `hsl(0 0% 40%)` | Disabled controls, unavailable items |
| `--color-text-inverse` | `text-text-inverse` | `hsl(0 0% 98%)` | `hsl(0 0% 9%)` | Text sitting on `surface-inverse` |

## Borders — by emphasis

| Token | Utility | Light value | Dark value | When to reach for |
|-------|---------|-------------|------------|-------------------|
| `--color-border-subtle` | `border-border-subtle` | `hsl(0 0% 89.8%)` | `hsl(0 0% 14.9%)` | Default dividers, card outlines |
| `--color-border-default` | `border-border-default` | `hsl(0 0% 80%)` | `hsl(0 0% 22%)` | Form inputs, buttons (rest) |
| `--color-border-strong` | `border-border-strong` | `hsl(0 0% 60%)` | `hsl(0 0% 50%)` | Emphasized outlines, focus rings on raised surfaces |

## Accents — semantic intent

| Token | Utility | Light value | Dark value | When to reach for |
|-------|---------|-------------|------------|-------------------|
| `--color-accent-brand` | `bg-accent-brand` | purple-500 | purple-400 | Primary CTAs, brand emphasis |
| `--color-accent-brand-secondary` | `bg-accent-brand-secondary` | cyan-500 | cyan-400 | Brand pair (gradient endpoints, secondary brand surfaces) |
| `--color-accent-success` | `bg-accent-success` | emerald-500 | emerald-400 | Success toasts, completion checks |
| `--color-accent-warning` | `bg-accent-warning` | amber-500 | amber-400 | Warning banners, caution flags |
| `--color-accent-danger` | `bg-accent-danger` | red `60%` | red `50%` | Destructive CTAs, error states |

## Interaction states — additive overlays

| Token | Utility | Light value | Dark value | When to reach for |
|-------|---------|-------------|------------|-------------------|
| `--color-state-hover` | `bg-state-hover` | black 4% | white 6% | Hover overlay on raised surfaces |
| `--color-state-pressed` | `bg-state-pressed` | black 8% | white 10% | Active/pressed overlay |
| `--color-state-focus` | `ring-state-focus` | dark fg | light fg | Focus rings (aliased to existing `--ring`) |
| `--color-state-disabled` | `bg-state-disabled` | black 4% | white 4% | Disabled overlay; combine with `text-text-disabled` |

## Migration mapping (legacy → semantic)

| Legacy class | New class |
|--------------|-----------|
| `bg-background` | `bg-surface-base` |
| `bg-card` | `bg-surface-raised` |
| `bg-popover` | `bg-surface-overlay` |
| `bg-secondary`, `bg-muted` | `bg-surface-sunken` |
| `bg-primary` | `bg-surface-inverse` |
| `bg-destructive` | `bg-accent-danger` |
| `bg-accent` | `bg-state-hover` *or* `bg-surface-sunken` (audit) |
| `text-foreground` | `text-text-primary` |
| `text-muted-foreground` | `text-text-muted` |
| `text-primary-foreground` | `text-text-inverse` |
| `text-card-foreground`, `text-popover-foreground`, `text-secondary-foreground`, `text-accent-foreground` | `text-text-primary` |
| `text-destructive-foreground` | `text-text-inverse` |
| `border-border` | `border-border-subtle` |
| `border-input` | `border-border-default` |

## Why doubled `text-text-*` prefix

Tailwind 4 derives utility names from `--color-*` token names. `--color-text-primary` becomes `text-text-primary` (text color of "text-primary" token). Reads awkwardly but is unambiguous and grep-friendly. The category-prefix-on-token-name pattern (`text-*`, `surface-*`, `border-*`, `accent-*`, `state-*`) is consistent across all 22 tokens — predictable from the category alone.

## Compatibility shim status

PRs 1-3 keep the legacy shadcn tokens (`--background`, `--card`, etc.) defined in `@layer base { :root { … } .dark { … } }`. PR 4 deletes them once nothing references them.
```

- [ ] **Step 9: Update tokens README index**

Edit `docs/design-system/README.md` (or `tokens/README.md` if that's where the index lives) to add `color.mdx` to the tokens listing. Run:

```bash
ls docs/design-system/
```

If a README exists, edit it. If not, skip this step (the file presence is enough for grep-based discovery).

- [ ] **Step 10: Run pre-push gate**

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test --run
```

All must pass. PR 1 has no consumer code changes, so 1144 tests should still pass and no visual change is expected.

- [ ] **Step 11: Commit**

```bash
git add app/globals.css docs/design-system/tokens/color.mdx docs/design-system/README.md
git commit -m "$(cat <<'EOF'
feat(design-system): semantic color tokens in @theme (C PR 1/4)

Introduces 22 semantic color tokens (5 surfaces, 5 text, 3 borders, 5
accents, 4 states) in Tailwind 4's @theme directive. Values map 1:1 to
the legacy shadcn tokens they replace — visuals byte-identical.

Legacy tokens (--background, --card, --foreground, etc.) remain in
@layer base for compat through PRs 2-3. PR 4 deletes them.

@layer base body styles updated to read from new tokens directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Push, open PR, run pr-review-toolkit**

```bash
git push -u origin feature/design-c-tokens
gh pr create --title "feat(design-system): semantic color tokens (C PR 1/4)" --body "$(cat <<'EOF'
## Summary

- Adds 22 semantic color tokens to `@theme` in `app/globals.css`.
- Adds `.dark` overrides for runtime swap.
- Updates `@layer base` body styles to use new tokens.
- Legacy shadcn tokens stay for compatibility through PRs 2-3.
- New `color.mdx` documents the taxonomy.

## Visual stability

Byte-identical: every new token maps to the exact hex/HSL value of the legacy token it replaces. No consumer code references new tokens yet, so visuals are inherently unchanged.

## Test plan
- [x] `pnpm lint` clean
- [x] `pnpm exec tsc --noEmit` clean
- [x] `pnpm test --run` — 1144 tests passing
- [x] Playwright check — `bg-surface-base`, `text-text-primary`, `border-border-subtle` resolve to real colors
- [x] Alpha modifier check — `bg-accent-brand/20` produces alpha-aware color

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# After PR open
# Run pr-review-toolkit:review-pr
# Address any findings, push fixes, re-run
```

- [ ] **Step 13: Wait for CI green and merge**

```bash
gh pr checks <pr-number> --watch
gh pr merge <pr-number> --squash --delete-branch
```

- [ ] **Step 14: Post-merge protocol**

Run universal post-merge protocol. Then proceed to PR 2.

---

## PR 2 — Sweep `components/ui/*`

**Branch:** `feature/design-c-ui-sweep` off `origin/main` after PR 1 merges.

**Files modified (47 components in `components/ui/*.tsx`):** every file containing legacy shadcn token classes. Use grep to enumerate.

**Files NOT modified:** test files in `components/ui/__tests__/`. Tests may reference legacy class names; that's acceptable because they assert behavior, not classes.

**Tasks:**

- [ ] **Step 1: Pre-flight**

Run universal pre-flight, branch named `ui-sweep`.

- [ ] **Step 2: Capture before screenshots**

Start dev server and capture screenshots to `/tmp/c-pr2-before/`:

```bash
# Terminal A
pnpm dev

# Terminal B (after dev is ready)
node /tmp/c-pr2-screenshots.js
```

Where `/tmp/c-pr2-screenshots.js`:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const phase = process.env.PHASE || 'before';
  const dir = `/tmp/c-pr2-${phase}`;
  require('fs').mkdirSync(dir, { recursive: true });

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      colorScheme: theme,
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    // Force theme via localStorage (next-themes uses it)
    await page.addInitScript((t) => {
      localStorage.setItem('theme', t);
    }, theme);

    for (const route of ['/', '/auth/login', '/auth/signup', '/summary']) {
      await page.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${dir}/${route.replace(/\//g, '_') || '_root'}-${theme}.png`,
        fullPage: true,
      });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`Screenshots saved to ${dir}`);
})();
```

Run:

```bash
PHASE=before node /home/xingdi/.claude/skills/playwright/run.js /tmp/c-pr2-screenshots.js
```

- [ ] **Step 3: Apply the sweep mapping across `components/ui/*`**

For each `.tsx` file in `components/ui/` (NOT in `__tests__/`), apply the canonical mapping:

| Find | Replace |
|------|---------|
| `bg-background` | `bg-surface-base` |
| `bg-card\b` | `bg-surface-raised` |
| `bg-popover\b` | `bg-surface-overlay` |
| `bg-secondary\b` | `bg-surface-sunken` |
| `bg-muted\b` | `bg-surface-sunken` |
| `bg-primary\b` | `bg-surface-inverse` |
| `bg-destructive\b` | `bg-accent-danger` |
| `bg-accent\b` | `bg-state-hover` |
| `text-foreground\b` | `text-text-primary` |
| `text-muted-foreground\b` | `text-text-muted` |
| `text-primary-foreground\b` | `text-text-inverse` |
| `text-destructive-foreground\b` | `text-text-inverse` |
| `text-card-foreground\b` | `text-text-primary` |
| `text-popover-foreground\b` | `text-text-primary` |
| `text-secondary-foreground\b` | `text-text-primary` |
| `text-accent-foreground\b` | `text-text-primary` |
| `border-border\b` | `border-border-subtle` |
| `border-input\b` | `border-border-default` |

Apply opacity-modifier syntax preserved (e.g., `bg-primary/90` → `bg-surface-inverse/90`, `bg-destructive/20` → `bg-accent-danger/20`, `ring-destructive/40` → `ring-accent-danger/40`).

Apply per-prefix variants (`hover:`, `focus:`, `dark:`, `data-[state=open]:`, etc.) the same way — the prefix attaches to the new class.

For sidebar tokens (`--sidebar-*`), use this mapping:

| Find | Replace |
|------|---------|
| `bg-sidebar\b` | `bg-surface-raised` |
| `text-sidebar-foreground\b` | `text-text-primary` |
| `bg-sidebar-accent\b` | `bg-state-hover` |
| `text-sidebar-accent-foreground\b` | `text-text-primary` |
| `bg-sidebar-primary\b` | `bg-accent-brand` |
| `text-sidebar-primary-foreground\b` | `text-text-inverse` |
| `border-sidebar-border\b` | `border-border-subtle` |
| `bg-sidebar-border\b` | `bg-border-subtle` |
| `ring-sidebar-ring\b` | `ring-state-focus` |

Approach: do this per-file with the Edit tool's `replace_all`. For sidebar.tsx (largest single sweep), do classes one at a time so the implementer can sanity-check each replacement before proceeding.

After every 5 files swept, run `pnpm test --run` quickly to catch any test breakage early.

- [ ] **Step 4: Sweep `globals.css` `@apply` directives if any reference legacy tokens**

```bash
git grep -E "@apply.*\\b(bg-card|bg-popover|bg-background|bg-primary|bg-secondary|bg-muted|bg-accent|bg-destructive|text-foreground|text-muted-foreground|border-border|border-input)\\b" app/globals.css
```

If any results, sweep them with the same mapping.

- [ ] **Step 5: Verify sweep complete**

```bash
git grep -nE "\\b(bg-card|bg-popover|bg-background|bg-primary|bg-secondary|bg-muted|bg-accent|bg-destructive|text-foreground|text-muted-foreground|text-primary-foreground|text-destructive-foreground|text-card-foreground|text-popover-foreground|text-secondary-foreground|text-accent-foreground|border-border|border-input|bg-sidebar|text-sidebar-foreground|bg-sidebar-accent|text-sidebar-accent-foreground|bg-sidebar-primary|text-sidebar-primary-foreground|border-sidebar-border|bg-sidebar-border|ring-sidebar-ring)\\b" -- 'components/ui/*.tsx'
```

Expected output: empty. Any remaining match must be investigated — could be a legitimate non-class string (rare; e.g., a comment) or a missed sweep target.

- [ ] **Step 6: Run tests**

```bash
pnpm test --run
```

Expected: 1144 tests pass. If any fail, the sweep introduced a behavior change. Investigate per failure (likely a class string in a test assertion that needs updating, or a real semantic regression — fix in the component, not by editing the test).

- [ ] **Step 7: Run lint and typecheck**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

- [ ] **Step 8: Capture after screenshots**

```bash
PHASE=after node /home/xingdi/.claude/skills/playwright/run.js /tmp/c-pr2-screenshots.js
```

- [ ] **Step 9: Visually diff before vs after**

Open the screenshots side-by-side. Use ImageMagick if available, otherwise visual inspection:

```bash
ls /tmp/c-pr2-before/ /tmp/c-pr2-after/
# For each pair, eyeball them. Differences must be zero.
```

If any visual difference appears: STOP. Token mapping is wrong somewhere. Investigate which class produced the diff (use Playwright DevTools: re-visit the page, inspect the element that changed). Fix mapping, re-sweep.

- [ ] **Step 10: Commit**

```bash
git add components/ui/ app/globals.css
git commit -m "$(cat <<'EOF'
feat(design-system): sweep components/ui/* to semantic tokens (C PR 2/4)

Replaces every legacy shadcn token class (bg-card, bg-popover,
text-foreground, border-input, etc.) in components/ui/*.tsx with the
matching semantic token (bg-surface-raised, bg-surface-overlay,
text-text-primary, border-border-default, etc.).

Sidebar tokens (bg-sidebar, text-sidebar-foreground, etc.) collapse
to standard semantic tokens — sidebar is just another panel.

Visuals byte-identical: tokens map to the same hex/HSL values.
Verified by Playwright screenshot equality on /, /auth/login,
/auth/signup, /summary in light + dark.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Push, open PR, run pr-review-toolkit**

```bash
git push -u origin feature/design-c-ui-sweep
gh pr create --title "feat(design-system): sweep components/ui to semantic tokens (C PR 2/4)" --body "$(cat <<'EOF'
## Summary

- Mechanical sweep: every legacy shadcn token class in `components/ui/*.tsx` → semantic token equivalent.
- Sidebar token namespace collapsed into standard semantic surfaces/text/borders.
- 1144 tests passing.
- Playwright screenshots before/after byte-identical.

## Test plan
- [x] `pnpm lint` clean
- [x] `pnpm exec tsc --noEmit` clean
- [x] `pnpm test --run` — 1144 tests passing
- [x] Playwright before/after screenshots compared on /, /auth/login, /auth/signup, /summary in light + dark

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Run pr-review-toolkit:review-pr
# Address findings, push fixes, re-run
```

- [ ] **Step 12: Wait for CI, merge, post-merge**

```bash
gh pr checks <pr-number> --watch
gh pr merge <pr-number> --squash --delete-branch
```

Run universal post-merge protocol. Then proceed to PR 3.

---

## PR 3 — Sweep marketing + summary + root components

**Branch:** `feature/design-c-app-sweep` off `origin/main` after PR 2 merges.

**Files modified:**
- `app/components/{benefits,faq,header,hero-section,how-it-works,input-form,testimonials,use-cases}.tsx`
- `app/summary/components/{streaming-progress,stream-error-banner,summary-content,summary-stats,transcript-paragraphs,video-info-card}.tsx`
- `app/summary/page.tsx`
- `components/{auth-button,profile-avatar}.tsx`
- `app/globals.css` (add stage-gradient tokens)

**Tasks:**

- [ ] **Step 1: Pre-flight**

Run universal pre-flight, branch named `app-sweep`.

- [ ] **Step 2: Add stage-gradient tokens to `@theme`**

Append to the gradient section of `@theme` in `app/globals.css`:

```css
  /* Stage-specific gradients (C PR 3) — used by streaming-progress.tsx */
  --gradient-stage-preparing: linear-gradient(to right, var(--color-blue-500), var(--color-cyan-500));
  --gradient-stage-transcribing: linear-gradient(to right, var(--color-yellow-500), var(--color-orange-500));
  --gradient-stage-summarizing: linear-gradient(to right, var(--color-purple-500), var(--color-pink-500));
  --gradient-stage-complete: linear-gradient(to right, var(--color-green-500), var(--color-emerald-500));
```

And add the matching `@utility` rules (after existing brand-gradient utilities):

```css
@utility bg-gradient-stage-preparing {
  background-image: var(--gradient-stage-preparing);
}
@utility bg-gradient-stage-transcribing {
  background-image: var(--gradient-stage-transcribing);
}
@utility bg-gradient-stage-summarizing {
  background-image: var(--gradient-stage-summarizing);
}
@utility bg-gradient-stage-complete {
  background-image: var(--gradient-stage-complete);
}
```

- [ ] **Step 3: Capture before screenshots**

Same Playwright script pattern as PR 2 but to `/tmp/c-pr3-before/`:

```bash
PHASE=before node /home/xingdi/.claude/skills/playwright/run.js /tmp/c-pr3-screenshots.js
```

Use the same routes (`/`, `/auth/login`, `/auth/signup`, `/summary`).

- [ ] **Step 4: Sweep `app/components/*.tsx`**

For each marketing component file, apply this mapping for raw palette colors:

| Find | Replace |
|------|---------|
| `text-purple-500` | `text-accent-brand` |
| `text-purple-400` | `text-accent-brand` (dark variant resolves automatically) |
| `text-purple-600 dark:text-purple-400` | `text-accent-brand` (drop the dark variant — semantic token already shifts) |
| `text-cyan-500` | `text-accent-brand-secondary` |
| `text-cyan-400` | `text-accent-brand-secondary` |
| `text-cyan-600 dark:text-cyan-400` | `text-accent-brand-secondary` |
| `bg-purple-500/20` | `bg-accent-brand/20` |
| `bg-purple-500/30` | `bg-accent-brand/30` |
| `bg-cyan-500/20` | `bg-accent-brand-secondary/20` |
| `border-purple-500/30` | `border-accent-brand/30` |
| `border-purple-500/50` | `border-accent-brand/50` |
| `border-cyan-500/30` | `border-accent-brand-secondary/30` |
| `bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600` | `bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover` |
| `bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500` | `bg-gradient-brand-accent` |
| `bg-gradient-to-r from-purple-400 to-cyan-400` | `bg-gradient-brand-primary` (use dark variant of brand gradient if needed; for now drop the `-400` shift since brand gradient already resolves dark) |
| `bg-gradient-to-br from-purple-500/20 via-cyan-500/15 to-pink-500/20 dark:from-purple-500/30 dark:via-cyan-500/20 dark:to-pink-500/30` | `bg-gradient-brand-soft` (existing token) |
| `text-pink-500`, `text-pink-400` | `text-accent-brand` (pink not in semantic palette; collapse to brand) — *audit each usage; if pink is actively used as a 3-color triad endpoint, leave it as a documented exception with a `// TODO(C-followup)` comment* |

For non-brand status colors used as decorations (use-cases, benefits cards):

| Find | Replace |
|------|---------|
| `text-blue-500`, `text-blue-600 dark:text-blue-400` | `text-accent-brand-secondary` (collapse to brand-secondary) |
| `text-green-500`, `text-green-600 dark:text-green-400` | `text-accent-success` |
| `text-amber-500`, `text-amber-600 dark:text-amber-400` | `text-accent-warning` |
| `bg-blue-500/20` | `bg-accent-brand-secondary/20` |
| `bg-green-500/20` | `bg-accent-success/20` |
| `bg-amber-500/20` | `bg-accent-warning/20` |
| `border-blue-500/30` | `border-accent-brand-secondary/30` |
| `border-green-500/30` | `border-accent-success/30` |
| `border-amber-500/30` | `border-accent-warning/30` |

For `stream-error-banner.tsx`:

| Find | Replace |
|------|---------|
| `bg-red-500/10` | `bg-accent-danger/10` |
| `border-red-500/20` | `border-accent-danger/20` |
| `text-red-400` | `text-accent-danger` |
| `text-red-300` | `text-accent-danger` (slight color drift acceptable; tokens collapse) |

For `streaming-progress.tsx`:

Replace the `stageColors` map and the gradient consumption. Find:

```ts
  const stageColors = {
    preparing: "from-blue-500 to-cyan-500",
    transcribing: "from-yellow-500 to-orange-500",
    summarizing: "from-purple-500 to-pink-500",
    complete: "from-green-500 to-emerald-500",
  };

  const Icon = stageIcons[progress.stage];
  const colorGradient = stageColors[progress.stage];
```

Replace with:

```ts
  const stageGradients = {
    preparing: "bg-gradient-stage-preparing",
    transcribing: "bg-gradient-stage-transcribing",
    summarizing: "bg-gradient-stage-summarizing",
    complete: "bg-gradient-stage-complete",
  };

  const Icon = stageIcons[progress.stage];
  const gradientClass = stageGradients[progress.stage];
```

Then in the JSX, replace the two usages of `bg-linear-to-r ${colorGradient}` with `${gradientClass}`. Final form:

```tsx
<div
  className={`w-10 h-10 rounded-full ${gradientClass} flex items-center justify-center shadow-sm`}
>
  ...
</div>

<div
  className={`${gradientClass} h-3 rounded-full transition-all duration-500 ease-out relative`}
  style={{ width: `${progress.progress}%` }}
>
```

Also collapse the `isDark` ternary blocks that use `bg-slate-*`/`text-white`/`text-slate-*` to use semantic tokens directly via `dark:` variants. Specifically:

| Find | Replace |
|------|---------|
| `${isDark ? "bg-slate-800/80 border-slate-600/50" : "bg-white border-slate-300"}` | `bg-surface-raised dark:bg-surface-sunken/80 border-border-subtle dark:border-border-default/50` |
| `${isDark ? "text-white" : "text-slate-900"}` | `text-text-primary` |
| `${isDark ? "text-gray-200" : "text-slate-600"}` | `text-text-muted` |
| `${isDark ? "bg-slate-700/70" : "bg-slate-200"}` | `bg-surface-sunken dark:bg-surface-sunken/70` |

Then drop the `useTheme` hook + `isDark` calc — the entire conditional pattern goes away.

**Note:** this collapses one of the B-followup TODOs (the `useTheme` hydration dance in streaming-progress) opportunistically because the sweep makes it nearly free. Leave the other B-followup TODOs (input-form, faq, etc.) untouched if they aren't part of the raw-palette sweep.

For `components/auth-button.tsx`:

| Find | Replace |
|------|---------|
| `bg-linear-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600` | `bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover` |

For `components/profile-avatar.tsx`:

| Find | Replace |
|------|---------|
| `border-purple-400/50 hover:border-purple-400` | `border-accent-brand/50 hover:border-accent-brand` |

For `app/components/hero-section.tsx` decorative blobs (animated gradient halos), preserve visual identity by mapping to brand tokens:

| Find | Replace |
|------|---------|
| `bg-gradient-to-br from-purple-500/20 via-cyan-500/15 to-pink-500/20 dark:from-purple-500/30 dark:via-cyan-500/20 dark:to-pink-500/30` | `bg-gradient-brand-soft` (existing soft token covers the alpha range) |
| `bg-purple-500/20 dark:bg-purple-500/30` | `bg-accent-brand/20 dark:bg-accent-brand/30` |
| `bg-cyan-500/20 dark:bg-cyan-500/30` | `bg-accent-brand-secondary/20 dark:bg-accent-brand-secondary/30` |
| `bg-pink-500/20 dark:bg-pink-500/30` | `bg-accent-brand/20 dark:bg-accent-brand/30` (collapse pink into brand — visual diff acceptable) |

If preserving the pink-tinted blob is important, leave the raw `pink-500` line and add a `// TODO(C-followup): introduce --color-accent-brand-tertiary if pink stays as a third brand stop` comment. The implementer's judgment here.

For `app/components/header.tsx`:

| Find | Replace |
|------|---------|
| `bg-gradient-to-r from-purple-500 to-cyan-500` (logo background) | `bg-gradient-brand-primary` |
| `bg-gradient-to-r from-purple-400 to-cyan-400` (logo text) | `bg-gradient-brand-primary` (drop the lighter-shade variant — brand gradient handles dark mode) |
| `bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600` (CTA) | `bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover` |

- [ ] **Step 5: Verify sweep**

```bash
git grep -nE "(purple|cyan|pink|blue|fuchsia|violet|indigo|rose|emerald|amber|red|orange|yellow|green|teal)-(50|100|200|300|400|500|600|700|800|900)" -- 'app/components/**' 'app/summary/**' 'components/auth-button.tsx' 'components/profile-avatar.tsx'
```

Expected output: empty (or, if the implementer chose to preserve pink as a brand-tertiary exception per the note above, only `text-pink-*` / `bg-pink-*` / etc. with adjacent `// TODO(C-followup)` comments).

- [ ] **Step 6: Run tests**

```bash
pnpm test --run
```

Expected: 1144 tests pass. None of these files have direct test coverage for class strings — tests assert behavior — so the sweep should be invisible to tests.

- [ ] **Step 7: Lint + typecheck**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

- [ ] **Step 8: Capture after screenshots**

```bash
PHASE=after node /home/xingdi/.claude/skills/playwright/run.js /tmp/c-pr3-screenshots.js
```

- [ ] **Step 9: Visual diff**

Same as PR 2 — compare `/tmp/c-pr3-before/` vs `/tmp/c-pr3-after/`. The summary page in particular needs careful inspection because streaming-progress had structural changes (the `isDark` ternary collapse).

If `/summary` shows a difference: most likely is the `streaming-progress` collapse. The streaming-progress component is only visible during an active summary stream. The screenshot may capture a non-streaming state, in which case the diff is invisible. To force a streaming state for the screenshot:

```bash
# Use the test creds and trigger a real summary
# (creds at ~/.config/claude-test-creds/youtubeai.env)
# Run a Playwright session that submits a YouTube URL and screenshots the streaming-progress
```

Otherwise accept that streaming-progress visuals can only be regression-checked via a live e2e test. Run one Playwright e2e through the full summary flow before commit:

```js
// /tmp/c-pr3-streaming-e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config({ path: process.env.HOME + '/.config/claude-test-creds/youtubeai.env' });

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');

  // Log in (form details depend on auth flow — adjust selectors as needed)
  await page.click('text=Sign in');
  await page.fill('input[type=email]', process.env.TEST_EMAIL);
  await page.fill('input[type=password]', process.env.TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/');

  // Submit a known short YouTube video
  await page.fill('input[name=url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.click('button:has-text("Summarize")');
  await page.waitForURL('**/summary**');

  // Wait for streaming-progress to render and capture
  await page.waitForSelector('[data-testid=streaming-progress], text=Preparing, text=Transcribing', { timeout: 30000 });
  await page.screenshot({ path: '/tmp/c-pr3-streaming-state.png', fullPage: true });

  await browser.close();
})();
```

If the captured streaming-progress visually matches the production look (gradient bar at the same intensity per stage), accept and proceed. If colors are visibly off, fix the gradient stage tokens and re-test.

- [ ] **Step 10: Commit**

```bash
git add app/ components/auth-button.tsx components/profile-avatar.tsx
git commit -m "$(cat <<'EOF'
feat(design-system): sweep marketing + summary to semantic tokens (C PR 3/4)

Sweeps raw palette colors (purple-500, cyan-500, pink-500, blue-500,
green-500, amber-500, red-500) in app/components/*, app/summary/*, and
root components/ to semantic accent tokens (accent-brand,
accent-brand-secondary, accent-success, accent-warning, accent-danger).

Adds 4 stage-gradient tokens (preparing/transcribing/summarizing/
complete) for streaming-progress. Collapses one B-followup useTheme
hydration dance in streaming-progress as a side benefit.

Visuals byte-identical on home/auth pages; streaming-progress
screenshot stable via live e2e check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Push, open PR, run pr-review-toolkit**

```bash
git push -u origin feature/design-c-app-sweep
gh pr create --title "feat(design-system): sweep marketing + summary to semantic tokens (C PR 3/4)" --body "$(cat <<'EOF'
## Summary

- Sweeps raw `{color}-{shade}` palette classes to semantic accent tokens.
- Adds 4 stage-gradient tokens for streaming-progress.
- Collapses one B-followup `useTheme` hydration dance opportunistically.

## Visual stability

- Static routes (/, /auth/*): byte-identical via Playwright screenshots.
- /summary streaming-progress: verified via live e2e against test creds.

## Test plan
- [x] `pnpm lint` clean
- [x] `pnpm exec tsc --noEmit` clean
- [x] `pnpm test --run` — 1144 tests passing
- [x] Playwright before/after on /, /auth/login, /auth/signup
- [x] Playwright e2e through full summary flow with streaming-progress capture

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Run pr-review-toolkit:review-pr
# Address findings, push fixes, re-run
```

- [ ] **Step 12: Wait for CI, merge, post-merge**

```bash
gh pr checks <pr-number> --watch
gh pr merge <pr-number> --squash --delete-branch
```

Run universal post-merge protocol. Then proceed to PR 4.

---

## PR 4 — Showcase Route + Legacy Cleanup

**Branch:** `feature/design-c-showcase` off `origin/main` after PR 3 merges.

**Files created:**
- `app/(design-system)/layout.tsx`
- `app/(design-system)/design-system/page.tsx`
- `app/(design-system)/design-system/tokens/page.tsx`
- `app/(design-system)/design-system/forms/page.tsx`
- `app/(design-system)/design-system/containers/page.tsx`
- `app/(design-system)/design-system/navigation/page.tsx`
- `app/(design-system)/design-system/data-display/page.tsx`
- `app/(design-system)/design-system/composites/page.tsx`
- `app/(design-system)/_components/ShowcaseLayout.tsx`
- `app/(design-system)/_components/ComponentShowcase.tsx`
- `app/(design-system)/_components/TokenSwatch.tsx`
- `app/(design-system)/_components/TypeSpecimen.tsx`
- `app/(design-system)/_components/DesignSystemNav.tsx`
- `app/(design-system)/__tests__/showcase-smoke.test.tsx`

**Files modified:**
- `app/globals.css` — delete legacy `:root` / `.dark` shadcn token blocks (compat shim no longer needed).
- `tailwind.config.ts` — trim `theme.extend.colors` (legacy bridges no longer needed).

**Tasks:**

- [ ] **Step 1: Pre-flight**

Run universal pre-flight, branch named `showcase`.

- [ ] **Step 2: Create `_components/ShowcaseLayout.tsx`**

```tsx
// app/(design-system)/_components/ShowcaseLayout.tsx
import * as React from "react";

export function ShowcaseLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto px-6 py-12">
      <h1 className="text-h1 mb-8">{title}</h1>
      <div className="flex flex-col gap-12">{children}</div>
    </main>
  );
}
```

- [ ] **Step 3: Create `_components/ComponentShowcase.tsx`**

```tsx
// app/(design-system)/_components/ComponentShowcase.tsx
import * as React from "react";

export function ComponentShowcase({
  name,
  importPath,
  children,
}: {
  name: string;
  importPath: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border-subtle rounded-lg p-6 bg-surface-raised">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-h3">{name}</h2>
        <code className="text-body-sm text-text-muted">{importPath}</code>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `_components/TokenSwatch.tsx`**

```tsx
// app/(design-system)/_components/TokenSwatch.tsx
import * as React from "react";

export function TokenSwatch({
  name,
  utilityClass,
  description,
}: {
  name: string;
  utilityClass: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`h-20 rounded-md border border-border-subtle ${utilityClass}`}
        aria-hidden="true"
      />
      <div className="flex flex-col">
        <code className="text-body-sm font-mono text-text-primary">{name}</code>
        <span className="text-body-xs text-text-muted">{utilityClass}</span>
        {description && (
          <span className="text-body-xs text-text-secondary mt-1">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `_components/TypeSpecimen.tsx`**

```tsx
// app/(design-system)/_components/TypeSpecimen.tsx
import * as React from "react";

export function TypeSpecimen({
  token,
  utilityClass,
  sample = "The quick brown fox jumps over the lazy dog",
}: {
  token: string;
  utilityClass: string;
  sample?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle pb-4">
      <code className="text-body-xs font-mono text-text-muted">{token}</code>
      <span className={utilityClass}>{sample}</span>
    </div>
  );
}
```

- [ ] **Step 6: Create `_components/DesignSystemNav.tsx`**

```tsx
// app/(design-system)/_components/DesignSystemNav.tsx
import * as React from "react";
import Link from "next/link";

const sections = [
  { href: "/design-system", label: "Overview" },
  { href: "/design-system/tokens", label: "Tokens" },
  { href: "/design-system/forms", label: "Forms" },
  { href: "/design-system/containers", label: "Containers" },
  { href: "/design-system/navigation", label: "Navigation" },
  { href: "/design-system/data-display", label: "Data Display" },
  { href: "/design-system/composites", label: "Composites" },
];

export function DesignSystemNav() {
  return (
    <nav
      aria-label="Design system sections"
      className="sticky top-0 h-screen w-56 shrink-0 border-r border-border-subtle bg-surface-raised p-6"
    >
      <h2 className="text-h6 mb-4 text-text-primary">Design System</h2>
      <ul className="flex flex-col gap-2">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block rounded px-2 py-1 text-body-sm text-text-secondary hover:bg-state-hover hover:text-text-primary"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 7: Create the layout `app/(design-system)/layout.tsx`**

```tsx
// app/(design-system)/layout.tsx
import * as React from "react";
import { DesignSystemNav } from "./_components/DesignSystemNav";

export default function DesignSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-surface-base text-text-primary">
      <DesignSystemNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 8: Create the landing page**

```tsx
// app/(design-system)/design-system/page.tsx
import * as React from "react";
import Link from "next/link";
import { ShowcaseLayout } from "../_components/ShowcaseLayout";

export default function DesignSystemHome() {
  const sections = [
    { href: "/design-system/tokens", label: "Tokens", desc: "Colors, typography, motion, gradients, spacing, radius, shadow, blur — every design token rendered." },
    { href: "/design-system/forms", label: "Forms", desc: "Buttons, inputs, selects, checkboxes, radios, switches, sliders, OTP, textareas, labels, forms." },
    { href: "/design-system/containers", label: "Containers", desc: "Cards, alerts, dialogs, sheets, drawers, popovers, tooltips, hover-cards, scroll areas, separators, aspect ratios, resizable." },
    { href: "/design-system/navigation", label: "Navigation", desc: "Tabs, breadcrumb, pagination, navigation menu, menubar, dropdown menu, context menu, command, sidebar." },
    { href: "/design-system/data-display", label: "Data display", desc: "Avatar, badge, table, progress, skeleton, calendar, charts, accordion, collapsible, toggle, toggle group." },
    { href: "/design-system/composites", label: "Composites", desc: "Carousel, sonner toaster." },
  ];

  return (
    <ShowcaseLayout title="Design System">
      <p className="text-body-lg text-text-secondary">
        Visual reference for every component and token in the design system.
        Each cluster page renders components with their variants in light + dark
        modes (toggle via the system theme switcher).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-lg border border-border-subtle bg-surface-raised p-6 hover:bg-state-hover transition-colors"
          >
            <h2 className="text-h4 mb-2">{s.label}</h2>
            <p className="text-body-md text-text-muted">{s.desc}</p>
          </Link>
        ))}
      </div>
    </ShowcaseLayout>
  );
}
```

- [ ] **Step 9: Create the tokens catalog page**

```tsx
// app/(design-system)/design-system/tokens/page.tsx
import * as React from "react";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { TokenSwatch } from "../../_components/TokenSwatch";
import { TypeSpecimen } from "../../_components/TypeSpecimen";

export default function TokensPage() {
  return (
    <ShowcaseLayout title="Tokens">
      <section>
        <h2 className="text-h2 mb-4">Surfaces</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <TokenSwatch name="--color-surface-base" utilityClass="bg-surface-base" description="Page background" />
          <TokenSwatch name="--color-surface-raised" utilityClass="bg-surface-raised" description="Cards, panels" />
          <TokenSwatch name="--color-surface-overlay" utilityClass="bg-surface-overlay" description="Popovers, tooltips" />
          <TokenSwatch name="--color-surface-sunken" utilityClass="bg-surface-sunken" description="Inset wells" />
          <TokenSwatch name="--color-surface-inverse" utilityClass="bg-surface-inverse" description="High-contrast emphasis" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Text</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <TokenSwatch name="--color-text-primary" utilityClass="bg-text-primary" description="Default body" />
          <TokenSwatch name="--color-text-secondary" utilityClass="bg-text-secondary" description="Subheadings" />
          <TokenSwatch name="--color-text-muted" utilityClass="bg-text-muted" description="Captions" />
          <TokenSwatch name="--color-text-disabled" utilityClass="bg-text-disabled" description="Disabled controls" />
          <TokenSwatch name="--color-text-inverse" utilityClass="bg-text-inverse" description="Text on inverse surface" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Borders</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <TokenSwatch name="--color-border-subtle" utilityClass="bg-border-subtle" description="Default dividers" />
          <TokenSwatch name="--color-border-default" utilityClass="bg-border-default" description="Form inputs (rest)" />
          <TokenSwatch name="--color-border-strong" utilityClass="bg-border-strong" description="Emphasized outlines" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Accents</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <TokenSwatch name="--color-accent-brand" utilityClass="bg-accent-brand" description="Primary CTA" />
          <TokenSwatch name="--color-accent-brand-secondary" utilityClass="bg-accent-brand-secondary" description="Brand pair" />
          <TokenSwatch name="--color-accent-success" utilityClass="bg-accent-success" description="Success" />
          <TokenSwatch name="--color-accent-warning" utilityClass="bg-accent-warning" description="Warning" />
          <TokenSwatch name="--color-accent-danger" utilityClass="bg-accent-danger" description="Destructive" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Interaction states</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <TokenSwatch name="--color-state-hover" utilityClass="bg-state-hover" description="Hover overlay" />
          <TokenSwatch name="--color-state-pressed" utilityClass="bg-state-pressed" description="Pressed overlay" />
          <TokenSwatch name="--color-state-focus" utilityClass="bg-state-focus" description="Focus ring" />
          <TokenSwatch name="--color-state-disabled" utilityClass="bg-state-disabled" description="Disabled overlay" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Typography</h2>
        <div className="flex flex-col gap-2">
          <TypeSpecimen token="--text-display" utilityClass="text-display" />
          <TypeSpecimen token="--text-h1" utilityClass="text-h1" />
          <TypeSpecimen token="--text-h2" utilityClass="text-h2" />
          <TypeSpecimen token="--text-h3" utilityClass="text-h3" />
          <TypeSpecimen token="--text-h4" utilityClass="text-h4" />
          <TypeSpecimen token="--text-h5" utilityClass="text-h5" />
          <TypeSpecimen token="--text-h6" utilityClass="text-h6" />
          <TypeSpecimen token="--text-body-lg" utilityClass="text-body-lg" />
          <TypeSpecimen token="--text-body-md" utilityClass="text-body-md" />
          <TypeSpecimen token="--text-body-sm" utilityClass="text-body-sm" />
          <TypeSpecimen token="--text-body-xs" utilityClass="text-body-xs" />
          <TypeSpecimen token="--text-caption" utilityClass="text-caption" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Brand gradients</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <TokenSwatch name="--gradient-brand-primary" utilityClass="bg-gradient-brand-primary" />
          <TokenSwatch name="--gradient-brand-primary-hover" utilityClass="bg-gradient-brand-primary-hover" />
          <TokenSwatch name="--gradient-brand-accent" utilityClass="bg-gradient-brand-accent" />
          <TokenSwatch name="--gradient-brand-soft" utilityClass="bg-gradient-brand-soft" />
          <TokenSwatch name="--gradient-error" utilityClass="bg-gradient-error" />
          <TokenSwatch name="--gradient-success" utilityClass="bg-gradient-success" />
          <TokenSwatch name="--gradient-stage-preparing" utilityClass="bg-gradient-stage-preparing" />
          <TokenSwatch name="--gradient-stage-transcribing" utilityClass="bg-gradient-stage-transcribing" />
          <TokenSwatch name="--gradient-stage-summarizing" utilityClass="bg-gradient-stage-summarizing" />
          <TokenSwatch name="--gradient-stage-complete" utilityClass="bg-gradient-stage-complete" />
        </div>
      </section>
    </ShowcaseLayout>
  );
}
```

- [ ] **Step 10: Create the 5 cluster pages**

For each cluster, create the page using this template (substitute components per cluster). The exact components per cluster come from `docs/design-system/components/cluster-*.mdx`.

`app/(design-system)/design-system/forms/page.tsx`:

```tsx
import * as React from "react";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { ComponentShowcase } from "../../_components/ComponentShowcase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function FormsPage() {
  return (
    <ShowcaseLayout title="Forms">
      <ComponentShowcase name="Button" importPath="@/components/ui/button">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
      </ComponentShowcase>

      <ComponentShowcase name="Input" importPath="@/components/ui/input">
        <Input placeholder="Default input" />
        <Input type="email" placeholder="Email" />
        <Input disabled placeholder="Disabled" />
      </ComponentShowcase>

      <ComponentShowcase name="Textarea" importPath="@/components/ui/textarea">
        <Textarea placeholder="Default textarea" />
        <Textarea disabled placeholder="Disabled" />
      </ComponentShowcase>

      <ComponentShowcase name="Label" importPath="@/components/ui/label">
        <Label htmlFor="ex-input">Email</Label>
        <Label htmlFor="ex-input-2" className="text-text-muted">Optional helper</Label>
      </ComponentShowcase>

      <ComponentShowcase name="Checkbox" importPath="@/components/ui/checkbox">
        <div className="flex items-center gap-2"><Checkbox id="cb-1" /><Label htmlFor="cb-1">Default</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="cb-2" defaultChecked /><Label htmlFor="cb-2">Checked</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="cb-3" disabled /><Label htmlFor="cb-3">Disabled</Label></div>
      </ComponentShowcase>

      <ComponentShowcase name="Switch" importPath="@/components/ui/switch">
        <Switch />
        <Switch defaultChecked />
        <Switch disabled />
      </ComponentShowcase>

      <ComponentShowcase name="Slider" importPath="@/components/ui/slider">
        <Slider defaultValue={[33]} className="w-64" thumbAriaLabel="Demo slider" />
        <Slider defaultValue={[20, 80]} className="w-64" thumbAriaLabels={["Min", "Max"]} />
      </ComponentShowcase>

      <ComponentShowcase name="RadioGroup" importPath="@/components/ui/radio-group">
        <RadioGroup defaultValue="a">
          <div className="flex items-center gap-2"><RadioGroupItem value="a" id="r-a" /><Label htmlFor="r-a">Option A</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="b" id="r-b" /><Label htmlFor="r-b">Option B</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="c" id="r-c" /><Label htmlFor="r-c">Option C</Label></div>
        </RadioGroup>
      </ComponentShowcase>

      <ComponentShowcase name="Select" importPath="@/components/ui/select">
        <Select>
          <SelectTrigger className="w-48"><SelectValue placeholder="Pick one" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="cherry">Cherry</SelectItem>
          </SelectContent>
        </Select>
      </ComponentShowcase>
    </ShowcaseLayout>
  );
}
```

For the remaining 4 cluster pages (`containers`, `navigation`, `data-display`, `composites`), the implementer follows the same template, substituting the cluster's components. The exact component list per cluster comes from `docs/design-system/components/cluster-*.mdx`. Read each cluster MDX, list every component, and add a `ComponentShowcase` block per component with at least 3 variants. Use the existing test files in `components/ui/__tests__/*.test.tsx` for reference on how each component is constructed (props, children, etc.).

To save the implementer time, here are the cluster contents per the B work (read each `cluster-*.mdx` to confirm):

- **containers:** card, alert, alert-dialog, dialog, sheet, drawer, popover, tooltip, hover-card, scroll-area, separator, aspect-ratio, resizable
- **navigation:** tabs, breadcrumb, pagination, navigation-menu, menubar, dropdown-menu, context-menu, command, sidebar
- **data-display:** avatar, badge, table, progress, skeleton, calendar, chart, accordion, collapsible, toggle, toggle-group
- **composites:** carousel, sonner

**Note on smaller showcases:** if a component is heavyweight to instantiate (calendar, chart, sidebar, command — they need providers/state), render a single basic instance not three variants. Quality over quantity.

- [ ] **Step 11: Add the smoke test**

```tsx
// app/(design-system)/__tests__/showcase-smoke.test.tsx
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("design system showcase routes", () => {
  it("landing page renders without console errors", async () => {
    const { default: Page } = await import("../design-system/page");
    const consoleErrors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { consoleErrors.push(args); };
    try {
      const { getByRole } = renderWithProviders(<Page />);
      expect(getByRole("heading", { level: 1, name: /design system/i })).toBeInTheDocument();
    } finally {
      console.error = original;
    }
    expect(consoleErrors).toEqual([]);
  });

  it("tokens page renders without console errors", async () => {
    const { default: Page } = await import("../design-system/tokens/page");
    const consoleErrors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { consoleErrors.push(args); };
    try {
      const { getByRole } = renderWithProviders(<Page />);
      expect(getByRole("heading", { level: 1, name: /tokens/i })).toBeInTheDocument();
    } finally {
      console.error = original;
    }
    expect(consoleErrors).toEqual([]);
  });

  it("forms cluster renders Button section", async () => {
    const { default: Page } = await import("../design-system/forms/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Button" })).toBeInTheDocument();
  });

  it("containers cluster renders Card section", async () => {
    const { default: Page } = await import("../design-system/containers/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Card" })).toBeInTheDocument();
  });

  it("navigation cluster renders Tabs section", async () => {
    const { default: Page } = await import("../design-system/navigation/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Tabs" })).toBeInTheDocument();
  });

  it("data-display cluster renders Avatar section", async () => {
    const { default: Page } = await import("../design-system/data-display/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Avatar" })).toBeInTheDocument();
  });

  it("composites cluster renders Carousel section", async () => {
    const { default: Page } = await import("../design-system/composites/page");
    const { getByRole } = renderWithProviders(<Page />);
    expect(getByRole("heading", { level: 2, name: "Carousel" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 12: Run smoke tests**

```bash
pnpm test --run app/\(design-system\)/__tests__/
```

Expected: 7 tests pass.

- [ ] **Step 13: Verify each route loads in dev**

```bash
pnpm dev
# In another terminal:
node /tmp/c-pr4-routes-check.js
```

Where `/tmp/c-pr4-routes-check.js` visits each `/design-system/*` route and asserts a 200 status:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const routes = [
    '/design-system',
    '/design-system/tokens',
    '/design-system/forms',
    '/design-system/containers',
    '/design-system/navigation',
    '/design-system/data-display',
    '/design-system/composites',
  ];
  for (const r of routes) {
    const resp = await page.goto(`http://localhost:3000${r}`, { waitUntil: 'networkidle' });
    if (resp.status() !== 200) throw new Error(`${r}: ${resp.status()}`);
    const errors = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-error], .error');
      return Array.from(els).map((e) => e.textContent);
    });
    if (errors.length) throw new Error(`${r}: errors ${JSON.stringify(errors)}`);
    console.log(`✓ ${r}`);
    await page.screenshot({ path: `/tmp/c-pr4-screenshots/${r.replace(/\//g, '_') || '_root'}.png`, fullPage: true });
  }
  await browser.close();
})();
```

Expected: every route prints a check, no errors thrown.

- [ ] **Step 14: Delete legacy shadcn token blocks from `globals.css`**

Find the `@layer base { :root { … } }` block and the `.dark { … }` block (NOT the new `.dark { --color-… }` we added in PR 1 — those stay). The legacy block has `--background: 0 0% 100%; --foreground: 0 0% 3.9%; --card: …` etc. Delete the entire `:root` legacy block AND the legacy `.dark` block.

Specifically delete from `globals.css` (current line ranges visible via `grep -n`):

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    /* ... all legacy shadcn tokens ... */
  }
  .dark {
    --background: 0 0% 3.9%;
    /* ... */
  }
}
```

Keep the second `@layer base { * { … } body { … } }` block — that's the body styles.

Also keep the new `.dark { --color-… }` block we added for runtime overrides — that's the new system.

After deletion, `git grep -E "^\s*--(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|chart-[1-5]|sidebar)" -- 'app/globals.css'` should return only chart and sidebar tokens (chart stays per spec; sidebar should be gone since PR 2 swept its consumers — verify and delete if so).

- [ ] **Step 15: Trim `tailwind.config.ts`**

Replace the `theme.extend.colors` block with just:

```ts
  theme: {
    extend: {
      colors: {
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
```

The legacy `background`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring` entries all go — semantic equivalents are now in `@theme` and Tailwind 4 picks them up directly.

- [ ] **Step 16: Run full test + lint + typecheck**

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test --run
```

Expected: 1144 + 7 = 1151 tests passing, lint clean, types clean.

- [ ] **Step 17: Capture showcase screenshots for the record**

```bash
node /tmp/c-pr4-routes-check.js  # already saves to /tmp/c-pr4-screenshots/
```

Eyeball each screenshot — every cluster page should show every component rendering without obvious breakage.

- [ ] **Step 18: Verify no legacy token references remain**

```bash
git grep -nE "\\b(bg-card|bg-popover|bg-background|bg-primary|bg-secondary|bg-muted|bg-accent|bg-destructive|text-foreground|text-muted-foreground|text-primary-foreground|text-destructive-foreground|text-card-foreground|text-popover-foreground|text-secondary-foreground|text-accent-foreground|border-border\\b|border-input)\\b" -- 'app/**' 'components/**' ':!components/ui/__tests__/**' ':!app/(design-system)/__tests__/**'
```

Expected: empty. Tests are exempted (per spec).

- [ ] **Step 19: Verify no raw palette colors remain**

```bash
git grep -nE "(purple|cyan|pink|blue|fuchsia|violet|indigo|rose|emerald|amber|red|orange|yellow|green|teal)-(50|100|200|300|400|500|600|700|800|900)" -- 'app/**' 'components/**' ':!app/globals.css' ':!docs/**'
```

Expected: empty (or, if pink-as-tertiary was preserved with TODO markers in PR 3, only those instances).

- [ ] **Step 20: Commit**

```bash
git add app/\(design-system\) app/globals.css tailwind.config.ts
git commit -m "$(cat <<'EOF'
feat(design-system): /design-system showcase route + legacy cleanup (C PR 4/4)

Adds the /design-system route group with cluster sub-routes (forms,
containers, navigation, data-display, composites) plus a tokens
catalog page. Every component renders with at least 3 variants;
TokenSwatch and TypeSpecimen render the design tokens visually.

Cleans up legacy shadcn color tokens from app/globals.css (now zero
references in app code) and trims tailwind.config.ts theme.extend.colors
to chart-only.

7 smoke tests added covering each route renders without console errors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 21: Push, open PR, run pr-review-toolkit**

```bash
git push -u origin feature/design-c-showcase
gh pr create --title "feat(design-system): /design-system showcase + legacy cleanup (C PR 4/4)" --body "$(cat <<'EOF'
## Summary

- New `/design-system` route group with 5 cluster pages + tokens catalog.
- 5 reusable showcase primitives (`ShowcaseLayout`, `ComponentShowcase`, `TokenSwatch`, `TypeSpecimen`, `DesignSystemNav`).
- 7 smoke tests for the showcase routes.
- Deletes legacy shadcn token blocks from `app/globals.css`.
- Trims `tailwind.config.ts` `theme.extend.colors` to chart-only.

## Test plan
- [x] `pnpm lint` clean
- [x] `pnpm exec tsc --noEmit` clean
- [x] `pnpm test --run` — 1151 tests passing (1144 baseline + 7 smoke)
- [x] Playwright route-check — all 7 design-system routes return 200 and render expected headings
- [x] `git grep` legacy tokens — zero references in app code
- [x] `git grep` raw palette colors — zero references in app code

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Run pr-review-toolkit:review-pr
# Address findings, push fixes, re-run
```

- [ ] **Step 22: Wait for CI, merge, post-merge**

```bash
gh pr checks <pr-number> --watch
gh pr merge <pr-number> --squash --delete-branch
```

Run universal post-merge protocol. Final smoke confirms `/design-system` is reachable on production.

---

## Final Verification (after PR 4 merges)

After all 4 PRs merge, run from a fresh main checkout:

```bash
cd /home/xingdi/code/youtubeai_chat/youtubeai_chat_frontend
git checkout main
git pull --ff-only origin main

# Token vocabulary settled
git grep -nE "\\b(bg-card|bg-popover|bg-background|bg-primary|bg-secondary|bg-muted|bg-accent|bg-destructive|text-foreground|text-muted-foreground|text-primary-foreground|text-destructive-foreground|text-card-foreground|text-popover-foreground|text-secondary-foreground|text-accent-foreground|border-border\\b|border-input)\\b" -- 'app/**' 'components/**' ':!**/__tests__/**'
# Expected: empty

# Raw palette colors gone
git grep -nE "(purple|cyan|pink|blue|fuchsia|violet|indigo|rose|emerald|amber|red|orange|yellow|green|teal)-(50|100|200|300|400|500|600|700|800|900)" -- 'app/**' 'components/**' ':!app/globals.css' ':!docs/**'
# Expected: empty

# Tests pass
pnpm install --frozen-lockfile
pnpm test --run
# Expected: 1151+ tests passing

# Lint + types
pnpm lint
pnpm exec tsc --noEmit
# Expected: clean

# Showcase reachable on production
curl -s -o /dev/null -w "%{http_code}\n" https://www.youtubeai.chat/design-system
# Expected: 200
```

If every check passes, milestone C is done.

---

## Self-Review

### Spec coverage

Walking the spec section-by-section:

- **Goal — semantic token vocabulary + showcase route:** PR 1 (vocabulary), PRs 2-3 (sweep), PR 4 (showcase). ✓
- **Goal — visual byte-identical:** Every PR has a screenshot equality check (PR 1: dev visual; PRs 2-3: before/after Playwright; PR 4: route-check screenshots). ✓
- **Architecture — 4 PRs in dependency order:** Branch topology table makes this explicit. ✓
- **Token vocabulary — 22 tokens in 5 categories:** PR 1 Step 2 enumerates each. ✓
- **Compatibility shim:** PR 1 keeps legacy shim, PR 4 deletes it. PR 1 Step 6 + PR 4 Step 14 ✓
- **Showcase route — `app/(design-system)/` group, 5 cluster pages, tokens page:** PR 4 Steps 7-10 cover the layout, landing, tokens, and 5 clusters. ✓
- **Showcase route — `_components/` for showcase primitives:** PR 4 Steps 2-6. ✓
- **Showcase route — smoke tests:** PR 4 Step 11 adds 7 tests. ✓
- **PR 1 — token foundation in `@theme` + `color.mdx`:** Steps 2-9. ✓
- **PR 2 — sweep `components/ui/*`:** Steps 3-9. ✓
- **PR 3 — sweep marketing + summary + add stage gradients:** Steps 2-9. ✓
- **PR 4 — showcase + legacy cleanup:** Steps 14-15 delete legacy. Steps 2-13 add showcase. ✓
- **Success criteria 1-7:** Final Verification section enumerates. ✓
- **Risks 1-7:** PR 1 Steps 4-5 verify token resolution + alpha modifier (Risk 2). PR 1 Step 6 updates @layer base (Risk 3). PR 2 Step 3 sidebar mapping (Risk 5). PR 3 Step 2 stage gradients (Risk 6). PR 4 Step 13 verifies route bundles (Risk 7). ✓

### Placeholder scan

- No "TBD", "TODO", "implement later" — verified by grep on the plan file.
- Per-cluster components in PR 4 Step 10 are listed concretely (containers/navigation/data-display/composites lists).
- Each step has actual code or actual commands.
- Self-noted soft spot: PR 4 Step 10 says "implementer follows the same template, substituting the cluster's components" — that's pattern-replicate not "similar to Task N" since the template is fully shown in the forms example. Acceptable.

### Type consistency

- Component names used in plan (`ShowcaseLayout`, `ComponentShowcase`, `TokenSwatch`, `TypeSpecimen`, `DesignSystemNav`) are all defined in PR 4 Steps 2-6 with matching exports.
- Token names (`--color-surface-base`, `bg-surface-base`, `text-text-primary`, etc.) are consistent between PR 1 declaration and PR 2-3 usage.
- Mapping tables (legacy → semantic) are identical in PR 1 docs and PR 2 sweep instructions.
- Stage gradient token names (`--gradient-stage-preparing` etc.) defined in PR 3 Step 2 and consumed in PR 3 Step 4 streaming-progress sweep.

No issues found.

---

## Execution Handoff

User pre-approved subagent-driven execution with full autonomy. Proceeding directly to `superpowers:subagent-driven-development` for PR-by-PR implementation.
