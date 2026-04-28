// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Label a11y", () => {
  it("Label paired with Input via htmlFor/id has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Label paired with Checkbox has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox id="terms" />
        <Label htmlFor="terms">I agree to the terms</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Label wrapping its control (implicit association) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Label>
        Newsletter
        <Input type="email" />
      </Label>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled control with associated Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="readonly">Read-only</Label>
        <Input id="readonly" disabled defaultValue="locked" />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Label-only (orphan) is valid markup but consumers should pair it", async () => {
    // Per HTML spec, a <label> without `for` or a wrapped control is permitted —
    // axe doesn't flag it on its own. This pins that today's behavior; if a
    // future axe version flags it, surface as an a11y bug to fix.
    const { container } = renderWithProviders(<Label>Floating label</Label>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
