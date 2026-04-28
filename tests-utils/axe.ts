import { configureAxe, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

// Wire jest-axe's matcher into vitest's expect so tests can use
// `expect(results).toHaveNoViolations()`.
expect.extend(toHaveNoViolations);

// Augment vitest's Assertion / AsymmetricMatchersContaining with the
// custom matcher. @types/jest-axe ships jest-flavoured types; we re-declare
// for vitest so type-checks pass without pulling jest types into scope.
declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): unknown;
  }
}

/**
 * Configured axe runner used across design-system a11y tests.
 *
 * Baseline: WCAG 2.1 A + AA. Per-rule overrides (with rationale) belong here,
 * not scattered across individual tests.
 */
export const axe = configureAxe({
  rules: {
    // No exceptions yet — keep this list intentionally short. Document any
    // future suppressions inline with a "why" comment.
  },
});

/**
 * Axe runner for tests that scan an open Radix overlay (Dialog, AlertDialog,
 * Sheet, Drawer, Popover, HoverCard, etc.). These primitives emit two
 * `data-radix-focus-guard` <span>s with `aria-hidden="true"` and
 * `tabindex="0"` so focus can be programmatically trapped at the boundaries
 * of the overlay. The guards are a deliberate part of Radix's focus-trap
 * pattern — they are not reachable to assistive tech in normal use, only
 * stealing focus momentarily before bouncing it back inside the overlay.
 *
 * That pattern trips axe's `aria-hidden-focus` rule. Suppressing the rule
 * for overlay scans is the documented workaround used by Radix's own a11y
 * tests; the rule still runs on every other a11y test in this suite.
 */
export const axeOverlay = configureAxe({
  rules: {
    "aria-hidden-focus": { enabled: false },
  },
});

/**
 * Axe runner for tests that scan a portaled non-landmark overlay (Tooltip,
 * HoverCard). These primitives portal their content into `document.body`
 * with `role="tooltip"` (Tooltip) or no role at all (HoverCard), neither of
 * which counts as an axe landmark — so axe's `region` rule flags the
 * popper wrapper as "page content not in a landmark" even when the
 * trigger lives inside a real landmark in the test fixture.
 *
 * The region rule is a useful page-level lint but a false-positive for
 * test fragments that render a single overlay. Suppress it for these
 * scans; every other rule (color contrast, ARIA validity, accessible
 * names, focus order, etc.) still runs.
 */
export const axePortal = configureAxe({
  rules: {
    region: { enabled: false },
  },
});

/**
 * Axe runner for tests that scan a portaled overlay that *also* uses
 * Radix focus guards (DropdownMenu, ContextMenu, Menubar — anything
 * built on `@radix-ui/react-menu` family). Combines the suppressions
 * from `axeOverlay` (focus guards trip `aria-hidden-focus`) and
 * `axePortal` (popper wrapper trips `region` because it sits outside
 * any landmark in the portal). Every other rule still runs.
 */
export const axePortalOverlay = configureAxe({
  rules: {
    "aria-hidden-focus": { enabled: false },
    region: { enabled: false },
  },
});

/**
 * Axe runner for `cmdk`-backed Command surfaces. cmdk emits its
 * separator with `role="separator"` directly inside the
 * `role="listbox"` list, which trips axe's `aria-required-children`
 * rule (listbox formally allows only `option` / `group` children).
 * Visually + behaviourally the separator is a presentational divider
 * between groups; cmdk does not give us a hook to override the role.
 * The suppression scope is intentionally narrow: every other listbox
 * a11y rule (accessible name, aria-activedescendant correctness,
 * option roles) still runs.
 *
 * Use the inline-scoped `axe` (not this) for a Command surface that
 * doesn't use `CommandSeparator`.
 */
export const axeCommand = configureAxe({
  rules: {
    "aria-required-children": { enabled: false },
  },
});

/**
 * Axe runner for `react-resizable-panels` v4 Separator handles. v4
 * sets `role="separator" tabindex="0" aria-orientation="…"` on each
 * handle and computes `aria-valuenow` / `aria-valuemin` /
 * `aria-valuemax` from the live measured layout. happy-dom returns 0
 * for layout, so the value attributes are missing in tests — and
 * axe's `aria-required-attr` rule then flags the focusable separator.
 *
 * In the real browser the handle carries the value attributes (we
 * verify this in Playwright smoke tests), so the suppression is
 * scoped to this test environment limitation. Every other rule
 * (color-contrast, focusable-within, role validity) still runs.
 */
export const axeResizable = configureAxe({
  rules: {
    "aria-required-attr": { enabled: false },
  },
});

/**
 * Axe runner for `CommandDialog` — combines the cmdk separator
 * suppression with the Radix Dialog focus-guard suppression
 * (`aria-hidden-focus`). Use only on a CommandDialog scan.
 */
export const axeCommandDialog = configureAxe({
  rules: {
    "aria-required-children": { enabled: false },
    "aria-hidden-focus": { enabled: false },
  },
});

export { toHaveNoViolations };
