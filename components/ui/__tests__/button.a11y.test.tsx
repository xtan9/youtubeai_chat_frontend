// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Button } from "@/components/ui/button";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Button a11y", () => {
  it("default render has no axe violations", async () => {
    const { container } = renderWithProviders(<Button>Submit</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it.each([
    "default",
    "destructive",
    "outline",
    "secondary",
    "ghost",
    "link",
  ] as const)("variant=%s has no axe violations", async (variant) => {
    const { container } = renderWithProviders(
      <Button variant={variant}>Action</Button>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled state has no axe violations", async () => {
    const { container } = renderWithProviders(<Button disabled>Off</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-invalid state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Button aria-invalid>Bad input</Button>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("icon-only button needs aria-label to pass axe", async () => {
    // Icon-only buttons without an accessible name DO violate a11y rules.
    // This test pins that contract: consumers must pass an aria-label.
    const { container } = renderWithProviders(
      <Button size="icon" aria-label="Close dialog">
        <svg width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
        </svg>
      </Button>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
