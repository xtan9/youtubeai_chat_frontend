// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Toaster a11y", () => {
  it("Toaster mounted in a page landmark has no axe violations", async () => {
    // Empty toaster (no active toasts) is a single sectioning region.
    // sonner already labels its own container (`aria-label='Notifications'`).
    const { container } = renderWithProviders(
      <main>
        <p>Page body</p>
        <Toaster />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Toaster with explicit position + theme has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <p>Page body</p>
        <Toaster position="bottom-right" theme="light" richColors />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
