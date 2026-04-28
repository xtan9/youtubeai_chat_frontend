// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Sheet", () => {
  describe("uncontrolled toggle", () => {
    it("is closed initially and opens on trigger click", () => {
      renderWithProviders(
        <Sheet>
          <SheetTrigger>Open</SheetTrigger>
          <SheetContent>
            <SheetTitle>Title</SheetTitle>
            <SheetDescription>Description</SheetDescription>
          </SheetContent>
        </Sheet>,
      );
      expect(screen.queryByText("Title")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByText("Title")).toBeTruthy();
      expect(screen.getByText("Description")).toBeTruthy();
    });

    it("renders the built-in close button when open", () => {
      renderWithProviders(
        <Sheet defaultOpen>
          <SheetContent>
            <SheetTitle>T</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
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
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent>
              <SheetTitle>Controlled</SheetTitle>
              <SheetClose>Programmatic close</SheetClose>
            </SheetContent>
          </Sheet>
        </>
      );
    }

    it("opens via external state and closes via SheetClose", () => {
      renderWithProviders(<Harness />);
      expect(screen.queryByText("Controlled")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      expect(screen.getByText("Controlled")).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: "Programmatic close" }),
      );
      expect(screen.queryByText("Controlled")).toBeNull();
    });

    it("calls onOpenChange when trigger toggles", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <Sheet open={false} onOpenChange={onOpenChange}>
          <SheetTrigger>T</SheetTrigger>
          <SheetContent>
            <SheetTitle>T</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      fireEvent.click(screen.getByRole("button", { name: "T" }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe("side prop", () => {
    it.each([
      ["right", "data-[state=open]:slide-in-from-right"],
      ["left", "data-[state=open]:slide-in-from-left"],
      ["top", "data-[state=open]:slide-in-from-top"],
      ["bottom", "data-[state=open]:slide-in-from-bottom"],
    ] as const)("side=%s applies the slide-in-from-%s class", (side, cls) => {
      renderWithProviders(
        <Sheet defaultOpen>
          <SheetContent side={side}>
            <SheetTitle>T</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog.className).toContain(cls);
    });

    it("defaults to right side when not specified", () => {
      renderWithProviders(
        <Sheet defaultOpen>
          <SheetContent>
            <SheetTitle>T</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog.className).toContain(
        "data-[state=open]:slide-in-from-right",
      );
    });
  });

  describe("data-slot wiring", () => {
    it("emits data-slot on every part when open", () => {
      renderWithProviders(
        <Sheet defaultOpen>
          <SheetContent data-testid="content">
            <SheetHeader data-testid="header">
              <SheetTitle data-testid="title">T</SheetTitle>
              <SheetDescription data-testid="desc">D</SheetDescription>
            </SheetHeader>
            <SheetFooter data-testid="footer">
              <SheetClose data-testid="close">x</SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>,
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "sheet-content",
      );
      expect(screen.getByTestId("header").getAttribute("data-slot")).toBe(
        "sheet-header",
      );
      expect(screen.getByTestId("title").getAttribute("data-slot")).toBe(
        "sheet-title",
      );
      expect(screen.getByTestId("desc").getAttribute("data-slot")).toBe(
        "sheet-description",
      );
      expect(screen.getByTestId("footer").getAttribute("data-slot")).toBe(
        "sheet-footer",
      );
      expect(screen.getByTestId("close").getAttribute("data-slot")).toBe(
        "sheet-close",
      );
    });
  });

  describe("escape-key dismissal", () => {
    it("closes when Escape is pressed inside the content", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <Sheet defaultOpen onOpenChange={onOpenChange}>
          <SheetContent>
            <SheetTitle>T</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      fireEvent.keyDown(screen.getByRole("dialog"), {
        key: "Escape",
        code: "Escape",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
