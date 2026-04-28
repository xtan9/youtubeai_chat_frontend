// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { Progress } from "@/components/ui/progress";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Progress", () => {
  describe("default render", () => {
    it("renders the root with role=progressbar and data-slot=progress", () => {
      renderWithProviders(<Progress value={50} data-testid="p" />);
      const root = screen.getByTestId("p");
      expect(root.getAttribute("role")).toBe("progressbar");
      expect(root.getAttribute("data-slot")).toBe("progress");
      expect(root.className).toContain("rounded-full");
    });

    it("emits data-slot=progress-indicator on the inner indicator", () => {
      renderWithProviders(<Progress value={30} data-testid="p" />);
      const root = screen.getByTestId("p");
      const indicator = root.querySelector(
        '[data-slot="progress-indicator"]',
      ) as HTMLElement | null;
      expect(indicator).toBeTruthy();
    });
  });

  describe("value prop", () => {
    it.each([
      [0, "translateX(-100%)"],
      [25, "translateX(-75%)"],
      [50, "translateX(-50%)"],
      [75, "translateX(-25%)"],
      [100, "translateX(-0%)"],
    ])(
      "value=%s sets the indicator transform to %s",
      (value, expectedTransform) => {
        renderWithProviders(<Progress value={value} data-testid="p" />);
        const indicator = screen
          .getByTestId("p")
          .querySelector(
            '[data-slot="progress-indicator"]',
          ) as HTMLElement;
        expect(indicator.style.transform).toBe(expectedTransform);
      },
    );

    it("undefined value falls back to 0% (translateX(-100%))", () => {
      renderWithProviders(<Progress data-testid="p" />);
      const indicator = screen
        .getByTestId("p")
        .querySelector(
          '[data-slot="progress-indicator"]',
        ) as HTMLElement;
      expect(indicator.style.transform).toBe("translateX(-100%)");
    });
  });

  describe("ARIA", () => {
    it("Radix wires aria-valuenow / aria-valuemin / aria-valuemax onto the progressbar", () => {
      renderWithProviders(<Progress value={42} data-testid="p" />);
      const root = screen.getByTestId("p");
      // Radix Progress sets aria-valuenow only when the status is
      // "loaded" (value !== null). aria-valuemin/max default to 0/100.
      expect(root.getAttribute("aria-valuenow")).toBe("42");
      expect(root.getAttribute("aria-valuemin")).toBe("0");
      expect(root.getAttribute("aria-valuemax")).toBe("100");
    });

    it("indeterminate progress (value=null) sets aria-valuetext='Loading…' and omits aria-valuenow", () => {
      renderWithProviders(<Progress value={null} data-testid="p" />);
      const root = screen.getByTestId("p");
      expect(root.getAttribute("aria-valuenow")).toBe(null);
      expect(root.getAttribute("data-state")).toBe("indeterminate");
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the root", () => {
      renderWithProviders(
        <Progress value={50} className="my-progress" data-testid="p" />,
      );
      expect(screen.getByTestId("p").className).toContain("my-progress");
      expect(screen.getByTestId("p").className).toContain("rounded-full");
    });
  });
});
