// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

function StaticAccordion(props: { defaultValue?: string }) {
  return (
    <Accordion type="single" collapsible defaultValue={props.defaultValue}>
      <AccordionItem value="item-1">
        <AccordionTrigger>Trigger 1</AccordionTrigger>
        <AccordionContent>Body 1</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Trigger 2</AccordionTrigger>
        <AccordionContent>Body 2</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion", () => {
  describe("default render", () => {
    it("renders triggers with the accordion-trigger data-slot and items wrap with accordion-item", () => {
      renderWithProviders(<StaticAccordion />);
      const triggers = screen.getAllByRole("button");
      expect(triggers).toHaveLength(2);
      expect(triggers[0].getAttribute("data-slot")).toBe("accordion-trigger");
      // Item wraps the trigger header — walk up to find data-slot=accordion-item
      const item = triggers[0].closest('[data-slot="accordion-item"]');
      expect(item).toBeTruthy();
    });

    it("starts collapsed when no defaultValue is supplied", () => {
      renderWithProviders(<StaticAccordion />);
      const triggers = screen.getAllByRole("button");
      // Closed accordions have aria-expanded="false"
      expect(triggers[0].getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("uncontrolled mode (defaultValue)", () => {
    it("opens the matching item when defaultValue is set", () => {
      renderWithProviders(<StaticAccordion defaultValue="item-1" />);
      const triggers = screen.getAllByRole("button");
      expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
      expect(triggers[1].getAttribute("aria-expanded")).toBe("false");
      // The matching content's data-slot should be present
      const content = screen
        .getByText("Body 1")
        .closest('[data-slot="accordion-content"]');
      expect(content).toBeTruthy();
    });

    it("toggles open state on trigger click (single + collapsible)", () => {
      renderWithProviders(<StaticAccordion />);
      const triggers = screen.getAllByRole("button");
      fireEvent.click(triggers[0]);
      expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(triggers[0]);
      expect(triggers[0].getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("controlled mode", () => {
    it("emits onValueChange with the new value when toggled", () => {
      const onValueChange = vi.fn();
      function Harness() {
        const [value, setValue] = useState<string | undefined>(undefined);
        return (
          <Accordion
            type="single"
            collapsible
            value={value}
            onValueChange={(v) => {
              setValue(v);
              onValueChange(v);
            }}
          >
            <AccordionItem value="item-1">
              <AccordionTrigger>Trigger 1</AccordionTrigger>
              <AccordionContent>Body 1</AccordionContent>
            </AccordionItem>
          </Accordion>
        );
      }
      renderWithProviders(<Harness />);
      fireEvent.click(screen.getByRole("button"));
      expect(onValueChange).toHaveBeenCalledWith("item-1");
    });
  });

  describe("multiple type", () => {
    it("allows multiple items open simultaneously when type='multiple'", () => {
      renderWithProviders(
        <Accordion type="multiple" defaultValue={["a", "b"]}>
          <AccordionItem value="a">
            <AccordionTrigger>A</AccordionTrigger>
            <AccordionContent>Body A</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>B</AccordionTrigger>
            <AccordionContent>Body B</AccordionContent>
          </AccordionItem>
        </Accordion>,
      );
      const triggers = screen.getAllByRole("button");
      expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
      expect(triggers[1].getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the item and content slots", () => {
      renderWithProviders(
        <Accordion type="single" collapsible defaultValue="x">
          <AccordionItem value="x" className="my-item">
            <AccordionTrigger className="my-trigger">T</AccordionTrigger>
            <AccordionContent className="my-content">B</AccordionContent>
          </AccordionItem>
        </Accordion>,
      );
      const trigger = screen.getByRole("button");
      expect(trigger.className).toContain("my-trigger");
      const item = trigger.closest('[data-slot="accordion-item"]');
      expect(item?.className).toContain("my-item");
      // AccordionContent wraps consumer's children in a `<div>` carrying
      // the consumer className while the Radix Content gets the slot.
      const innerDiv = screen.getByText("B");
      expect(innerDiv.className).toContain("my-content");
    });
  });

  describe("disabled state", () => {
    it("disabled item ignores click and reports aria-disabled", () => {
      renderWithProviders(
        <Accordion type="single" collapsible>
          <AccordionItem value="x" disabled>
            <AccordionTrigger>Disabled</AccordionTrigger>
            <AccordionContent>Body</AccordionContent>
          </AccordionItem>
        </Accordion>,
      );
      const trigger = screen.getByRole("button");
      // Radix sets data-disabled on the trigger; it's also disabled
      expect(trigger.hasAttribute("disabled")).toBe(true);
      fireEvent.click(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
  });
});
