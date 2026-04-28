# Design System

Source of truth for every design decision in `youtubeai_chat_frontend`.
Tokens, components, and patterns live here so that humans and Claude (the
agent) read the same contract.

## What's here

- [`tokens/`](./tokens/) — design token vocabulary. One MDX per category:
  - [`color.mdx`](./tokens/color.mdx) — semantic color taxonomy (surfaces,
    text, borders, accents, interaction states)
  - [`typography.mdx`](./tokens/typography.mdx) — display / heading / body
    / caption sizes
  - [`motion.mdx`](./tokens/motion.mdx) — duration + easing tokens
  - [`gradient.mdx`](./tokens/gradient.mdx) — brand and stage gradients
  - [`spacing.mdx`](./tokens/spacing.mdx) — base unit (Tailwind 4 idiom)
  - [`radius.mdx`](./tokens/radius.mdx) — corner radius
  - [`shadow.mdx`](./tokens/shadow.mdx) — elevation
  - [`blur.mdx`](./tokens/blur.mdx) — backdrop blur
- [`components/`](./components/) — per-cluster MDX docs. 5 cluster index
  files (forms, containers, navigation, data-display, composites) and 47
  component MDX files. Each component doc covers prop API, variants,
  accessibility, composition examples, token usage.

## Visual reference

`pnpm dev` then visit:

