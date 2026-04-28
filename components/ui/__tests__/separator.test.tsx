// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { Separator } from "@/components/ui/separator";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Separator", () => {
  describe("default render", () => {
    it("renders with data-slot=separator and decorative=true (no role)", () => {
      // Decorative separators are aria-hidden + role="none" in Radix; they
      // don't show up as `role=separator` in the AT tree. That's the
      // correct behaviour for a purely visual divider.
      renderWithProviders(<Separator data-testid="s" />);
      const sep = screen.getByTestId("s");
      expect(sep.getAttribute("data-slot")).toBe("separator");
      expect(sep.getAttribute("data-orientation")).toBe("horizontal");
      // decorative defaults to true → role=none
      expect(sep.getAttribute("role")).toBe("none");
    });
  });

  describe("orientation prop", () => {
    it("orientation='vertical' sets data-orientation=vertical", () => {
      renderWithProviders(
        <Separator orientation="vertical" data-testid="s" />,
      );
      expect(screen.getByTestId("s").getAttribute("data-orientation")).toBe(
        "vertical",
      );
    });
  });

  describe("decorative=false", () => {
    it("makes the separator semantic (role=separator)", () => {
      // Radix omits aria-orientation when orientation is horizontal (the
      // ARIA spec default for separator), and emits it explicitly only
      // when vertical. Both tests below confirm that contract.
      renderWithProviders(<Separator decorative={false} data-testid="s" />);
      const sep = screen.getByTestId("s");
      expect(sep.getAttribute("role")).toBe("separator");
      expect(sep.getAttribute("aria-orientation")).toBe(null);
      expect(sep.getAttribute("data-orientation")).toBe("horizontal");
    });

    it("vertical semantic separator carries aria-orientation=vertical", () => {
      renderWithProviders(
        <Separator
          decorative={false}
          orientation="vertical"
          data-testid="s"
        />,
      );
      const sep = screen.getByTestId("s");
      expect(sep.getAttribute("role")).toBe("separator");
      expect(sep.getAttribute("aria-orientation")).toBe("vertical");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto base classes", () => {
      renderWithProviders(<Separator className="my-sep" data-testid="s" />);
      const sep = screen.getByTestId("s");
      expect(sep.className).toContain("my-sep");
      expect(sep.className).toContain("bg-border");
    });
  });
});
