// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

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
import { axe, axeOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Dialog a11y", () => {
  it("closed dialog (only trigger rendered) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Dialog>
        <DialogTrigger>Open settings</DialogTrigger>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open dialog with title + description has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Update your display name and avatar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <button type="button">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    // Dialog content is portaled into document.body — scan the whole tree.
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("open dialog without close button (showCloseButton=false) has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Multi-step flow</DialogTitle>
          <DialogDescription>Step 1 of 3</DialogDescription>
          <DialogFooter>
            <button type="button">Next</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("dialog with form inside has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New playlist</DialogTitle>
            <DialogDescription>Give it a name.</DialogDescription>
          </DialogHeader>
          <form>
            <label htmlFor="pl-name">Name</label>
            <input id="pl-name" type="text" />
            <DialogFooter>
              <DialogClose>Cancel</DialogClose>
              <button type="submit">Create</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    );
    const results = await axeOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });
});
