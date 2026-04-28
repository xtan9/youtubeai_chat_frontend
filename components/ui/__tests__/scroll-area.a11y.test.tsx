// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("ScrollArea a11y", () => {
  it("default scroll area with text content has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ScrollArea className="h-32 w-48 rounded-md border p-2">
          <p>Lorem ipsum dolor sit amet.</p>
          <p>Consectetur adipiscing elit.</p>
          <p>Sed do eiusmod tempor incididunt.</p>
        </ScrollArea>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("scroll area wrapping a list has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ScrollArea className="h-40 w-48 rounded-md border">
          <ul>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i}>Item {i + 1}</li>
            ))}
          </ul>
        </ScrollArea>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("horizontal + vertical scrollbars together have no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ScrollArea className="h-40 w-40 rounded-md border whitespace-nowrap">
          <div className="flex gap-4 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>Card {i + 1}</div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
