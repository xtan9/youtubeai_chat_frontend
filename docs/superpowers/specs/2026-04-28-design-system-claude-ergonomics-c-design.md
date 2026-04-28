# Milestone C — Design System: Claude Design Ergonomics

**Status:** Spec
**Date:** 2026-04-28
**Predecessors:** B (Design System Rebuild — 47 components governed, MDX docs, 1144 tests)
**Successors (deferred, not in C):** brand identity, `tokens.ts` programmatic export, component cookbook, MDX-as-Next-route docs site, visual regression infra

---

## Goal

Reorganize the codebase so an AI agent (Claude) can **explore, design, and apply** within the design system as fluently as possible. Two concrete artefacts:

1. **Semantic token vocabulary.** Replace the legacy shadcn-shape color tokens (`--background`, `--card`, `--muted-foreground`, etc.) with a lean intent-named taxonomy (`--surface-base`, `--text-primary`, `--border-subtle`, etc.) defined in Tailwind 4's `@theme`. Sweep all 47 components and the marketing/summary pages so every color reference goes through a semantic token. Future brand swaps become one-line token edits, not 90-file sweeps.
2. **Rendered showcase route.** Add `/design-system` plus 5 cluster sub-routes and a tokens catalog page, where every component renders with its variants in light + dark modes. Lets Claude (and humans) *see* the system via Playwright screenshots instead of spinning up scratch pages, and gives the MDX docs a visual companion.

**Non-goal:** picking a real brand palette or typography family. Token *values* stay byte-identical to current production. C is infrastructure; brand identity is a separate future cycle.

---

## Architecture

The work splits into two parallel axes that converge in the showcase:

```
  Token vocabulary (semantic rename)         Showcase route (visual surface)
  ────────────────────────────────────       ──────────────────────────────
  globals.css @theme — new token names       app/(design-system)/* — new routes
              │                                          │
              ▼                                          ▼
  components/ui/* sweep — internal refs      Render every component with
              │                              its variants (light + dark)
              ▼                                          │
  app/components/* + app/summary/* sweep                │
  (raw purple-500/cyan-500 → semantic accents)         │
              │                                          │
              └────────────► Tokens settle ◄────────────┘
```

C ships in 4 PRs in dependency order: tokens land first so every later PR rests on the same vocabulary.

**Visual invariant:** every PR must be screenshot-equal to its predecessor on every existing route. The whole point of mapping new tokens to current hex/HSL values is that no end-user-visible pixel changes. Tests + Playwright screenshots gate this.

---

## Tech Stack

- **Tailwind 4** `@theme` directive for token declaration; existing `@custom-variant dark` shim unchanged.
- **CSS variable scoping** — light tokens in `@theme`, dark overrides via `.dark { --color-…: …; }` outside `@theme` (pattern already used in B PR 1).
- **Next.js 16 App Router route groups** — showcase lives under `app/(design-system)/` route group so it doesn't interfere with the marketing layout (`app/layout.tsx`) and gets its own `layout.tsx` with cluster nav.
- **MDX** — extend `docs/design-system/tokens/` with a new `color.mdx` documenting the semantic taxonomy. The showcase route also renders this catalog.
- **Existing test infrastructure** — vitest 4 + jest-axe + happy-dom 20; new showcase routes get smoke tests but not full a11y test suite (pages just render existing already-tested components).

---

## Token Vocabulary

The taxonomy uses 5 categories with intent-named levels. Every token is a `--color-*` variable in `@theme` so Tailwind 4 auto-generates the matching `bg-*` / `text-*` / `border-*` utility class.

### 1. Surfaces (5 tokens)

Backgrounds at different elevation levels.

