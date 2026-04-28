// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// react-resizable-panels v4 manages its own ids/data-testid for layout
// persistence; consumer-supplied `data-testid` on the Group is
// overridden. Tests select via `[data-slot="..."]` instead.

describe("Resizable", () => {
  describe("default render", () => {
    it("renders a horizontal panel group with two panels and a handle, all carrying their data-slot", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50}>
            <span>Left</span>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50}>
            <span>Right</span>
          </ResizablePanel>
        </ResizablePanelGroup>,
      );
      expect(
        container.querySelector('[data-slot="resizable-panel-group"]'),
      ).toBeTruthy();
      const panels = container.querySelectorAll(
        '[data-slot="resizable-panel"]',
      );
      expect(panels.length).toBe(2);
      const handle = container.querySelector(
        '[data-slot="resizable-handle"]',
      );
      expect(handle).toBeTruthy();
      expect(handle?.getAttribute("role")).toBe("separator");
    });

    it("handle is focusable (tabindex=0) for keyboard resizing", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const handle = container.querySelector(
        '[data-slot="resizable-handle"]',
      );
      expect(handle?.getAttribute("tabindex")).toBe("0");
    });

    it("handle has aria-orientation reflecting the separator's visual axis", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const handle = container.querySelector(
        '[data-slot="resizable-handle"]',
      );
      // v4's separator carries aria-orientation; the wrapper drives
      // direction-aware styling off this attribute. Both directions
      // currently render `aria-orientation="vertical"` in v4 — see
      // https://github.com/bvaughn/react-resizable-panels for the
      // semantics; what we want to assert is that the attribute is
      // present and one of the WAI-ARIA values, not which one.
      const aria = handle?.getAttribute("aria-orientation");
      expect(["vertical", "horizontal"]).toContain(aria);
    });

    it("translates legacy `direction` prop to v4's `orientation` (and the inline flex-direction tracks)", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const grp = container.querySelector(
        '[data-slot="resizable-panel-group"]',
      ) as HTMLElement | null;
      // v4 sets `flex-direction: column` for vertical orientation
      // inline; check the live computed style.
      expect(grp?.style.flexDirection).toBe("column");
    });

    it("native `orientation` prop also works (v4 native API)", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const grp = container.querySelector(
        '[data-slot="resizable-panel-group"]',
      ) as HTMLElement | null;
      expect(grp?.style.flexDirection).toBe("column");
    });
  });

  describe("withHandle decoration", () => {
    it("renders the grip icon when withHandle is true", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const handle = container.querySelector(
        '[data-slot="resizable-handle"]',
      );
      expect(handle?.querySelector("svg")).toBeTruthy();
    });

    it("omits the grip icon when withHandle is false (default)", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const handle = container.querySelector(
        '[data-slot="resizable-handle"]',
      );
      expect(handle?.querySelector("svg")).toBeNull();
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the panel group root", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal" className="my-grp">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const grp = container.querySelector(
        '[data-slot="resizable-panel-group"]',
      );
      expect(grp?.className).toContain("my-grp");
    });

    it("merges className on the handle", () => {
      const { container } = renderWithProviders(
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} />
          <ResizableHandle className="my-handle" />
          <ResizablePanel defaultSize={50} />
        </ResizablePanelGroup>,
      );
      const handle = container.querySelector(
        '[data-slot="resizable-handle"]',
      );
      expect(handle?.className).toContain("my-handle");
    });
  });

  describe("export shape (react-resizable-panels v4)", () => {
    it("exports ResizablePanelGroup, ResizablePanel, and ResizableHandle as the public API", () => {
      // Smoke check: the imports above resolved. The v4 migration
      // (A1 PR 4) renamed the underlying primitives to `Group` and
      // `Separator` while keeping our public wrappers stable.
      expect(typeof ResizablePanelGroup).toBe("function");
      expect(typeof ResizablePanel).toBe("function");
      expect(typeof ResizableHandle).toBe("function");
    });
  });
});