- [`/design-system`](http://localhost:3000/design-system) — landing page
- [`/design-system/tokens`](http://localhost:3000/design-system/tokens) —
  every token rendered as swatches and type specimens
- `/design-system/forms`, `/containers`, `/navigation`, `/data-display`,
  `/composites` — components rendered with variants, paired by cluster

The showcase route is for browsing, not authoring. If a component is
missing or a token is wrong on the showcase, fix it where it lives
(component or token definition) and the showcase reflects automatically.

## Audience

- **Claude (the agent):** reads the MDX files directly; the prop API,
  token vocabulary, and accessibility patterns are the contract. Never
  invent values or guess. Reach for `git grep` to find similar usages
  before writing new code.
- **Humans:** read the MDX, or browse the showcase route. The MDX files
  are the canonical reference; the showcase is the visual companion.

## Tailwind 4 conventions

The token vocabulary is built on Tailwind 4's
[`@theme` directive](https://tailwindcss.com/docs/theme). Defining
`--text-h1: 3rem;` in `@theme` auto-generates a `.text-h1` utility class.

| Category | Convention | Example |
|----------|-----------|---------|
| Colors | `--color-*` | `--color-surface-raised` → `.bg-surface-raised`, `.text-surface-raised`, `.border-surface-raised` |
| Font sizes | `--text-*` with paired `--text-*--line-height`, `--text-*--letter-spacing`, `--text-*--font-weight` | `--text-h1` → `.text-h1` |
| Spacing | `--spacing` single base unit | `--spacing: 0.25rem` → `.p-4` (= 4 × 0.25rem = 1rem) |
| Radius | `--radius-*` | `--radius-lg` → `.rounded-lg` |
| Shadow | `--shadow-*` | `--shadow-md` → `.shadow-md` |
| Blur | `--blur-*` | `--blur-md` → `.blur-md` |
| Easing | `--ease-*` | `--ease-out` → `.ease-out` |
| Duration | `--duration-*` | `--duration-base` → `.duration-base` |

**Gradients are different.** Tailwind 4 has no native `--gradient-*`
namespace, so `@theme { --gradient-brand-primary: …; }` does NOT
auto-generate a `.bg-gradient-brand-primary` utility. We bridge the gap
with the [`@utility` directive](https://tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities)
in `app/globals.css`. See [`tokens/gradient.mdx`](./tokens/gradient.mdx).

**Class-based dark mode** uses `@custom-variant dark (&:where(.dark, .dark *));`
in `app/globals.css`. Tailwind 4 ignores `darkMode: "class"` in
`tailwind.config.ts`. The `@custom-variant` directive is the bridge.

**Token overrides for dark mode** are class-scoped, declared outside
`@theme`:

```css
@theme {
  --color-surface-base: hsl(0 0% 100%);  /* light value */
}
.dark {
  --color-surface-base: hsl(0 0% 3.9%);  /* dark value */
}
```

## Lint enforcement

ESLint blocks raw palette classes (`bg-purple-500`, `text-red-400`, etc.)
in source files. Configured in `eslint.config.mjs` via
`no-restricted-syntax`. Exceptions are documented per-call-site with
`// eslint-disable-next-line no-restricted-syntax` and a
`// TODO(design-followup):` comment naming the missing semantic token.

The legacy shadcn token classes (`bg-card`, `bg-popover`, `text-foreground`,
`text-muted-foreground`, `border-input`, `border-border`, `bg-primary`,
`bg-secondary`, `bg-muted`, `bg-accent`, `bg-destructive`,
`*-foreground` of any of those) are not blocked at lint time but the
underlying CSS variables don't exist anymore. Using them silently produces
no styling. If you grep one of those class names in this repo and find a
hit outside `**/__tests__/**`, that's a bug to fix.

---

## Contributing

### Adding a component

A component is a primitive in `components/ui/*.tsx` (e.g.,
`button.tsx`, `dialog.tsx`). Most are shadcn-derived; some are local.

**1. Decide the cluster.** New components go into one of the 5 clusters:
forms, containers, navigation, data-display, composites. The cluster
membership determines which showcase page renders the component and which
MDX cluster file documents it.

**2. Write the component.** Follow the patterns in existing cluster
peers:

- Use `cva` from `class-variance-authority` for variants.
- Set `data-slot="component-name"` on the root element so consumers can
  target sub-parts via `[data-slot=…]` selectors.
- Use `cn()` from `@/lib/utils` for class merging.
- Wrap Radix primitives where applicable (`@radix-ui/react-*`).
- Use semantic tokens only (see CLAUDE.md or the lint rule).
- Forward `className` and other native props.

**3. Write tests.** Two test files per component, both in
`components/ui/__tests__/`:

- `<name>.test.tsx` — behavior tests using
  `tests-utils/renderWithProviders`. Cover variant rendering, default
  state, keyboard interaction (where Radix supports it in happy-dom),
  controlled/uncontrolled state if applicable.
- `<name>.a11y.test.tsx` — axe a11y test. Pick the right runner from
  `tests-utils/axe.ts`:
  - `axe` — default (most components)
  - `axeOverlay` — Radix focus guards (Dialog, Sheet, Drawer)
  - `axePortal` — portaled non-landmark content
  - `axePortalOverlay` — Radix menu family (DropdownMenu, ContextMenu,
    Menubar, NavigationMenu, Popover, HoverCard, Select, Tooltip)
  - `axeCommand` / `axeCommandDialog` — cmdk Command primitive
  - `axeResizable` — react-resizable-panels v4 separators
  - Add a new runner only if a documented axe rule needs suppression
    with rationale.

  Both test files should hit at least:
  - 1 default-render assertion
  - 1 variant assertion (if cva variants exist)
  - 1 disabled-state assertion (if applicable)
  - 1 keyboard-interaction smoke (focus + Tab) where the component
    accepts focus
  - 1 axe assertion in the a11y file

**4. Write MDX docs.** Two files in `docs/design-system/components/`:

- `<name>.mdx` — overview, prop table, variants, a11y notes, token
  references, composition example. Match the shape of an existing peer
  in the same cluster.
- The cluster index (`cluster-{cluster-name}.mdx`) gets a row added
  pointing to the new component.

**5. Add to the showcase.** Edit the cluster page at
`app/(design-system)/design-system/<cluster>/page.tsx`. Add a
`<ComponentShowcase>` block with at least 3 representative variants. Use
the existing forms cluster as the template.

**6. Pre-PR gates.** All four must pass:

```bash
pnpm test --run    # unit + a11y suite
pnpm lint
pnpm exec tsc --noEmit
```

Plus a Playwright e2e on the showcase route to confirm the component
renders without console errors.

### Adding a token

The token vocabulary is *closed by intent* — adding a token means a real
new use case the existing 22 colors / 16 typography / 8 motion / etc.
tokens don't cover. Before adding one, try to find an existing token
that fits.

**1. Decide the category.** Color (surfaces / text / borders / accents /
states) or one of the other categories (typography, motion, gradient,
spacing, radius, shadow, blur).

**2. Add to `app/globals.css`.**

For colors and typography, declare the token in the `@theme` block:

```css
@theme {
  --color-accent-tertiary: var(--color-pink-500);
}
```

For dark-mode color overrides, add to the `.dark` block (outside `@theme`):

```css
.dark {
  --color-accent-tertiary: var(--color-pink-400);
}
```

For gradients, follow the two-step pattern in
[`tokens/gradient.mdx`](./tokens/gradient.mdx) — declare in `@theme`, then
register a matching `@utility` rule.

**3. Document in MDX.** Update the relevant
`docs/design-system/tokens/<category>.mdx` to add a row to the token
table with: token name, utility class, light/dark values, when to reach
for it.

**4. Render in the showcase.** Edit
`app/(design-system)/design-system/tokens/page.tsx` to add a
`<TokenSwatch>` (for colors and gradients) or `<TypeSpecimen>` (for
typography) under the appropriate section.

**5. Test.** No new tests required for token addition itself, but if
you're using the new token in a component, that component's tests should
exercise it.

### Adding a variant to an existing component

**1. Edit the component's `cva` block** to add the new variant. Match
the prefix/keying convention of existing variants in the same component.

**2. Update the MDX prop table** in `docs/design-system/components/<name>.mdx`.

**3. Add to the showcase** if visually distinct — the cluster page's
`<ComponentShowcase>` block for this component should render the new
variant alongside the existing ones.

**4. Add a behavior test** for the variant in
`components/ui/__tests__/<name>.test.tsx`.

### Removing a component or token

Don't, unless it's verified unused. Run:

```bash
git grep -n "<ComponentName>\|tokenName" -- 'app/**' 'components/**' ':!**/__tests__/**'
```

If empty, deletion is safe. Update CLAUDE.md, MDX docs, the showcase
route, and tests in the same PR.

### Marketing components

`app/components/*.tsx` (hero-section, faq, etc.) follow the same token
contract as `components/ui/*` but are not part of the showcase. They're
product-specific page sections, not reusable primitives. If a marketing
section grows reusable patterns, consider promoting them to
`components/ui/*` and a cluster.
