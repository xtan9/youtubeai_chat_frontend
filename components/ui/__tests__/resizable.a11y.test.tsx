// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { axeResizable } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Resizable a11y", () => {
  it("horizontal split with two panels has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ResizablePanelGroup direction="horizontal" className="h-64">
          <ResizablePanel defaultSize={50}>
            <p>Left content</p>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50}>
            <p>Right content</p>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>,
    );
    const results = await axeResizable(container);
    expect(results).toHaveNoViolations();
  });

  it("vertical split with handle decoration has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ResizablePanelGroup direction="vertical" className="h-64">
          <ResizablePanel defaultSize={60}>
            <p>Top content</p>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={40}>
            <p>Bottom content</p>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>,
    );
    const results = await axeResizable(container);
    expect(results).toHaveNoViolations();
  });

  it("three-panel layout has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ResizablePanelGroup direction="horizontal" className="h-64">
          <ResizablePanel defaultSize={25}>
            <p>Sidebar</p>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50}>
            <p>Main</p>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={25}>
            <p>Inspector</p>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>,
    );
    const results = await axeResizable(container);
    expect(results).toHaveNoViolations();
  });
});
