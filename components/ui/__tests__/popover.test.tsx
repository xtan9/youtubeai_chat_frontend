// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Popover", () => {
  describe("uncontrolled toggle", () => {
    it("is closed initially and opens on trigger click", () => {
      renderWithProviders(
        <Popover>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>panel-body</PopoverContent>
        </Popover>,
      );
      expect(screen.queryByText("panel-body")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByText("panel-body")).toBeTruthy();
    });

    it("toggles closed when trigger is clicked while open", () => {
      renderWithProviders(
        <Popover defaultOpen>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>panel-body</PopoverContent>
        </Popover>,
      );
      expect(screen.getByText("panel-body")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.queryByText("panel-body")).toBeNull();
    });
  });

  describe("controlled mode", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            external
          </button>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger>Trigger</PopoverTrigger>
            <PopoverContent>panel-body</PopoverContent>
          </Popover>
        </>
      );
    }

    it("opens via external state and respects onOpenChange", () => {
      renderWithProviders(<Harness />);
      expect(screen.queryByText("panel-body")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      expect(screen.getByText("panel-body")).toBeTruthy();
    });

    it("calls onOpenChange when the trigger toggles open", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <Popover open={false} onOpenChange={onOpenChange}>
          <PopoverTrigger>Trigger</PopoverTrigger>
          <PopoverContent>panel-body</PopoverContent>
        </Popover>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe("data-slot wiring", () => {
    it("trigger and content emit data-slot attributes", () => {
      renderWithProviders(
        <Popover defaultOpen>
          <PopoverTrigger data-testid="trigger">T</PopoverTrigger>
          <PopoverContent data-testid="content">body</PopoverContent>
        </Popover>,
      );
      expect(screen.getByTestId("trigger").getAttribute("data-slot")).toBe(
        "popover-trigger",
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "popover-content",
      );
    });

    it("anchor renders a child via asChild", () => {
      renderWithProviders(
        <Popover>
          <PopoverAnchor asChild>
            <span data-testid="anchor">anchored</span>
          </PopoverAnchor>
          <PopoverTrigger>T</PopoverTrigger>
          <PopoverContent>body</PopoverContent>
        </Popover>,
      );
      const anchor = screen.getByTestId("anchor");
      expect(anchor.getAttribute("data-slot")).toBe("popover-anchor");
      expect(anchor.tagName).toBe("SPAN");
    });
  });

  describe("classNames", () => {
    it("merges consumer className onto content with baseline classes", () => {
      renderWithProviders(
        <Popover defaultOpen>
          <PopoverTrigger>T</PopoverTrigger>
          <PopoverContent className="my-popover" data-testid="content">
            body
          </PopoverContent>
        </Popover>,
      );
      const cls = screen.getByTestId("content").className;
      expect(cls).toContain("my-popover");
      expect(cls).toContain("bg-surface-overlay");
      expect(cls).toContain("rounded-md");
      expect(cls).toContain("shadow-md");
    });
  });

  describe("aria wiring", () => {
    it("trigger sets aria-expanded based on open state", () => {
      renderWithProviders(
        <Popover>
          <PopoverTrigger>T</PopoverTrigger>
          <PopoverContent>body</PopoverContent>
        </Popover>,
      );
      const trigger = screen.getByRole("button", { name: "T" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });
  });
});
