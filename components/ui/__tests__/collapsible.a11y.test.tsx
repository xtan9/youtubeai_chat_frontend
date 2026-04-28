// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Collapsible a11y", () => {
  it("closed collapsible has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Collapsible>
          <CollapsibleTrigger>Show details</CollapsibleTrigger>
          <CollapsibleContent>Hidden details</CollapsibleContent>
        </Collapsible>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open collapsible has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Collapsible defaultOpen>
          <CollapsibleTrigger>Hide details</CollapsibleTrigger>
          <CollapsibleContent>Visible details</CollapsibleContent>
        </Collapsible>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled collapsible has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Collapsible disabled>
          <CollapsibleTrigger>Disabled trigger</CollapsibleTrigger>
          <CollapsibleContent>Hidden body</CollapsibleContent>
        </Collapsible>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
