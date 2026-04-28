// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

function ThreeOptions(props: React.ComponentProps<typeof RadioGroup>) {
  return (
    <RadioGroup {...props}>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="rga-1" value="one" />
        <Label htmlFor="rga-1">One</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="rga-2" value="two" />
        <Label htmlFor="rga-2">Two</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="rga-3" value="three" />
        <Label htmlFor="rga-3">Three</Label>
      </div>
    </RadioGroup>
  );
}

describe("RadioGroup a11y", () => {
  it("default group with labelled items has no axe violations", async () => {
    const { container } = renderWithProviders(<ThreeOptions />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("group with a fieldset/legend has no axe violations", async () => {
    const { container } = renderWithProviders(
      <fieldset>
        <legend>Pick a plan</legend>
        <ThreeOptions />
      </fieldset>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("preselected (defaultValue) state has no axe violations", async () => {
    const { container } = renderWithProviders(<ThreeOptions defaultValue="two" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled group has no axe violations", async () => {
    const { container } = renderWithProviders(<ThreeOptions disabled />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("group with aria-labelledby has no axe violations", async () => {
    const { container } = renderWithProviders(
      <div>
        <h3 id="plan-heading">Choose a plan</h3>
        <RadioGroup aria-labelledby="plan-heading">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="ra-1" value="free" />
            <Label htmlFor="ra-1">Free</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="ra-2" value="pro" />
            <Label htmlFor="ra-2">Pro</Label>
          </div>
        </RadioGroup>
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("aria-invalid item with describedby has no axe violations", async () => {
    const { container } = renderWithProviders(
      <fieldset>
        <legend>Required choice</legend>
        <RadioGroup>
          <div className="flex items-center gap-2">
            <RadioGroupItem
              id="bad-1"
              value="one"
              aria-invalid
              aria-describedby="rg-err"
            />
            <Label htmlFor="bad-1">One</Label>
          </div>
        </RadioGroup>
        <p id="rg-err">Pick at least one option.</p>
      </fieldset>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