| Token | Utility | Maps to (light) | Maps to (dark) | When to reach for |
|-------|---------|-----------------|----------------|-------------------|
| `--color-surface-base` | `bg-surface-base` | `hsl(0 0% 100%)` (current `--background`) | `hsl(0 0% 3.9%)` | Page background |
| `--color-surface-raised` | `bg-surface-raised` | `hsl(0 0% 100%)` (current `--card`) | `hsl(0 0% 3.9%)` | Cards, panels, dialogs sitting on the page |
| `--color-surface-overlay` | `bg-surface-overlay` | `hsl(0 0% 100%)` (current `--popover`) | `hsl(0 0% 3.9%)` | Floating popovers, dropdowns, tooltips |
| `--color-surface-sunken` | `bg-surface-sunken` | `hsl(0 0% 96.1%)` (current `--secondary`) | `hsl(0 0% 14.9%)` | Inset wells, code blocks, deemphasized fills |
| `--color-surface-inverse` | `bg-surface-inverse` | `hsl(0 0% 9%)` | `hsl(0 0% 98%)` | High-contrast emphasis (toasts, dark CTAs in light mode) |

### 2. Text (5 tokens)

By hierarchy / emphasis. Each one has a documented contrast partner from the surface scale.

| Token | Utility | Maps to (light) | Maps to (dark) | When to reach for |
|-------|---------|-----------------|----------------|-------------------|
| `--color-text-primary` | `text-text-primary` | `hsl(0 0% 3.9%)` (current `--foreground`) | `hsl(0 0% 98%)` | Default body and heading text |
| `--color-text-secondary` | `text-text-secondary` | `hsl(0 0% 25%)` | `hsl(0 0% 75%)` | Subheadings, bylines, secondary info |
| `--color-text-muted` | `text-text-muted` | `hsl(0 0% 45.1%)` (current `--muted-foreground`) | `hsl(0 0% 63.9%)` | Captions, helper text, timestamps |
| `--color-text-disabled` | `text-text-disabled` | `hsl(0 0% 70%)` | `hsl(0 0% 40%)` | Disabled controls, unavailable items |
| `--color-text-inverse` | `text-text-inverse` | `hsl(0 0% 98%)` | `hsl(0 0% 9%)` | Text sitting on `surface-inverse` |

> **Note** on the doubled prefix (`text-text-primary`): Tailwind 4 derives the utility name from the token name, so `--color-text-primary` becomes `bg-text-primary` / `text-text-primary` / `border-text-primary`. The `text-text-*` reads awkwardly but is unambiguous and grep-friendly. Alternatives (e.g., `--color-fg-primary` → `text-fg-primary`) trade clarity for prefix collisions with future fg/bg pairs and were rejected.

### 3. Borders (3 tokens)

By emphasis.

| Token | Utility | Maps to (light) | Maps to (dark) | When to reach for |
|-------|---------|-----------------|----------------|-------------------|
| `--color-border-subtle` | `border-border-subtle` | `hsl(0 0% 89.8%)` (current `--border`) | `hsl(0 0% 14.9%)` | Default dividers, card outlines |
| `--color-border-default` | `border-border-default` | `hsl(0 0% 80%)` | `hsl(0 0% 22%)` | Form inputs, buttons (rest) |
| `--color-border-strong` | `border-border-strong` | `hsl(0 0% 60%)` | `hsl(0 0% 50%)` | Emphasized outlines, focus rings on raised surfaces |

### 4. Accents (5 tokens)

Semantic intent colors. The brand pair is the primary accent; the others map to status conventions.

| Token | Utility | Maps to (light) | Maps to (dark) | When to reach for |
|-------|---------|-----------------|----------------|-------------------|
| `--color-accent-brand` | `bg-accent-brand` / `text-accent-brand` | current `purple-500` | `purple-400` | Primary CTAs, brand emphasis |
| `--color-accent-brand-secondary` | `bg-accent-brand-secondary` / `text-accent-brand-secondary` | current `cyan-500` | `cyan-400` | Brand pair (gradient endpoints, secondary brand surfaces) |
| `--color-accent-success` | `bg-accent-success` / `text-accent-success` | `emerald-500` | `emerald-400` | Success toasts, completion checks |
| `--color-accent-warning` | `bg-accent-warning` / `text-accent-warning` | `amber-500` | `amber-400` | Warning banners, caution flags |
| `--color-accent-danger` | `bg-accent-danger` / `text-accent-danger` | current `--destructive` | dark `--destructive` | Destructive CTAs, error states |

### 5. Interaction states (4 tokens)

Stateful overlays applied via `data-*` or `:hover` etc. These are *additive overlays*, not standalone backgrounds — they layer on top of surface tokens with low alpha.

