// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("ToggleGroup a11y", () => {
  it("single-select toggle group has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ToggleGroup type="single" aria-label="Text alignment">
          <ToggleGroupItem value="left" aria-label="Left align">
            L
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Center align">
            C
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Right align">
            R
          </ToggleGroupItem>
        </ToggleGroup>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("multiple-select toggle group has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ToggleGroup
          type="multiple"
          aria-label="Text formatting"
          defaultValue={["bold"]}
        >
          <ToggleGroupItem value="bold" aria-label="Bold">
            B
          </ToggleGroupItem>
          <ToggleGroupItem value="italic" aria-label="Italic">
            I
          </ToggleGroupItem>
          <ToggleGroupItem value="underline" aria-label="Underline">
            U
          </ToggleGroupItem>
        </ToggleGroup>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("outline variant has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="View"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            G
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            L
          </ToggleGroupItem>
        </ToggleGroup>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled item in a group has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ToggleGroup type="single" aria-label="Mode">
          <ToggleGroupItem value="a" aria-label="A">
            A
          </ToggleGroupItem>
          <ToggleGroupItem value="b" aria-label="B" disabled>
            B
          </ToggleGroupItem>
        </ToggleGroup>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
