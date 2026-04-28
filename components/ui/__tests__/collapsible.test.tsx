// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Collapsible", () => {
  describe("default render", () => {
    it("renders root, trigger, and content with the expected data-slot attributes", () => {
      renderWithProviders(
        <Collapsible defaultOpen>
          <CollapsibleTrigger data-testid="trigger">Toggle</CollapsibleTrigger>
          <CollapsibleContent data-testid="content">Body</CollapsibleContent>
        </Collapsible>,
      );
      expect(screen.getByTestId("trigger").getAttribute("data-slot")).toBe(
        "collapsible-trigger",
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "collapsible-content",
      );
      // Root carries data-slot=collapsible — find via querySelector
      const root = screen
        .getByTestId("trigger")
        .closest('[data-slot="collapsible"]');
      expect(root).toBeTruthy();
    });
  });

  describe("uncontrolled mode (defaultOpen)", () => {
    it("starts closed by default and opens on trigger click", () => {
      renderWithProviders(
        <Collapsible>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent>Body</CollapsibleContent>
        </Collapsible>,
      );
      const trigger = screen.getByRole("button");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });

    it("opens immediately when defaultOpen is true", () => {
      renderWithProviders(
        <Collapsible defaultOpen>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent>Body</CollapsibleContent>
        </Collapsible>,
      );
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
        "true",
      );
      expect(screen.getByText("Body")).toBeTruthy();
    });
  });

  describe("controlled mode (open + onOpenChange)", () => {
    it("respects external open state and emits onOpenChange on toggle", () => {
      const onOpenChange = vi.fn();
      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <Collapsible
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              onOpenChange(o);
            }}
          >
            <CollapsibleTrigger>Toggle</CollapsibleTrigger>
            <CollapsibleContent>Body</CollapsibleContent>
          </Collapsible>
        );
      }
      renderWithProviders(<Harness />);
      const trigger = screen.getByRole("button");
      fireEvent.click(trigger);
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("disabled state", () => {
    it("disabled root ignores click and keeps aria-expanded false", () => {
      renderWithProviders(
        <Collapsible disabled>
          <CollapsibleTrigger>Toggle</CollapsibleTrigger>
          <CollapsibleContent>Body</CollapsibleContent>
        </Collapsible>,
      );
      const trigger = screen.getByRole("button");
      expect(trigger.hasAttribute("disabled")).toBe(true);
      fireEvent.click(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("native prop forwarding", () => {
    it("passes className through to the trigger and content slots", () => {
      renderWithProviders(
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="my-trigger">T</CollapsibleTrigger>
          <CollapsibleContent className="my-content">B</CollapsibleContent>
        </Collapsible>,
      );
      expect(screen.getByRole("button").className).toContain("my-trigger");
      // Content's className lands on the Radix element with data-slot
      const content = document.querySelector(
        '[data-slot="collapsible-content"]',
      );
      expect(content?.className).toContain("my-content");
    });
  });
});
