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

export { toHaveNoViolations };
