// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

function ThreeOptions(props: React.ComponentProps<typeof RadioGroup>) {
  return (
    <RadioGroup {...props}>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-1" value="one" />
        <Label htmlFor="r-1">One</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-2" value="two" />
        <Label htmlFor="r-2">Two</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-3" value="three" />
        <Label htmlFor="r-3">Three</Label>
      </div>
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
  describe("rendering", () => {
    it("renders the group with data-slot=radio-group", () => {
      const { container } = renderWithProviders(<ThreeOptions />);
      const group = container.querySelector('[data-slot="radio-group"]');
      expect(group).not.toBeNull();
      expect(group?.getAttribute("role")).toBe("radiogroup");
    });

    it("renders items with data-slot=radio-group-item and role=radio", () => {
      renderWithProviders(<ThreeOptions />);
      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(3);
      for (const r of radios) {
        expect(r.getAttribute("data-slot")).toBe("radio-group-item");
      }
    });

    it("merges custom className on group and item", () => {
      const { container } = renderWithProviders(
        <RadioGroup className="my-group">
          <RadioGroupItem id="x" value="x" className="my-item" />
        </RadioGroup>,
      );
      const group = container.querySelector('[data-slot="radio-group"]');
      expect(group?.className).toContain("my-group");
      expect(group?.className).toContain("grid");
      const item = screen.getByRole("radio");
      expect(item.className).toContain("my-item");
      expect(item.className).toContain("rounded-full");
    });
  });

  describe("controlled mode", () => {
    it("value reflects state and onValueChange fires on click", () => {
      function Controlled() {
        const [v, setV] = useState("one");
        return <ThreeOptions value={v} onValueChange={setV} />;
      }
      renderWithProviders(<Controlled />);
      const radios = screen.getAllByRole("radio");
      // initial state
      expect(radios[0].getAttribute("data-state")).toBe("checked");
      expect(radios[1].getAttribute("data-state")).toBe("unchecked");
      // click second
      fireEvent.click(radios[1]);
      expect(radios[0].getAttribute("data-state")).toBe("unchecked");
      expect(radios[1].getAttribute("data-state")).toBe("checked");
    });

    it("onValueChange is called with the new value", () => {
      const handler = vi.fn();
      renderWithProviders(<ThreeOptions onValueChange={handler} />);
      const radios = screen.getAllByRole("radio");
      fireEvent.click(radios[2]);
      expect(handler).toHaveBeenCalledWith("three");
    });
  });

  describe("uncontrolled mode", () => {
    it("defaultValue selects the matching item initially", () => {
      renderWithProviders(<ThreeOptions defaultValue="two" />);
      const radios = screen.getAllByRole("radio");
      expect(radios[0].getAttribute("data-state")).toBe("unchecked");
      expect(radios[1].getAttribute("data-state")).toBe("checked");
      expect(radios[2].getAttribute("data-state")).toBe("unchecked");
    });

    it("clicking an item changes the internal state", () => {
      renderWithProviders(<ThreeOptions />);
      const radios = screen.getAllByRole("radio");
      fireEvent.click(radios[1]);
      expect(radios[1].getAttribute("data-state")).toBe("checked");
    });
  });

  describe("disabled", () => {
    it("disabled on the group disables all items", () => {
      renderWithProviders(<ThreeOptions disabled />);
      const radios = screen.getAllByRole("radio");
      for (const r of radios) {
        expect(r.hasAttribute("disabled")).toBe(true);
      }
    });

    it("disabled on a single item only blocks that item", () => {
      renderWithProviders(
        <RadioGroup>
          <RadioGroupItem id="a" value="a" />
          <RadioGroupItem id="b" value="b" disabled />
        </RadioGroup>,
      );
      const [a, b] = screen.getAllByRole("radio");
      expect(a.hasAttribute("disabled")).toBe(false);
      expect(b.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("indicator rendering", () => {
    it("renders the radio-group-indicator slot when checked", () => {
      const { container } = renderWithProviders(
        <ThreeOptions defaultValue="one" />,
      );
      const indicator = container.querySelector(
        '[data-slot="radio-group-indicator"]',
      );
      expect(indicator).not.toBeNull();
    });
  });

  describe("aria-invalid", () => {
    it("retains aria-invalid on the item for downstream styling", () => {
      renderWithProviders(
        <RadioGroup>
          <RadioGroupItem id="i" value="i" aria-invalid />
        </RadioGroup>,
      );
      const item = screen.getByRole("radio");
      expect(item.getAttribute("aria-invalid")).toBe("true");
    });
  });
});
