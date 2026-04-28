// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { BoldIcon } from "lucide-react";

import { Toggle } from "@/components/ui/toggle";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Toggle a11y", () => {
  it("default toggle (off, with text) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Toggle aria-label="Bold">B</Toggle>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("toggle in 'on' state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Toggle aria-label="Bold" defaultPressed>
          B
        </Toggle>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("outline-variant toggle has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Toggle aria-label="Bold" variant="outline">
          B
        </Toggle>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("each size has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Toggle aria-label="Small" size="sm">
          A
        </Toggle>
        <Toggle aria-label="Default">B</Toggle>
        <Toggle aria-label="Large" size="lg">
          C
        </Toggle>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled toggle has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Toggle aria-label="Bold" disabled>
          B
        </Toggle>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("icon-only toggle relies on aria-label and has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Toggle aria-label="Bold">
          <BoldIcon />
        </Toggle>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
