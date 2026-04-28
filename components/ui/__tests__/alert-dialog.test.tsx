// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("AlertDialog", () => {
  describe("uncontrolled toggle", () => {
    it("is closed initially and opens on trigger click", () => {
      renderWithProviders(
        <AlertDialog>
          <AlertDialogTrigger>Open</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogDescription>Description</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      );
      expect(screen.queryByText("Title")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      // Note: Radix's AlertDialogContent uses role="alertdialog", not "dialog".
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      expect(screen.getByText("Title")).toBeTruthy();
      expect(screen.getByText("Description")).toBeTruthy();
    });

    it("does NOT render a built-in close button (unlike Dialog)", () => {
      renderWithProviders(
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>T</AlertDialogTitle>
            <AlertDialogDescription>D</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      );
      // No anonymous "Close" button appears; only the explicit Action / Cancel
      // (which we didn't render here).
      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    });
  });

  describe("Action and Cancel", () => {
    it("renders Action and Cancel with button styling", () => {
      renderWithProviders(
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>Confirm</AlertDialogTitle>
            <AlertDialogDescription>Are you sure?</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="action">OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>,
      );
      const cancel = screen.getByTestId("cancel");
      const action = screen.getByTestId("action");
      // Cancel uses outline variant (bg-surface-base); Action uses default (bg-surface-inverse).
      expect(cancel.className).toContain("bg-surface-base");
      expect(action.className).toContain("bg-surface-inverse");
    });

    it("Cancel click closes the dialog", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <AlertDialog defaultOpen onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogTitle>T</AlertDialogTitle>
            <AlertDialogDescription>D</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("Action click closes the dialog and runs onClick", () => {
      const onAction = vi.fn();
      const onOpenChange = vi.fn();
      renderWithProviders(
        <AlertDialog defaultOpen onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogTitle>T</AlertDialogTitle>
            <AlertDialogDescription>D</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onAction}>OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>,
      );
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("controlled mode", () => {
    function Harness({ onChange }: { onChange?: (open: boolean) => void }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            external
          </button>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              onChange?.(next);
            }}
          >
            <AlertDialogContent>
              <AlertDialogTitle>Controlled</AlertDialogTitle>
              <AlertDialogDescription>D</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    }

    it("opens via external state and calls onOpenChange on cancel", () => {
      const onChange = vi.fn();
      renderWithProviders(<Harness onChange={onChange} />);
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      expect(screen.getByText("Controlled")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onChange).toHaveBeenCalledWith(false);
    });
  });

  describe("escape-key dismissal", () => {
    it("closes on Escape (Radix default for alert-dialog)", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <AlertDialog defaultOpen onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogTitle>T</AlertDialogTitle>
            <AlertDialogDescription>D</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      );
      fireEvent.keyDown(screen.getByRole("alertdialog"), {
        key: "Escape",
        code: "Escape",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("data-slot wiring", () => {
    it("emits data-slot on every part when open", () => {
      renderWithProviders(
        <AlertDialog defaultOpen>
          <AlertDialogContent data-testid="content">
            <AlertDialogHeader data-testid="header">
              <AlertDialogTitle data-testid="title">T</AlertDialogTitle>
              <AlertDialogDescription data-testid="desc">
                D
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter data-testid="footer">
              <AlertDialogCancel data-testid="cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="action">OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>,
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "alert-dialog-content",
      );
      expect(screen.getByTestId("header").getAttribute("data-slot")).toBe(
        "alert-dialog-header",
      );
      expect(screen.getByTestId("title").getAttribute("data-slot")).toBe(
        "alert-dialog-title",
      );
      expect(screen.getByTestId("desc").getAttribute("data-slot")).toBe(
        "alert-dialog-description",
      );
      expect(screen.getByTestId("footer").getAttribute("data-slot")).toBe(
        "alert-dialog-footer",
      );
      expect(screen.getByTestId("cancel").getAttribute("data-slot")).toBe(
        "alert-dialog-cancel",
      );
      expect(screen.getByTestId("action").getAttribute("data-slot")).toBe(
        "alert-dialog-action",
      );
    });
  });
});
