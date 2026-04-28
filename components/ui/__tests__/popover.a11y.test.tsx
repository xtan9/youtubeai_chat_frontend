// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { axe, axeOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Popover a11y", () => {
  it("closed popover has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>body</PopoverContent>
      </Popover>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // Radix's PopoverContent renders with role="dialog"; axe requires an
  // accessible name for any dialog-role element. The consumer is
  // responsible for supplying it via aria-label or aria-labelledby — these
  // tests pin that contract.
  it("open popover with aria-label has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Popover defaultOpen>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent aria-label="Filter videos by date">
          <div className="grid gap-3">
            <label htmlFor="from">From</label>
            <input id="from" type="date" />
            <label htmlFor="to">To</label>
            <input id="to" type="date" />
          </div>
        </PopoverContent>
      </Popover>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("open popover with aria-labelledby (heading inside content) has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Popover defaultOpen>
        <PopoverTrigger>Help</PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          aria-labelledby="popover-heading"
        >
          <h3 id="popover-heading" className="text-sm font-semibold">
            Hints
          </h3>
          <p>Click here for hints.</p>
        </PopoverContent>
      </Popover>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });
});
