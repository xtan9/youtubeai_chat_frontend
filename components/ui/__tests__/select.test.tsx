// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Select", () => {
  describe("default render", () => {
    it("renders the trigger with data-slot=select-trigger and starts closed", () => {
      renderWithProviders(
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>,
      );
      const trigger = screen.getByRole("combobox");
      expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
      expect(trigger.getAttribute("data-state")).toBe("closed");
      // Content is portaled and only mounts on open
      expect(screen.queryByText("Apple")).toBeNull();
    });

    it("default size attribute is 'default'", () => {
      renderWithProviders(
        <Select>
          <SelectTrigger data-testid="t">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
        </Select>,
      );
      expect(screen.getByTestId("t").getAttribute("data-size")).toBe("default");
    });

    it("size='sm' sets data-size='sm'", () => {
      renderWithProviders(
        <Select>
          <SelectTrigger size="sm" data-testid="t">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
        </Select>,
      );
      expect(screen.getByTestId("t").getAttribute("data-size")).toBe("sm");
    });

    it("renders SelectValue with data-slot=select-value (auto-applied via Radix asChild)", () => {
      renderWithProviders(
        <Select>
          <SelectTrigger>
            <SelectValue placeholder="Pick" data-testid="value" />
          </SelectTrigger>
        </Select>,
      );
      // SelectValue lives inside the trigger; check its data-slot
      const value = screen.getByTestId("value");
      expect(value.getAttribute("data-slot")).toBe("select-value");
    });
  });

  describe("controlled mode (open + onOpenChange)", () => {
    it("opens via external state and emits onValueChange when an item is picked", () => {
      const onValueChange = vi.fn();
      function Harness() {
        const [open, setOpen] = useState(false);
        const [value, setValue] = useState<string>("");
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              external
            </button>
            <Select
              open={open}
              onOpenChange={setOpen}
              value={value}
              onValueChange={(v) => {
                setValue(v);
                onValueChange(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apple">Apple</SelectItem>
                <SelectItem value="banana">Banana</SelectItem>
              </SelectContent>
            </Select>
          </>
        );
      }
      renderWithProviders(<Harness />);
      // Open via external trigger
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      // Pick an item by keyboard activation
      const item = screen.getByText("Apple");
      fireEvent.keyDown(item, { key: "Enter" });
      expect(onValueChange).toHaveBeenCalledWith("apple");
    });
  });

  describe("uncontrolled mode (defaultValue)", () => {
    it("displays the default value's label inside the trigger", () => {
      renderWithProviders(
        <Select defaultValue="banana">
          <SelectTrigger>
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectContent>
        </Select>,
      );
      expect(screen.getByRole("combobox").textContent).toContain("Banana");
    });
  });

  describe("groups, labels, and separators", () => {
    it("forced-open content carries the right data-slot for each part", () => {
      renderWithProviders(
        <Select open>
          <SelectTrigger>
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup data-testid="group">
              <SelectLabel data-testid="label">Fruits</SelectLabel>
              <SelectItem value="apple" data-testid="item">
                Apple
              </SelectItem>
            </SelectGroup>
            <SelectSeparator data-testid="sep" />
            <SelectItem value="cheese">Cheese</SelectItem>
          </SelectContent>
        </Select>,
      );
      expect(screen.getByTestId("group").getAttribute("data-slot")).toBe(
        "select-group",
      );
      expect(screen.getByTestId("label").getAttribute("data-slot")).toBe(
        "select-label",
      );
      expect(screen.getByTestId("item").getAttribute("data-slot")).toBe(
        "select-item",
      );
      expect(screen.getByTestId("sep").getAttribute("data-slot")).toBe(
        "select-separator",
      );
    });
  });

  describe("disabled trigger", () => {
    it("disabled trigger has the disabled attribute and ignores click", () => {
      renderWithProviders(
        <Select disabled>
          <SelectTrigger data-testid="t">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>,
      );
      const trigger = screen.getByTestId("t");
      expect(trigger.hasAttribute("disabled")).toBe(true);
      fireEvent.click(trigger);
      expect(trigger.getAttribute("data-state")).toBe("closed");
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the trigger and content", () => {
      renderWithProviders(
        <Select open>
          <SelectTrigger className="my-trigger" data-testid="t">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent className="my-content" data-testid="c">
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>,
      );
      expect(screen.getByTestId("t").className).toContain("my-trigger");
      expect(screen.getByTestId("c").className).toContain("my-content");
    });
  });
});