| Token | Utility | Maps to (light) | Maps to (dark) | When to reach for |
|-------|---------|-----------------|----------------|-------------------|
| `--color-state-hover` | `bg-state-hover` | `hsl(0 0% 0% / 0.04)` | `hsl(0 0% 100% / 0.06)` | Hover overlay on raised surfaces |
| `--color-state-pressed` | `bg-state-pressed` | `hsl(0 0% 0% / 0.08)` | `hsl(0 0% 100% / 0.10)` | Active/pressed overlay |
| `--color-state-focus` | `ring-state-focus` (via `--ring`) | current `--ring` | dark `--ring` | Focus rings; aliased to existing `--ring` for compatibility |
| `--color-state-disabled` | `bg-state-disabled` | `hsl(0 0% 0% / 0.04)` | `hsl(0 0% 100% / 0.04)` | Disabled overlay; combine with `text-text-disabled` |

### Total: 22 semantic color tokens

Plus existing typography (16), motion (8), gradient (6), spacing (1 base unit), radius (8 default), shadow (7 default), blur (7 default) — **roughly the "lean ~25" we set out to define, with a slight under-budget that leaves room for one or two additions during implementation if a real gap surfaces.**

### Compatibility shim

To avoid a flag-day rewrite, the legacy shadcn tokens stay defined in `@layer base { :root { … } .dark { … } }` for the duration of PR 1, mapped to the same hex values they're set to today. PR 2 sweeps `components/ui/*` to the new names. PR 3 sweeps marketing/summary. After PR 3 there are zero references to legacy names in our code (verified by grep), and PR 4 deletes the legacy declarations from `globals.css`.

The Tailwind config (`tailwind.config.ts`) currently extends `theme.colors` with the legacy names. PR 4 cleans this up — once nothing reads them, the config bridge can shrink.

---

## Showcase Route

Lives at `app/(design-system)/` — Next.js 16 route group so it gets a dedicated layout without affecting marketing routes.

```
app/
└── (design-system)/
    ├── layout.tsx                       — Sidebar nav + theme toggle + skip link
    ├── design-system/
    │   ├── page.tsx                     — Landing (links to clusters + tokens)
    │   ├── tokens/
    │   │   └── page.tsx                 — All tokens rendered visually
    │   ├── forms/page.tsx               — Form components with variants
    │   ├── containers/page.tsx          — Containers cluster
    │   ├── navigation/page.tsx          — Navigation cluster
    │   ├── data-display/page.tsx        — Data display cluster
    │   └── composites/page.tsx          — Composites cluster
    └── _components/
        ├── ComponentShowcase.tsx        — Wraps each demo with title + variants
        ├── TokenSwatch.tsx              — Renders one color token (swatch + name + value)
        ├── TypeSpecimen.tsx             — Renders a typography token (sample + metrics)
        └── DesignSystemNav.tsx          — Cluster nav sidebar
```

### Page conventions

Every cluster page follows the same shape:

```tsx
export default function FormsPage() {
  return (
    <ShowcaseLayout title="Forms">
      <ComponentShowcase name="Button" import="@/components/ui/button">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button disabled>Disabled</Button>
      </ComponentShowcase>
      {/* ...one block per component in the cluster... */}
    </ShowcaseLayout>
  );
}
```

Each `ComponentShowcase` renders the component name, a code-import hint (so I can copy/paste the import), and the variants laid out in a responsive grid. Light + dark modes are toggled via the page-level theme switcher in the layout — rendering both side-by-side per component would double the page length and is rejected.

### Tokens page

`/design-system/tokens` displays:

- **Color palette** — every semantic token rendered as a labelled swatch grouped by category (surfaces, text-on-surface contrast pairs, borders, accents, interaction states). Hex values shown.
- **Typography** — every `--text-*` rendered with sample copy.
- **Motion** — duration tokens with an animated demo.
- **Gradients** — every gradient utility rendered as a wide swatch.
- **Spacing / radius / shadow / blur** — visual demos.

The tokens page is the source-of-truth visual reference. It and the cluster pages together let me screenshot the entire system in two clicks.

