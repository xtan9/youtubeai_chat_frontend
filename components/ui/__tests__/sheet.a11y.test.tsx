// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { axe, axeOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Sheet a11y", () => {
  it("closed sheet (only trigger rendered) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Sheet>
        <SheetTrigger>Open settings</SheetTrigger>
        <SheetContent>
          <SheetTitle>Settings</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it.each(["right", "left", "top", "bottom"] as const)(
    "open sheet with side=%s has no axe violations",
    async (side) => {
      const { baseElement } = renderWithProviders(
        <Sheet defaultOpen>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>Side: {side}</SheetTitle>
              <SheetDescription>{side}-mounted panel</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose>Cancel</SheetClose>
              <button type="button">Save</button>
            </SheetFooter>
          </SheetContent>
        </Sheet>,
      );
      const results = await axeOverlay(baseElement);
      expect(results).toHaveNoViolations();
    },
  );

  it("sheet with sr-only title has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Sheet defaultOpen>
        <SheetContent side="left">
          <SheetTitle className="sr-only">Site navigation</SheetTitle>
          <nav>
            <ul>
              <li>
                <a href="/home">Home</a>
              </li>
              <li>
                <a href="/about">About</a>
              </li>
            </ul>
          </nav>
        </SheetContent>
      </Sheet>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });
});
