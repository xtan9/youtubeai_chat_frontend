// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("ScrollArea", () => {
  describe("default render", () => {
    it("renders the root and viewport, with the consumer's children inside the viewport", () => {
      // Radix mounts the scrollbar lazily — only when the viewport's
      // measured content actually overflows. happy-dom doesn't run real
      // layout, so the scrollbar element is absent in tests; we cover
      // the explicit-scrollbar path with a separate test below using
      // <ScrollBar /> directly.
      renderWithProviders(
        <ScrollArea data-testid="root" className="h-32 w-32">
          <div data-testid="content">child</div>
        </ScrollArea>,
      );
      const root = screen.getByTestId("root");
      expect(root.getAttribute("data-slot")).toBe("scroll-area");
      const viewport = root.querySelector(
        '[data-slot="scroll-area-viewport"]',
      );
      expect(viewport).toBeTruthy();
      expect(screen.getByTestId("content")).toBeTruthy();
    });
  });

  describe("ScrollBar (explicit)", () => {
    it("renders a ScrollBar with data-orientation=horizontal when orientation='horizontal' and type='always'", () => {
      // Mount a ScrollBar directly with `type='always'` so Presence
      // mounts it regardless of measured overflow (Radix gates on real
      // layout otherwise, which happy-dom can't provide).
      renderWithProviders(
        <ScrollArea type="always" data-testid="root">
          <p>x</p>
          <ScrollBar orientation="horizontal" data-testid="hbar" />
        </ScrollArea>,
      );
      const hbar = screen.getByTestId("hbar");
      expect(hbar.getAttribute("data-slot")).toBe("scroll-area-scrollbar");
      expect(hbar.getAttribute("data-orientation")).toBe("horizontal");
    });

    it("ScrollBar defaults to orientation='vertical' when no prop is supplied", () => {
      renderWithProviders(
        <ScrollArea type="always" data-testid="root">
          <p>x</p>
          <ScrollBar data-testid="vbar" />
        </ScrollArea>,
      );
      expect(screen.getByTestId("vbar").getAttribute("data-orientation")).toBe(
        "vertical",
      );
    });
  });

  describe("native prop forwarding", () => {
    it("merges className onto the root", () => {
      renderWithProviders(
        <ScrollArea
          className="my-scroll h-40 w-40"
          data-testid="root"
        >
          <p>x</p>
        </ScrollArea>,
      );
      const root = screen.getByTestId("root");
      expect(root.className).toContain("my-scroll");
      expect(root.className).toContain("h-40");
    });
  });
});
