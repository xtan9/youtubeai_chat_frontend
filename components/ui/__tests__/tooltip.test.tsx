// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Tooltip", () => {
  describe("rendering", () => {
    it("trigger is in the DOM but content is not, until shown", () => {
      renderWithProviders(
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>tip-body</TooltipContent>
        </Tooltip>,
      );
      expect(screen.getByRole("button", { name: "Hover me" })).toBeTruthy();
      expect(screen.queryByText("tip-body")).toBeNull();
    });

    it("forced-open via defaultOpen mounts the content with data-slot", () => {
      renderWithProviders(
        <Tooltip defaultOpen>
          <TooltipTrigger data-testid="trig">Hover me</TooltipTrigger>
          <TooltipContent data-testid="content">tip-body</TooltipContent>
        </Tooltip>,
      );
      expect(screen.getByTestId("trig").getAttribute("data-slot")).toBe(
        "tooltip-trigger",
      );
      // Tooltip content is portaled; query by text within the document.
      const content = screen.getByTestId("content");
      expect(content.getAttribute("data-slot")).toBe("tooltip-content");
      expect(content.textContent).toContain("tip-body");
    });
  });

  describe("controlled mode", () => {
    it("respects open prop", () => {
      const { rerender } = renderWithProviders(
        <Tooltip open={false}>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent data-testid="content">tip-body</TooltipContent>
        </Tooltip>,
      );
      expect(screen.queryByTestId("content")).toBeNull();
      rerender(
        <Tooltip open={true}>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent data-testid="content">tip-body</TooltipContent>
        </Tooltip>,
      );
      expect(screen.getByTestId("content").textContent).toContain("tip-body");
    });
  });

  describe("classNames", () => {
    it("merges consumer className with baseline tooltip classes", () => {
      renderWithProviders(
        <Tooltip defaultOpen>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent className="my-tip" data-testid="content">
            tip-body
          </TooltipContent>
        </Tooltip>,
      );
      const cls = screen.getByTestId("content").className;
      expect(cls).toContain("my-tip");
      expect(cls).toContain("bg-primary");
      expect(cls).toContain("text-primary-foreground");
      expect(cls).toContain("rounded-md");
      expect(cls).toContain("text-xs");
    });
  });

  describe("provider", () => {
    it("TooltipProvider renders its children unchanged", () => {
      renderWithProviders(
        <TooltipProvider>
          <span data-testid="child">child</span>
        </TooltipProvider>,
      );
      expect(screen.getByTestId("child").textContent).toBe("child");
    });

    it("Tooltip auto-wraps in a provider so a bare Tooltip works", () => {
      renderWithProviders(
        <Tooltip defaultOpen>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent data-testid="content">tip-body</TooltipContent>
        </Tooltip>,
      );
      // Radix renders both a visible TooltipContent and an sr-only mirror
      // for assistive tech; both contain the same text. Scope to the
      // visible-styled one via the data-testid we set.
      expect(screen.getByTestId("content").textContent).toContain("tip-body");
    });
  });

  describe("composition with asChild", () => {
    it("trigger forwards onto a custom button via asChild", () => {
      renderWithProviders(
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button" data-testid="custom-btn">
              Custom
            </button>
          </TooltipTrigger>
          <TooltipContent>tip-body</TooltipContent>
        </Tooltip>,
      );
      const btn = screen.getByTestId("custom-btn");
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("data-slot")).toBe("tooltip-trigger");
    });
  });
});
