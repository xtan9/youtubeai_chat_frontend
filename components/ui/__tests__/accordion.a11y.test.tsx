// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Radix Accordion renders each trigger inside a <h3>. To keep the a11y
// fixture's heading order valid (axe's `heading-order` rule), the
// surrounding scaffold uses an <h2> right above the accordion so the
// next level (h3) follows the expected progression.
describe("Accordion a11y", () => {
  it("collapsed accordion has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <h2>FAQ</h2>
        <Accordion type="single" collapsible>
          <AccordionItem value="a">
            <AccordionTrigger>Question A</AccordionTrigger>
            <AccordionContent>Answer A</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Question B</AccordionTrigger>
            <AccordionContent>Answer B</AccordionContent>
          </AccordionItem>
        </Accordion>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("expanded accordion (single) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <h2>FAQ</h2>
        <Accordion type="single" collapsible defaultValue="a">
          <AccordionItem value="a">
            <AccordionTrigger>Question A</AccordionTrigger>
            <AccordionContent>Answer A</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Question B</AccordionTrigger>
            <AccordionContent>Answer B</AccordionContent>
          </AccordionItem>
        </Accordion>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("multiple-open accordion has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <h2>FAQ</h2>
        <Accordion type="multiple" defaultValue={["a", "b"]}>
          <AccordionItem value="a">
            <AccordionTrigger>Question A</AccordionTrigger>
            <AccordionContent>Answer A</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Question B</AccordionTrigger>
            <AccordionContent>Answer B</AccordionContent>
          </AccordionItem>
        </Accordion>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled accordion item has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <h2>FAQ</h2>
        <Accordion type="single" collapsible>
          <AccordionItem value="a" disabled>
            <AccordionTrigger>Disabled question</AccordionTrigger>
            <AccordionContent>Disabled answer</AccordionContent>
          </AccordionItem>
        </Accordion>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
