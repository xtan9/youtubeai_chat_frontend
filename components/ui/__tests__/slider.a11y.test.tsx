// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Slider } from "@/components/ui/slider";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Radix renders each thumb as the `role="slider"` element. Pass
// `thumbAriaLabel` (single thumb) or `thumbAriaLabels` (per-thumb,
// for range sliders) to give every thumb an accessible name.
describe("Slider a11y", () => {
  it("default single-thumb slider with thumbAriaLabel has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Slider thumbAriaLabel="Volume" defaultValue={[40]} />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("range slider (two thumbs) with per-thumb labels has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Slider
          thumbAriaLabels={["Minimum price", "Maximum price"]}
          defaultValue={[20, 80]}
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("vertical slider has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Slider
          thumbAriaLabel="Brightness"
          orientation="vertical"
          defaultValue={[60]}
          className="h-32"
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled slider has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Slider
          thumbAriaLabel="Volume (locked)"
          defaultValue={[40]}
          disabled
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
