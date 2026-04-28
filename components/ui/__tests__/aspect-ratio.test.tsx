// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("AspectRatio", () => {
  describe("rendering", () => {
    it("renders a wrapper div with data-slot=aspect-ratio", () => {
      renderWithProviders(
        <AspectRatio data-testid="ar">
          <span>child</span>
        </AspectRatio>,
      );
      const root = screen.getByTestId("ar");
      expect(root.tagName).toBe("DIV");
      expect(root.getAttribute("data-slot")).toBe("aspect-ratio");
    });

    it("renders the child inside", () => {
      renderWithProviders(
        <AspectRatio>
          <span>child-content</span>
        </AspectRatio>,
      );
      expect(screen.getByText("child-content")).toBeTruthy();
    });
  });

  describe("ratio prop", () => {
    // Radix's AspectRatio computes the ratio via CSS padding-bottom on a
    // wrapper element, applied via inline style. The value is
    // `(1 / ratio) * 100%` — so for 16/9, padding-bottom ≈ 56.25%.
    it.each([
      [16 / 9, "56.25%"],
      [4 / 3, "75%"],
      [1, "100%"],
      [21 / 9, "42.857142857142854%"],
      [9 / 16, "177.77777777777777%"],
    ])("ratio=%s sets padding-bottom to %s on the inner ratio box", (ratio, expected) => {
      const { baseElement } = renderWithProviders(
        <AspectRatio ratio={ratio} data-testid="ar">
          <span>child</span>
        </AspectRatio>,
      );
      // The inner element holding the padding-bottom is a sibling/parent
      // of the data-slot wrapper depending on the Radix version. Find any
      // descendant that has the padding-bottom inline style and verify
      // the computed value.
      const candidates = baseElement.querySelectorAll<HTMLElement>("*");
      const match = Array.from(candidates).find(
        (el) => el.style?.paddingBottom === expected,
      );
      expect(match).toBeTruthy();
    });

    it("defaults to ratio=1 (square) when not specified", () => {
      const { baseElement } = renderWithProviders(
        <AspectRatio data-testid="ar">
          <span>child</span>
        </AspectRatio>,
      );
      const candidates = baseElement.querySelectorAll<HTMLElement>("*");
      const match = Array.from(candidates).find(
        (el) => el.style?.paddingBottom === "100%",
      );
      expect(match).toBeTruthy();
    });
  });

  describe("native prop forwarding", () => {
    it("forwards className onto the data-slot wrapper", () => {
      renderWithProviders(
        <AspectRatio className="my-ratio" data-testid="ar">
          <span>child</span>
        </AspectRatio>,
      );
      const root = screen.getByTestId("ar");
      expect(root.className).toContain("my-ratio");
    });

    it("forwards arbitrary native attributes (id, role, aria-label)", () => {
      renderWithProviders(
        <AspectRatio id="ar1" role="img" aria-label="thumbnail">
          <span>child</span>
        </AspectRatio>,
      );
      const root = document.getElementById("ar1");
      expect(root).toBeTruthy();
      expect(root?.getAttribute("role")).toBe("img");
      expect(root?.getAttribute("aria-label")).toBe("thumbnail");
    });
  });

  describe("composition", () => {
    it("does not interfere with child focusability (interactive children remain in tab order)", () => {
      renderWithProviders(
        <AspectRatio ratio={16 / 9}>
          <button type="button">tab-target</button>
        </AspectRatio>,
      );
      const btn = screen.getByRole("button", { name: "tab-target" });
      btn.focus();
      expect(document.activeElement).toBe(btn);
    });
  });
});
