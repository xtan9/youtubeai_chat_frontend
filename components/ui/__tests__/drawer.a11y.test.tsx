// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { axe, axeOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Drawer a11y", () => {
  it("closed drawer (only trigger rendered) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Drawer>
        <DrawerTrigger>Open filters</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open bottom drawer with title + description has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Drawer defaultOpen>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter videos</DrawerTitle>
            <DrawerDescription>
              Refine the list by date, channel, or length.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DrawerClose>Cancel</DrawerClose>
            <button type="button">Apply</button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it.each(["top", "bottom", "left", "right"] as const)(
    "open drawer with direction=%s has no axe violations",
    async (direction) => {
      const { baseElement } = renderWithProviders(
        <Drawer defaultOpen direction={direction}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Side: {direction}</DrawerTitle>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>,
      );
      const results = await axeOverlay(baseElement);
      expect(results).toHaveNoViolations();
    },
  );
});
