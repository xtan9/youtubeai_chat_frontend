// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { axe, axePortal } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Tooltip a11y", () => {
  it("trigger only (closed tooltip) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="Refresh">
            R
          </button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // Tooltip content is portaled into document.body, so axe's
  // `region` rule (all content must live inside a landmark) trips
  // unless the trigger is also inside a landmark. Wrap each open-tooltip
  // case in <main> to model the realistic page layout.
  it("open tooltip with text content has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <main>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Refresh">
              R
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh the list</TooltipContent>
        </Tooltip>
      </main>,
    );
    const results = await axePortal(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("tooltip wrapping a button with visible label has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <main>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Save</button>
          </TooltipTrigger>
          <TooltipContent>
            Save <kbd>⌘S</kbd>
          </TooltipContent>
        </Tooltip>
      </main>,
    );
    const results = await axePortal(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("multiple tooltips inside a shared provider have no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <main>
        <TooltipProvider delayDuration={300}>
          <div className="flex gap-1">
            <Tooltip defaultOpen>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Bold">
                  B
                </button>
              </TooltipTrigger>
              <TooltipContent>Bold</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Italic">
                  I
                </button>
              </TooltipTrigger>
              <TooltipContent>Italic</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </main>,
    );
    const results = await axePortal(baseElement);
    expect(results).toHaveNoViolations();
  });
});
