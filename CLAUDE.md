# youtubeai_chat_frontend — Claude guidance

Frontend-specific guidance for Claude (and other AI agents) working in this
package. Inherits everything from the higher-level
[`youtubeai_chat/CLAUDE.md`](../CLAUDE.md) and adds the design-system
contract.

## Design system contract

The `youtubeai_chat_frontend` package has a governed design system. All
visual decisions go through it.

**When you write or modify UI code:**

1. **Reach for `components/ui/*` first.** 47 governed primitives covering
   buttons, forms, containers, navigation, data display, and composites.
   Don't introduce a new primitive when an existing one fits.
2. **Use semantic tokens, never raw palette colors.** The token vocabulary
   lives in `app/globals.css` (`@theme` block) and is documented in
   `docs/design-system/tokens/`: [`color.mdx`](docs/design-system/tokens/color.mdx)
   for surfaces/text/borders/accents/states, plus `gradient.mdx`,
   `typography.mdx`, `motion.mdx`, `spacing.mdx`, `radius.mdx`,
   `shadow.mdx`, `blur.mdx` for the other categories. Quick reference:
   - Surfaces: `bg-surface-base`, `bg-surface-raised`, `bg-surface-overlay`,
     `bg-surface-sunken`, `bg-surface-inverse`
   - Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`,
     `text-text-disabled`, `text-text-inverse`
   - Borders: `border-border-subtle`, `border-border-default`,
     `border-border-strong`
   - Accents: `bg-accent-brand`, `bg-accent-brand-secondary`,
     `bg-accent-success`, `bg-accent-warning`, `bg-accent-danger`
   - States: `bg-state-hover`, `bg-state-pressed`, `bg-state-focus`,
     `bg-state-disabled`
   - Typography: `text-display`, `text-h1`–`text-h6`, `text-body-{lg,md,sm,xs}`,
     `text-caption`
   - Motion: `duration-{instant,fast,base,slow,slower}`
   - Gradients: `bg-gradient-brand-{primary,primary-hover,accent,soft}`,
     `bg-gradient-{error,success}`, `bg-gradient-stage-{preparing,
     transcribing,summarizing,complete}`
3. **Never use raw palette classes** like `bg-purple-500`, `text-red-400`,
   `border-cyan-300`. ESLint blocks them. If you genuinely need a
   third-party brand color (e.g. a logo recreation), add an inline
   `// eslint-disable-next-line no-restricted-syntax` with a
   `// TODO(design-followup):` comment naming the missing token.
4. **Never use legacy shadcn token classes** like `bg-card`, `bg-popover`,
   `text-foreground`, `text-muted-foreground`, `border-input`. They were
   swept out in milestone C and the supporting CSS variables are gone.

## Visual reference

- **Browse the system:** run `pnpm dev`, visit `/design-system` for the
  landing page + `/design-system/tokens` for the token catalog +
  `/design-system/{forms,containers,navigation,data-display,composites}`
  for cluster pages.
- **Read the docs:** `docs/design-system/` contains MDX docs for every
  token category and component cluster.

## Adding new components or tokens

See `docs/design-system/README.md` for the contribution guide:
where new components go, prop API conventions, MDX doc requirements,
testing requirements (behavior + a11y), and how to extend the token
vocabulary.

## Testing UI changes

Per the higher-level CLAUDE.md, every UI change must run a Playwright
e2e test before being reported done. The `/design-system` showcase
route is the cheapest place to capture screenshots if you're verifying
that a token sweep or component change preserved visuals.
