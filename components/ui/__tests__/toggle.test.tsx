// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { BoldIcon } from "lucide-react";

import { Toggle } from "@/components/ui/toggle";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Toggle", () => {
  describe("default render", () => {
    it("renders a button with role=button, data-slot=toggle, and the default classes", () => {
      renderWithProviders(<Toggle aria-label="Bold">B</Toggle>);
      const btn = screen.getByRole("button", { name: "Bold" });
      expect(btn.getAttribute("data-slot")).toBe("toggle");
      expect(btn.getAttribute("data-state")).toBe("off");
    });
  });

  describe("variants", () => {
    it("default variant has bg-transparent class", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" data-testid="t">
          B
        </Toggle>,
      );
      expect(screen.getByTestId("t").className).toContain("bg-transparent");
    });

    it("outline variant adds border + shadow-xs", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" variant="outline" data-testid="t">
          B
        </Toggle>,
      );
      expect(screen.getByTestId("t").className).toContain("border");
      expect(screen.getByTestId("t").className).toContain("shadow-xs");
    });
  });

  describe("sizes", () => {
    it("default size is h-9 with min-w-9", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" data-testid="t">
          B
        </Toggle>,
      );
      expect(screen.getByTestId("t").className).toContain("h-9");
      expect(screen.getByTestId("t").className).toContain("min-w-9");
    });

    it("small size is h-8 with min-w-8", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" size="sm" data-testid="t">
          B
        </Toggle>,
      );
      expect(screen.getByTestId("t").className).toContain("h-8");
      expect(screen.getByTestId("t").className).toContain("min-w-8");
    });

    it("large size is h-10 with min-w-10", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" size="lg" data-testid="t">
          B
        </Toggle>,
      );
      expect(screen.getByTestId("t").className).toContain("h-10");
      expect(screen.getByTestId("t").className).toContain("min-w-10");
    });
  });

  describe("uncontrolled mode (defaultPressed)", () => {
    it("starts off when defaultPressed is omitted", () => {
      renderWithProviders(<Toggle aria-label="Bold">B</Toggle>);
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("data-state")).toBe("off");
      expect(btn.getAttribute("aria-pressed")).toBe("false");
    });

    it("starts on when defaultPressed is true", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" defaultPressed>
          B
        </Toggle>,
      );
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("data-state")).toBe("on");
      expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    it("toggles state on click", () => {
      renderWithProviders(<Toggle aria-label="Bold">B</Toggle>);
      const btn = screen.getByRole("button");
      fireEvent.click(btn);
      expect(btn.getAttribute("data-state")).toBe("on");
      fireEvent.click(btn);
      expect(btn.getAttribute("data-state")).toBe("off");
    });
  });

  describe("controlled mode", () => {
    it("respects external pressed state and emits onPressedChange on click", () => {
      const onPressedChange = vi.fn();
      function Harness() {
        const [pressed, setPressed] = useState(false);
        return (
          <Toggle
            aria-label="Bold"
            pressed={pressed}
            onPressedChange={(p) => {
              setPressed(p);
              onPressedChange(p);
            }}
          >
            B
          </Toggle>
        );
      }
      renderWithProviders(<Harness />);
      fireEvent.click(screen.getByRole("button"));
      expect(onPressedChange).toHaveBeenCalledWith(true);
    });
  });

  describe("disabled state", () => {
    it("disabled toggle ignores click", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" disabled>
          B
        </Toggle>,
      );
      const btn = screen.getByRole("button");
      expect(btn.hasAttribute("disabled")).toBe(true);
      fireEvent.click(btn);
      expect(btn.getAttribute("data-state")).toBe("off");
    });
  });

  describe("with icon", () => {
    it("renders an icon child without bloating the button hit target", () => {
      renderWithProviders(
        <Toggle aria-label="Bold" data-testid="t">
          <BoldIcon data-testid="icon" />
        </Toggle>,
      );
      expect(screen.getByTestId("icon")).toBeTruthy();
      // svg gets size-4 by default via the [&_svg:not([class*='size-'])]:size-4 pattern
      expect(screen.getByTestId("t").className).toContain(
        "[&_svg:not([class*='size-'])]:size-4",
      );
    });
  });

  describe("native prop forwarding", () => {
    it("passes className and data-testid through", () => {
      renderWithProviders(
        <Toggle aria-label="x" className="my-toggle" data-testid="t">
          x
        </Toggle>,
      );
      expect(screen.getByTestId("t").className).toContain("my-toggle");
    });
  });
});