### Out of scope for the showcase

- **Live prop editing.** Variants are static; no Storybook-style controls. A future cycle could add this if it proves valuable.
- **Code-export buttons.** The MDX docs are the canonical reference; the showcase is the visual companion.
- **MDX rendering as a Next route.** Just the showcase pages. Putting `*.mdx` on the routing table is a separate (smaller) future cycle.
- **SEO / public access.** The route is reachable but unlinked from marketing; no sitemap entry, no public link. Internal tool only.

---

## PR Phasing

4 implementation PRs after the spec/plan PR.

### PR 0 — Spec + plan (this document)

Doc-only. Get review, merge, then start PR 1.

### PR 1 — Token foundation

- Define all 22 semantic color tokens in `@theme` in `app/globals.css`.
- Add `.dark` overrides outside `@theme` for each.
- Keep legacy `:root` / `.dark` shadcn tokens unchanged (compatibility shim).
- Write `docs/design-system/tokens/color.mdx` documenting the new taxonomy.
- Update existing `docs/design-system/components/cluster-*.mdx` files' tokens-used columns are out of date — touched only if grep shows discrepancies, otherwise skipped.
- **Visual:** screenshot-equal to `main` (no consumer code references new tokens yet, so nothing renders differently).
- **Tests:** existing 1144 tests still pass; no new tests in this PR (no behavior change).

### PR 2 — Sweep `components/ui/*`

- Replace every shadcn-shape token reference (`bg-card`, `bg-popover`, `bg-background`, `text-foreground`, `text-muted-foreground`, `border-input`, `border-border`, `bg-destructive`, `bg-secondary`, etc.) inside `components/ui/*.tsx` with the matching semantic token.
- Mapping table (canonical, used to drive the sweep):
  - `bg-background` → `bg-surface-base`
  - `bg-card` → `bg-surface-raised`
  - `bg-popover` → `bg-surface-overlay`
  - `bg-secondary` → `bg-surface-sunken`
  - `bg-muted` → `bg-surface-sunken`
  - `text-foreground` → `text-text-primary`
  - `text-muted-foreground` → `text-text-muted`
  - `text-card-foreground` / `text-popover-foreground` / `text-secondary-foreground` / `text-accent-foreground` → `text-text-primary` (their actual values are all `--foreground` today)
  - `text-primary-foreground` → `text-text-inverse` (white-on-dark CTAs in light mode; inverse pair to `bg-primary` → `bg-surface-inverse`)
  - `text-destructive-foreground` → `text-text-inverse` (white-on-red)
  - `border-border` → `border-border-subtle`
  - `border-input` → `border-border-default`
  - `bg-primary` → `bg-surface-inverse` (the shadcn `primary` = inverse foreground today)
  - `bg-destructive` → `bg-accent-danger`
  - `bg-accent` → `bg-state-hover` *or* `bg-surface-sunken` depending on context (audit each usage)
