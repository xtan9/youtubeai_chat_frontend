// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Separator } from "@/components/ui/separator";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Separator a11y", () => {
  it("decorative horizontal separator has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <p>Above</p>
        <Separator />
        <p>Below</p>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("decorative vertical separator has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <div className="flex h-5 items-center gap-2">
          <span>Left</span>
          <Separator orientation="vertical" />
          <span>Right</span>
        </div>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("semantic (decorative=false) separator has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <h2>Section A</h2>
        <Separator decorative={false} />
        <h2>Section B</h2>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
