// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { GoogleIcon } from "@/components/ui/google-icon";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("GoogleIcon a11y", () => {
  it("icon next to a visible button label (decorative pattern) has no axe violations", async () => {
    // This is the canonical usage in app/auth/login + sign-up: SVG paired
    // with visible button text. The SVG carries no a11y semantics; the
    // button name comes from the text node.
    const { container } = renderWithProviders(
      <main>
        <button type="button">
          <GoogleIcon className="mr-2" />
          Continue with Google
        </button>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("icon-only button with aria-label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <button type="button" aria-label="Sign in with Google">
          <GoogleIcon />
        </button>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
