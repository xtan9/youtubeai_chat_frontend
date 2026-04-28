# Design System

Source of truth for every design decision in `youtubeai_chat_frontend`.
Tokens, components, and patterns live here so that humans and Claude (the
agent) read the same contract.

## Structure

- [`tokens/`](./tokens/) — design token vocabulary (typography, spacing,
  shadow, radius, blur, motion, gradient).
- `components/` _(planned, PRs 2-6)_ — per-component documentation
  (overview, props, variants, accessibility, composition examples,
  token usage).
- `patterns/` _(planned, future cycle)_ — composition patterns and
  accessibility patterns that span multiple components.

## Audience

- **Humans:** read the MDX/Markdown directly, or render via a future
  Next.js MDX route (out of scope for B).
- **Claude (the agent):** reads MDX as source. Token names and component
  prop APIs are the contract — Claude should never need to invent values
  or guess at the canonical pattern.

## Status

| Area | PR | Status |
|------|----|--------|
| Tokens (typography, spacing, radius, shadow, gradient, blur, motion) | B PR 1 | Defined in `app/globals.css` `@theme` directive + `@utility` rules |
| `app/components/input-form.tsx` retrofit | B PR 1 | Uses only token-backed classes |
| Forms cluster (button, input, label, form, checkbox, radio-group, switch, textarea) | B PR 2 | Planned |
| Containers cluster (card, dialog, popover, drawer, sheet, alert-dialog, tooltip, hover-card, aspect-ratio) | B PR 3 | Planned |
| Navigation cluster (navigation-menu, menubar, tabs, breadcrumb, pagination, command, dropdown-menu) | B PR 4 | Planned |
| Data display cluster (table, badge, avatar, alert, progress, skeleton, separator, scroll-area, sonner, chart, google-icon) | B PR 5 | Planned |
| Composites cluster (sidebar, calendar, accordion, collapsible, carousel, slider, toggle, toggle-group, context-menu, input-otp, resizable, select) | B PR 6 | Planned |

47 components total — see the
[B spec](../superpowers/specs/2026-04-27-design-system-rebuild-b-design.md)
for the full pipeline.

## Tailwind 4 conventions used here

The token vocabulary is built on Tailwind 4's
[`@theme` directive](https://tailwindcss.com/docs/theme). When you define
`--text-h1: 3rem;` in `@theme`, Tailwind generates a `.text-h1` utility.
Most categories follow that 1:1 mapping:

| Category | Convention | Example |
|----------|-----------|---------|
| Colors | `--color-*` | `--color-purple-500` → `.bg-purple-500`, `.text-purple-500` |
| Font sizes | `--text-*` (with paired `--text-*--line-height`, `--text-*--letter-spacing`, `--text-*--font-weight`) | `--text-h1` → `.text-h1` |
| Tracking | `--tracking-*` | `--tracking-tight` → `.tracking-tight` |
| Leading | `--leading-*` | `--leading-tight` → `.leading-tight` |
| Spacing/sizing | `--spacing` (single base unit) | `--spacing: 0.25rem` → `.p-4` (4 × 0.25rem) |
| Radius | `--radius-*` | `--radius-lg` → `.rounded-lg` |
| Shadow | `--shadow-*` | `--shadow-md` → `.shadow-md` |
| Blur | `--blur-*` | `--blur-md` → `.blur-md` |
| Easings | `--ease-*` | `--ease-out-soft` → `.ease-out-soft` |
| Durations | `--duration-*` | `--duration-base` → `.duration-base` |

**Gradients are different.** Tailwind 4 has no native `--gradient-*`
namespace; `@theme` won't auto-generate `.bg-gradient-*` utilities from
`--gradient-*` declarations. We use the
[`@utility` directive](https://tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities)
to register the gradient utility classes ourselves. See
[`tokens/gradient.mdx`](./tokens/gradient.mdx).

**Class-based dark mode** is configured via `@custom-variant dark
(&:where(.dark, .dark *));` in `app/globals.css`. Tailwind 4 no longer
reads `darkMode: "class"` from `tailwind.config.ts`, so the
`@custom-variant` directive is the bridge that lets `dark:*` utilities
respond to the `.dark` class that `next-themes` toggles on `<html>`.

## Vitest coverage scope (rollout note)

Per the [B plan](../superpowers/plans/2026-04-27-design-system-rebuild-b.md)
Task 1 §8, `components/ui/**` is **excluded** from `vitest.config.ts`
coverage in B PR 1 because no component tests exist yet. Each cluster PR
(2-6) will:

1. Add behavior + axe a11y tests for its cluster's components.
2. Remove that cluster's components from the coverage exclusion (or, in
   PR 2, remove the blanket exclusion once the testing infrastructure
   is in place).

The 50/40/50/50 floor is unchanged. By PR 6, expect coverage on
`components/ui/**` in the 70-90% range.

## Out of scope (B)

- **Brand identity decisions** — colors, typography family. Current
  visual identity (shadcn neutrals + purple/cyan/pink accent gradient)
  is preserved and *formalized* in tokens.
- **Storybook** — chose MDX (Claude reads files; MDX renders for humans).
- **Visual regression testing** — chose behavior + a11y only.
- **Component additions/removals beyond 47** — only governing what
  exists.
- **Marketing-component refactor** beyond `input-form.tsx`.

See the [B spec §9](../superpowers/specs/2026-04-27-design-system-rebuild-b-design.md)
for the full out-of-scope list.
