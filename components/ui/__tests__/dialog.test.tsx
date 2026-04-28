// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Dialog", () => {
  describe("uncontrolled open/close via trigger", () => {
    it("is closed initially and opens on trigger click", () => {
      renderWithProviders(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogContent>
        </Dialog>,
      );
      // Closed initially: title not in the DOM.
      expect(screen.queryByText("Title")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText("Title")).toBeTruthy();
      expect(screen.getByText("Description")).toBeTruthy();
    });

    it("renders the built-in close button when open", () => {
      renderWithProviders(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>T</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      // The X button has an sr-only "Close" label.
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    });

    it("hides the built-in close button when showCloseButton=false", () => {
      renderWithProviders(
        <Dialog defaultOpen>
          <DialogContent showCloseButton={false}>
            <DialogTitle>T</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    });
  });

  describe("controlled mode", () => {
    function ControlledHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            external-open
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Controlled</DialogTitle>
              <DialogClose>Programmatic close</DialogClose>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    it("opens via external state, closes via DialogClose, and emits onOpenChange", () => {
      renderWithProviders(<ControlledHarness />);
      // Closed initially.
      expect(screen.queryByText("Controlled")).toBeNull();

      // Open via external state.
      fireEvent.click(screen.getByRole("button", { name: "external-open" }));
      expect(screen.getByText("Controlled")).toBeTruthy();

      // Close via DialogClose.
      fireEvent.click(
        screen.getByRole("button", { name: "Programmatic close" }),
      );
      expect(screen.queryByText("Controlled")).toBeNull();
    });

    it("invokes onOpenChange when the trigger toggles state", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <Dialog open={false} onOpenChange={onOpenChange}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>T</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe("data-slot wiring", () => {
    it("emits data-slot attributes on every part when open", () => {
      renderWithProviders(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader data-testid="header">
              <DialogTitle data-testid="title">T</DialogTitle>
              <DialogDescription data-testid="desc">D</DialogDescription>
            </DialogHeader>
            <DialogFooter data-testid="footer">
              <DialogClose data-testid="close">x</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>,
      );
      expect(screen.getByTestId("header").getAttribute("data-slot")).toBe(
        "dialog-header",
      );
      expect(screen.getByTestId("title").getAttribute("data-slot")).toBe(
        "dialog-title",
      );
      expect(screen.getByTestId("desc").getAttribute("data-slot")).toBe(
        "dialog-description",
      );
      expect(screen.getByTestId("footer").getAttribute("data-slot")).toBe(
        "dialog-footer",
      );
      expect(screen.getByTestId("close").getAttribute("data-slot")).toBe(
        "dialog-close",
      );
      // Content is harder to query by testid (Radix wraps it); look up by role.
      expect(
        screen.getByRole("dialog").getAttribute("data-slot"),
      ).toBe("dialog-content");
    });
  });

  describe("native prop forwarding", () => {
    it("forwards className onto DialogContent in addition to baseline classes", () => {
      renderWithProviders(
        <Dialog defaultOpen>
          <DialogContent className="my-content">
            <DialogTitle>T</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      const cls = screen.getByRole("dialog").className;
      expect(cls).toContain("my-content");
      expect(cls).toContain("rounded-lg");
      expect(cls).toContain("shadow-lg");
    });

    it("DialogTitle/DialogDescription get sensible default classes", () => {
      renderWithProviders(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle data-testid="title">Heading</DialogTitle>
            <DialogDescription data-testid="desc">Sub</DialogDescription>
          </DialogContent>
        </Dialog>,
      );
      expect(screen.getByTestId("title").className).toContain("font-semibold");
      expect(screen.getByTestId("desc").className).toContain(
        "text-muted-foreground",
      );
    });
  });

  describe("escape-key dismissal", () => {
    it("closes when Escape is pressed inside the content", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <Dialog defaultOpen onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>T</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      fireEvent.keyDown(screen.getByRole("dialog"), {
        key: "Escape",
        code: "Escape",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
