// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Checkbox a11y", () => {
  it("paired with a Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox id="terms" />
        <Label htmlFor="terms">I agree to the terms</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("checked state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox id="c" defaultChecked />
        <Label htmlFor="c">Subscribe</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("indeterminate state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox
          id="i"
          checked="indeterminate"
          onCheckedChange={() => {}}
        />
        <Label htmlFor="i">Select all</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox id="d" disabled />
        <Label htmlFor="d">Locked</Label>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-invalid with describedby has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <Checkbox id="bad" aria-invalid aria-describedby="bad-err" />
        <Label htmlFor="bad">Required</Label>
        <p id="bad-err">You must agree to continue.</p>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-label without a visible Label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Checkbox aria-label="Toggle row selection" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
