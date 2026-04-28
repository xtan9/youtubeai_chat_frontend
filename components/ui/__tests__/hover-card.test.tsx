// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("HoverCard", () => {
  describe("rendering", () => {
    it("trigger only is in DOM until card is opened", () => {
      renderWithProviders(
        <HoverCard>
          <HoverCardTrigger asChild>
            <a href="/u/jane">@jane</a>
          </HoverCardTrigger>
          <HoverCardContent>preview-body</HoverCardContent>
        </HoverCard>,
      );
      expect(screen.getByRole("link", { name: "@jane" })).toBeTruthy();
      expect(screen.queryByText("preview-body")).toBeNull();
    });

    it("forced-open via defaultOpen mounts the content with data-slot", () => {
      renderWithProviders(
        <HoverCard defaultOpen>
          <HoverCardTrigger data-testid="trig">@jane</HoverCardTrigger>
          <HoverCardContent data-testid="content">preview-body</HoverCardContent>
        </HoverCard>,
      );
      expect(screen.getByTestId("trig").getAttribute("data-slot")).toBe(
        "hover-card-trigger",
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "hover-card-content",
      );
      expect(screen.getByTestId("content").textContent).toContain(
        "preview-body",
      );
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
          <HoverCard open={open} onOpenChange={setOpen}>
            <HoverCardTrigger>T</HoverCardTrigger>
            <HoverCardContent>preview-body</HoverCardContent>
          </HoverCard>
        </>
      );
    }

    it("opens when external state flips to true", () => {
      renderWithProviders(<Harness />);
      expect(screen.queryByText("preview-body")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      expect(screen.getByText("preview-body")).toBeTruthy();
    });

    it("respects open prop directly", () => {
      const onOpenChange = vi.fn();
      const { rerender } = renderWithProviders(
        <HoverCard open={false} onOpenChange={onOpenChange}>
          <HoverCardTrigger>T</HoverCardTrigger>
          <HoverCardContent>preview-body</HoverCardContent>
        </HoverCard>,
      );
      expect(screen.queryByText("preview-body")).toBeNull();
      rerender(
        <HoverCard open={true} onOpenChange={onOpenChange}>
          <HoverCardTrigger>T</HoverCardTrigger>
          <HoverCardContent>preview-body</HoverCardContent>
        </HoverCard>,
      );
      expect(screen.getByText("preview-body")).toBeTruthy();
    });
  });

  describe("classNames", () => {
    it("merges consumer className with baseline classes on content", () => {
      renderWithProviders(
        <HoverCard defaultOpen>
          <HoverCardTrigger>T</HoverCardTrigger>
          <HoverCardContent className="my-card" data-testid="content">
            preview
          </HoverCardContent>
        </HoverCard>,
      );
      const cls = screen.getByTestId("content").className;
      expect(cls).toContain("my-card");
      expect(cls).toContain("bg-surface-overlay");
      expect(cls).toContain("rounded-md");
      expect(cls).toContain("shadow-md");
      expect(cls).toContain("w-64");
    });

  });

  describe("composition with asChild", () => {
    it("trigger forwards onto a Link/anchor via asChild", () => {
      renderWithProviders(
        <HoverCard defaultOpen>
          <HoverCardTrigger asChild>
            <a href="/u/jane" data-testid="anchor">
              @jane
            </a>
          </HoverCardTrigger>
          <HoverCardContent>body</HoverCardContent>
        </HoverCard>,
      );
      const anchor = screen.getByTestId("anchor");
      expect(anchor.tagName).toBe("A");
      expect(anchor.getAttribute("href")).toBe("/u/jane");
      expect(anchor.getAttribute("data-slot")).toBe("hover-card-trigger");
    });
  });
});
