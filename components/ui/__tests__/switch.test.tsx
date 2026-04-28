// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Switch", () => {
  describe("rendering", () => {
    it("renders a switch role with data-slot", () => {
      renderWithProviders(<Switch aria-label="Notifications" />);
      const sw = screen.getByRole("switch", { name: "Notifications" });
      expect(sw.getAttribute("data-slot")).toBe("switch");
    });

    it("renders the thumb sub-element", () => {
      const { container } = renderWithProviders(<Switch aria-label="t" />);
      const thumb = container.querySelector('[data-slot="switch-thumb"]');
      expect(thumb).not.toBeNull();
    });

    it("merges custom className with base classes", () => {
      renderWithProviders(<Switch aria-label="x" className="my-sw" />);
      const sw = screen.getByRole("switch");
      expect(sw.className).toContain("my-sw");
      expect(sw.className).toContain("rounded-full");
    });
  });

  describe("controlled mode", () => {
    it("checked prop reflects state and onCheckedChange fires", () => {
      function Controlled() {
        const [v, setV] = useState(false);
        return (
          <Switch
            aria-label="c"
            checked={v}
            onCheckedChange={setV}
          />
        );
      }
      renderWithProviders(<Controlled />);
      const sw = screen.getByRole("switch");
      expect(sw.getAttribute("data-state")).toBe("unchecked");
      fireEvent.click(sw);
      expect(sw.getAttribute("data-state")).toBe("checked");
      fireEvent.click(sw);
      expect(sw.getAttribute("data-state")).toBe("unchecked");
    });

    it("calls onCheckedChange with new boolean", () => {
      const handler = vi.fn();
      renderWithProviders(<Switch aria-label="h" onCheckedChange={handler} />);
      fireEvent.click(screen.getByRole("switch"));
      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe("uncontrolled mode", () => {
    it("defaultChecked=true renders checked", () => {
      renderWithProviders(<Switch aria-label="d" defaultChecked />);
      expect(screen.getByRole("switch").getAttribute("data-state")).toBe(
        "checked",
      );
    });

    it("defaultChecked unset renders unchecked", () => {
      renderWithProviders(<Switch aria-label="d" />);
      expect(screen.getByRole("switch").getAttribute("data-state")).toBe(
        "unchecked",
      );
    });

    it("toggles internal state on click", () => {
      renderWithProviders(<Switch aria-label="t" />);
      const sw = screen.getByRole("switch");
      fireEvent.click(sw);
      expect(sw.getAttribute("data-state")).toBe("checked");
    });
  });

  describe("disabled", () => {
    it("renders as disabled and ignores click", () => {
      const handler = vi.fn();
      renderWithProviders(
        <Switch aria-label="d" disabled onCheckedChange={handler} />,
      );
      const sw = screen.getByRole("switch");
      expect(sw.hasAttribute("disabled")).toBe(true);
      fireEvent.click(sw);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("aria-checked", () => {
    it("aria-checked reflects boolean state for assistive tech", () => {
      renderWithProviders(<Switch aria-label="a" defaultChecked />);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
        "true",
      );
    });
  });

  describe("name + value (form submission)", () => {
    it("forwards name and value to Radix's hidden submission input", () => {
      const { container } = renderWithProviders(
        <form>
          <Switch aria-label="n" name="notifications" value="on" />
        </form>,
      );
      // Radix renders a hidden BubbleInput inside a form so the value flows
      // through the standard form submission path.
      const hiddenInput = container.querySelector(
        'input[type="checkbox"][name="notifications"]',
      );
      expect(hiddenInput).not.toBeNull();
    });
  });
});
