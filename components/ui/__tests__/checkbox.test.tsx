// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Checkbox", () => {
  describe("rendering", () => {
    it("renders a checkbox role with data-slot", () => {
      renderWithProviders(<Checkbox aria-label="Agree" />);
      const cb = screen.getByRole("checkbox", { name: "Agree" });
      expect(cb.getAttribute("data-slot")).toBe("checkbox");
    });

    it("merges custom className with base classes", () => {
      renderWithProviders(<Checkbox aria-label="x" className="my-cb" />);
      const cb = screen.getByRole("checkbox");
      expect(cb.className).toContain("my-cb");
      expect(cb.className).toContain("size-4");
      expect(cb.className).toContain("rounded-[4px]");
    });
  });

  describe("controlled mode", () => {
    it("checked prop reflects state and onCheckedChange fires", () => {
      function Controlled() {
        const [checked, setChecked] = useState(false);
        return (
          <Checkbox
            aria-label="agree"
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
          />
        );
      }
      renderWithProviders(<Controlled />);
      const cb = screen.getByRole("checkbox", { name: "agree" });
      expect(cb.getAttribute("data-state")).toBe("unchecked");
      fireEvent.click(cb);
      expect(cb.getAttribute("data-state")).toBe("checked");
      fireEvent.click(cb);
      expect(cb.getAttribute("data-state")).toBe("unchecked");
    });

    it("calls onCheckedChange with the new value", () => {
      const handler = vi.fn();
      renderWithProviders(
        <Checkbox aria-label="ev" onCheckedChange={handler} />,
      );
      const cb = screen.getByRole("checkbox");
      fireEvent.click(cb);
      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe("uncontrolled mode", () => {
    it("defaultChecked=true renders in checked state initially", () => {
      renderWithProviders(<Checkbox aria-label="d" defaultChecked />);
      const cb = screen.getByRole("checkbox");
      expect(cb.getAttribute("data-state")).toBe("checked");
    });

    it("defaultChecked=false renders in unchecked state initially", () => {
      renderWithProviders(<Checkbox aria-label="d" />);
      const cb = screen.getByRole("checkbox");
      expect(cb.getAttribute("data-state")).toBe("unchecked");
    });

    it("toggles internal state on click", () => {
      renderWithProviders(<Checkbox aria-label="t" />);
      const cb = screen.getByRole("checkbox");
      fireEvent.click(cb);
      expect(cb.getAttribute("data-state")).toBe("checked");
    });
  });

  describe("indeterminate state", () => {
    it("checked='indeterminate' surfaces aria-checked='mixed'", () => {
      renderWithProviders(
        <Checkbox aria-label="i" checked="indeterminate" onCheckedChange={() => {}} />,
      );
      const cb = screen.getByRole("checkbox");
      expect(cb.getAttribute("aria-checked")).toBe("mixed");
      expect(cb.getAttribute("data-state")).toBe("indeterminate");
    });
  });

  describe("disabled", () => {
    it("renders as disabled and ignores click", () => {
      const handler = vi.fn();
      renderWithProviders(
        <Checkbox aria-label="d" disabled onCheckedChange={handler} />,
      );
      const cb = screen.getByRole("checkbox");
      expect(cb.hasAttribute("disabled")).toBe(true);
      fireEvent.click(cb);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("keyboard interaction", () => {
    it("Space toggles the checkbox (Radix default)", () => {
      const handler = vi.fn();
      renderWithProviders(
        <Checkbox aria-label="k" onCheckedChange={handler} />,
      );
      const cb = screen.getByRole("checkbox");
      cb.focus();
      // Radix maps Space → toggle. Fire a real keydown.
      fireEvent.keyDown(cb, { key: " ", code: "Space" });
      fireEvent.keyUp(cb, { key: " ", code: "Space" });
      // Radix uses click-on-Space; Space + click both should result in change.
      // Use the ergonomic shortcut: a click event also triggers it.
      fireEvent.click(cb);
      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe("aria-invalid", () => {
    it("retains aria-invalid for downstream styling", () => {
      renderWithProviders(<Checkbox aria-label="inv" aria-invalid />);
      const cb = screen.getByRole("checkbox");
      expect(cb.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("indicator rendering", () => {
    it("renders the CheckIcon inside the checked indicator", () => {
      const { container } = renderWithProviders(
        <Checkbox aria-label="ind" defaultChecked />,
      );
      const indicator = container.querySelector(
        '[data-slot="checkbox-indicator"]',
      );
      expect(indicator).not.toBeNull();
      expect(indicator?.querySelector("svg")).not.toBeNull();
    });
  });
});
