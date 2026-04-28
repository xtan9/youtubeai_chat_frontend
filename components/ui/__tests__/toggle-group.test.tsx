// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("ToggleGroup", () => {
  describe("default render", () => {
    it("renders the group with data-slot=toggle-group and items with data-slot=toggle-group-item", () => {
      renderWithProviders(
        <ToggleGroup type="single" data-testid="group">
          <ToggleGroupItem value="left" aria-label="Left">
            L
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Center">
            C
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Right">
            R
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const group = screen.getByTestId("group");
      expect(group.getAttribute("data-slot")).toBe("toggle-group");
      const items = group.querySelectorAll(
        '[data-slot="toggle-group-item"]',
      );
      expect(items.length).toBe(3);
    });
  });

  describe("variant + size propagation via context", () => {
    it("propagates outline variant onto items via the group context", () => {
      renderWithProviders(
        <ToggleGroup type="single" variant="outline" data-testid="group">
          <ToggleGroupItem value="x" aria-label="x" data-testid="item">
            x
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const item = screen.getByTestId("item");
      expect(item.getAttribute("data-variant")).toBe("outline");
    });

    it("propagates size=sm onto items via the group context", () => {
      renderWithProviders(
        <ToggleGroup type="single" size="sm" data-testid="group">
          <ToggleGroupItem value="x" aria-label="x" data-testid="item">
            x
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const item = screen.getByTestId("item");
      expect(item.getAttribute("data-size")).toBe("sm");
    });
  });

  describe("type='single'", () => {
    it("uncontrolled: clicking an item sets data-state=on for that item only", () => {
      renderWithProviders(
        <ToggleGroup type="single">
          <ToggleGroupItem value="left" aria-label="Left">
            L
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Right">
            R
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const left = screen.getByRole("radio", { name: "Left" });
      const right = screen.getByRole("radio", { name: "Right" });
      fireEvent.click(left);
      expect(left.getAttribute("data-state")).toBe("on");
      expect(right.getAttribute("data-state")).toBe("off");
      fireEvent.click(right);
      expect(left.getAttribute("data-state")).toBe("off");
      expect(right.getAttribute("data-state")).toBe("on");
    });

    it("controlled: emits onValueChange with the new selection", () => {
      const onValueChange = vi.fn();
      function Harness() {
        const [v, setV] = useState<string>("");
        return (
          <ToggleGroup
            type="single"
            value={v}
            onValueChange={(next) => {
              setV(next);
              onValueChange(next);
            }}
          >
            <ToggleGroupItem value="left" aria-label="Left">
              L
            </ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Right">
              R
            </ToggleGroupItem>
          </ToggleGroup>
        );
      }
      renderWithProviders(<Harness />);
      fireEvent.click(screen.getByRole("radio", { name: "Right" }));
      expect(onValueChange).toHaveBeenCalledWith("right");
    });
  });

  describe("type='multiple'", () => {
    it("supports multiple simultaneous selections", () => {
      renderWithProviders(
        <ToggleGroup type="multiple" defaultValue={["a", "b"]}>
          <ToggleGroupItem value="a" aria-label="A">
            A
          </ToggleGroupItem>
          <ToggleGroupItem value="b" aria-label="B">
            B
          </ToggleGroupItem>
          <ToggleGroupItem value="c" aria-label="C">
            C
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const a = screen.getByRole("button", { name: "A", pressed: true });
      const b = screen.getByRole("button", { name: "B", pressed: true });
      const c = screen.getByRole("button", { name: "C", pressed: false });
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      expect(c).toBeTruthy();
    });
  });

  describe("disabled", () => {
    it("disabled item has disabled attribute and ignores click", () => {
      renderWithProviders(
        <ToggleGroup type="single">
          <ToggleGroupItem value="left" aria-label="Left" disabled>
            L
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const left = screen.getByRole("radio", { name: "Left" });
      expect(left.hasAttribute("disabled")).toBe(true);
      fireEvent.click(left);
      expect(left.getAttribute("data-state")).toBe("off");
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the group root", () => {
      renderWithProviders(
        <ToggleGroup type="single" className="my-group" data-testid="group">
          <ToggleGroupItem value="x" aria-label="x">
            x
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      expect(screen.getByTestId("group").className).toContain("my-group");
    });
  });
});