- 1144 tests must still pass. A11y suppressions stay unchanged (selectors don't move).
- **Visual:** screenshot-equal to PR 1.
- The implementer subagent runs Playwright on `/`, `/auth/login`, `/auth/signup`, `/summary` (representative routes) and compares before/after screenshots.

### PR 3 — Sweep marketing + summary

- Sweep the 17 files surfaced by grep:
  - `app/components/{benefits,faq,header,hero-section,how-it-works,input-form,testimonials,use-cases}.tsx`
  - `app/summary/components/{streaming-progress,summary-content,summary-stats,transcript-paragraphs,video-info-card}.tsx`
  - `app/summary/page.tsx`
  - `components/{auth-button,profile-avatar}.tsx`
- Replace raw palette references (`purple-500`, `cyan-500`, `pink-500`, `blue-500`) with semantic accents (`accent-brand`, `accent-brand-secondary`) or existing gradient utilities.
- Where opacity variants are used (`purple-500/20`), preserve via the `bg-accent-brand/20` Tailwind syntax — Tailwind 4 supports modifier syntax on arbitrary color tokens.
- Where dark-mode variants used different shades (`dark:from-purple-400`), the new token already ships dark variants automatically — drop the `dark:` variant.
- **Visual:** screenshot-equal to PR 2 on home page, summary page, and auth pages.
- **Tests:** existing tests still pass.

### PR 4 — Showcase route + legacy cleanup

- Add `app/(design-system)/` route group with layout, nav, theme toggle.
- Add `/design-system` landing page.
- Add `/design-system/tokens` catalog page (with `_components/TokenSwatch` + `TypeSpecimen`).
- Add `/design-system/{forms,containers,navigation,data-display,composites}` cluster pages.
- Each cluster page renders every component in the cluster with at least 3 representative variants.
- Add smoke tests under `app/(design-system)/__tests__/showcase-smoke.test.tsx` — render each route, assert at least one expected component name appears, no console errors.
- Add Playwright screenshot test that visits each showcase page in light + dark mode and saves screenshots to `screenshots/design-system/` (gitignored — these are dev tools, not regression artifacts).
- **Cleanup:** delete legacy shadcn tokens from `:root` / `.dark` blocks in `globals.css` (zero references remain). Trim `tailwind.config.ts` `theme.extend.colors` accordingly.
- **Tests:** existing 1144 + ~7 smoke tests.

---

## Success Criteria

C is done when all of these are true on `main`:

1. **Token vocabulary settled.** `git grep` for legacy shadcn token names (`bg-card`, `bg-popover`, `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `bg-secondary`, `bg-muted`, `bg-accent`, `bg-destructive`, `border-border`, `border-input`) inside `app/**` and `components/**` returns 0 results. (Tests are exempted — they may reference legacy names.)
2. **No raw palette colors.** `git grep -E "(purple|cyan|pink|blue|fuchsia|violet|indigo|rose|emerald|amber|red|orange|yellow|green|teal)-(50|100|200|300|400|500|600|700|800|900)"` in `app/**` and `components/**` returns 0 results outside `globals.css` (token definitions) and existing gradient utilities.
3. **Showcase reachable.** `/design-system`, `/design-system/tokens`, and 5 cluster pages all render without console errors and pass smoke tests.
4. **Visuals stable.** Playwright screenshots of `/`, `/auth/login`, `/auth/signup`, `/summary` are visually identical between PR 0 and post-PR-4 (manual review of diff PNGs).
5. **Test count.** ≥1144 tests pass; new smoke tests added for showcase routes.
6. **Lint + type clean.** `pnpm lint` and `pnpm typecheck` pass with 0 warnings introduced.
7. **Docs.** `docs/design-system/tokens/color.mdx` exists and lists all 22 tokens with mappings.

---

## Risks & Mitigations

### Risk 1: token sweep introduces visual regressions

**Mitigation:** every token in PR 1 maps to the exact same hex/HSL value the legacy token holds today. Sweeps in PRs 2-3 are pure search-and-replace at the class level. Playwright screenshot comparison gates each sweep.

### Risk 2: opacity-modifier syntax on custom tokens breaks

Tailwind 4 supports `bg-{token}/{alpha}` for any `--color-*` token in `@theme`, but this assumes the token's value is in a color space that supports modifier injection (HSL, RGB, OKLCH all work; literal `linear-gradient(…)` does not). All 22 tokens are flat colors — no gradients in the color taxonomy — so this is safe.

**Mitigation:** PR 1 includes a smoke check: render `<div class="bg-surface-raised/50 bg-accent-brand/20 text-text-muted/60">` and assert via Playwright that the resulting `background-color` / `color` values include alpha. If any token fails the modifier test, fix it in PR 1 before any sweep.

### Risk 3: legacy `--background` / `--foreground` are referenced via `hsl(var(--…))` in `globals.css` body styles

The `@layer base` block at line 247 has `* { @apply border-[hsl(var(--border))] outline-[hsl(var(--ring))]/50; }` and `body { @apply bg-[hsl(var(--background))] text-[hsl(var(--foreground))]; }`. These need to migrate to the new tokens too.

**Mitigation:** PR 1 updates the `@layer base` block to read from `var(--color-surface-base)` / `var(--color-text-primary)` / `var(--color-border-subtle)` directly. The Tailwind 4 token names resolve to the same values as the legacy variables, so visuals stay identical.

### Risk 4: chart-specific tokens (`--chart-1` through `--chart-5`)

These are referenced by Recharts via `hsl(var(--chart-1))` style. They're not part of the semantic taxonomy because they're chart-specific (data series colors, not UI surfaces).

**Mitigation:** chart tokens stay as-is. They're a sub-taxonomy under "data viz" and could get their own future cycle if needed. Sweep ignores `--chart-*`.

### Risk 5: sidebar tokens (`--sidebar-*`)

The legacy `globals.css` defines `--sidebar`, `--sidebar-foreground`, etc. for the sidebar component family. These are referenced by `components/ui/sidebar.tsx`.

**Mitigation:** in PR 2, sidebar tokens get migrated to the standard semantic vocabulary (`bg-surface-raised`, `text-text-primary`, `border-border-subtle`) — the sidebar is just a panel, it doesn't need its own token namespace. PR 4 deletes `--sidebar-*` from `globals.css`.

### Risk 6: `streaming-progress.tsx` uses arbitrary gradient stop classes

`from-blue-500 to-cyan-500`, `from-purple-500 to-pink-500`, `from-green-500 to-emerald-500` etc. are stage-specific progress gradients. B PR 1 added 6 generic gradient tokens (`brand-primary`, `brand-primary-hover`, `brand-accent`, `brand-soft`, `error`, `success`) but no stage-specific ones.

**Mitigation:** PR 3 adds new gradient tokens (`--gradient-stage-preparing`, `--gradient-stage-fetching`, `--gradient-stage-transcribing`, `--gradient-stage-summarizing`, `--gradient-stage-finalizing`) in `app/globals.css` matching the existing stage colors, plus matching `@utility` rules. The streaming-progress component then references `bg-gradient-stage-summarizing` etc. — semantic, swap-once-and-done.

### Risk 7: PR 4 showcase route adds bundle weight

Loading every UI component on one route increases the bundle. But the route is internal-only and uses Next.js 16 RSC by default, so individual components are tree-shaken into per-route bundles. The marketing routes don't pay for it.

**Mitigation:** verify with `pnpm build` after PR 4 — `/design-system/forms` etc. should be separate from `/`. If somehow shared, pivot to `dynamic()` imports per cluster.

---

## Out of Scope (deferred to future cycles)

- **Brand identity** — picking a real palette + typography family. C deliberately preserves current visuals.
- **`tokens.ts` programmatic export** — typed TS export of all token values. Useful for pixel-precise calculations in code (chart coloring, animation interpolation), but the `@theme` CSS layer covers 95% of usage.
- **Component cookbook** — recipe-style docs ("use this for marketing hero", "use this for settings form"). Useful for agent guidance but additive on top of existing MDX.
- **MDX rendered as Next routes** — would let humans browse docs in a browser. Currently MDX is files; agents read them via `Read`. Humans can use the showcase route or VS Code preview.
- **Visual regression infrastructure** (Chromatic / Percy) — explicitly deferred in B and stays deferred. Playwright screenshots are validation tools, not pinned regression artifacts.
- **Live prop editing** — Storybook-style controls in the showcase. Reach for this only if static variants prove insufficient.
- **Marketing component refactor** — the marketing components have layout opinions baked in (gradient halos, blur overlays, blob animations). C keeps them visually identical; a future cycle could redesign them.
- **TODO(B-followup) lint suppressions** — 10 narrow suppressions in app code from B PR 6. Out of scope for C; they're a focused follow-up cycle.

---

## Open Questions

None. All scope, taxonomy, ordering, and visual-stability questions resolved during brainstorming (see `2026-04-28` session for record).

---

## Appendix: prior art

- B spec: `docs/superpowers/specs/2026-04-27-design-system-rebuild-b-design.md`
- B plan: `docs/superpowers/plans/2026-04-27-design-system-rebuild-b.md`
- A1 spec: `docs/superpowers/specs/2026-04-27-deps-modernization-a1-design.md`
- Existing token MDX: `docs/design-system/tokens/{typography,motion,gradient,spacing,radius,shadow,blur}.mdx`
- Tailwind 4 `@theme` reference: https://tailwindcss.com/docs/theme
