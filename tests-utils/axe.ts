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

export { toHaveNoViolations };
