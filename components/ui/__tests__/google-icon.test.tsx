// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { GoogleIcon } from "@/components/ui/google-icon";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("GoogleIcon", () => {
  describe("default render", () => {
    it("renders an SVG with the four-color Google G mark", () => {
      const { container } = renderWithProviders(
        <span data-testid="wrap">
          <GoogleIcon />
        </span>,
      );
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("width")).toBe("20");
      expect(svg?.getAttribute("height")).toBe("20");
      expect(svg?.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
      // Four <path> children — one per Google brand color.
      expect(svg?.querySelectorAll("path").length).toBe(4);
      expect(screen.getByTestId("wrap")).toBeTruthy();
    });

    it("does NOT mark itself aria-hidden by default — consumer chooses", () => {
      // The icon is decorative when paired with a label, but the component
      // doesn't force the choice. Auth buttons currently pair it with
      // visible text, so role=img + aria-hidden are not auto-applied.
      const { container } = renderWithProviders(<GoogleIcon />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe(null);
      expect(svg?.getAttribute("role")).toBe(null);
    });
  });

  describe("className prop", () => {
    it("applies the given className to the SVG element", () => {
      const { container } = renderWithProviders(
        <GoogleIcon className="mr-2 size-5" />,
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toBe("mr-2 size-5");
    });

    it("renders without a className prop (className attribute absent or empty)", () => {
      const { container } = renderWithProviders(<GoogleIcon />);
      const svg = container.querySelector("svg");
      // happy-dom may emit class="" rather than omitting; either is fine.
      const cls = svg?.getAttribute("class");
      expect(cls === null || cls === "").toBe(true);
    });
  });
});
