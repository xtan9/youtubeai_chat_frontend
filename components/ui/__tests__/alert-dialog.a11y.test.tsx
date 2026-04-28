// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

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
import { axe, axeOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("AlertDialog a11y", () => {
  it("closed alert-dialog (only trigger rendered) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete?</AlertDialogTitle>
          <AlertDialogDescription>This is permanent.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open destructive-confirm dialog has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This is permanent. All summaries will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Delete account</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("open dialog with only cancel (no action) still meets a11y", async () => {
    const { baseElement } = renderWithProviders(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Action no longer available</AlertDialogTitle>
            <AlertDialogDescription>
              You can dismiss this notice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Got it</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });
});
