// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { axe, axePortalOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Closed state renders only the trigger; default `axe` is fine.
// Open state portals the menu out of the landmark and uses Radix
// focus guards — `axePortalOverlay` (suppresses `aria-hidden-focus`
// + `region`).

describe("ContextMenu a11y", () => {
  it("closed context menu has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ContextMenu>
          <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Profile</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open context menu (basic items) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ContextMenu>
          <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Profile</ContextMenuItem>
            <ContextMenuItem>Settings</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </main>,
    );
    fireEvent.contextMenu(screen.getByText("Right-click me"));
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("checkbox + radio composite items have no axe violations when open", async () => {
    const { container } = renderWithProviders(
      <main>
        <ContextMenu>
          <ContextMenuTrigger>Right-click</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>View</ContextMenuLabel>
            <ContextMenuCheckboxItem checked>
              Show grid
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem>Show ruler</ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuLabel>Theme</ContextMenuLabel>
            <ContextMenuRadioGroup value="light">
              <ContextMenuRadioItem value="light">Light</ContextMenuRadioItem>
              <ContextMenuRadioItem value="dark">Dark</ContextMenuRadioItem>
              <ContextMenuRadioItem value="system">
                System
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuContent>
        </ContextMenu>
      </main>,
    );
    fireEvent.contextMenu(screen.getByText("Right-click"));
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("submenu trigger has no axe violations when parent menu is open", async () => {
    const { container } = renderWithProviders(
      <main>
        <ContextMenu>
          <ContextMenuTrigger>Right-click</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Profile</ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Share</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>Email</ContextMenuItem>
                <ContextMenuItem>Link</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>
      </main>,
    );
    fireEvent.contextMenu(screen.getByText("Right-click"));
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("item with shortcut has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <ContextMenu>
          <ContextMenuTrigger>Right-click</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              Save
              <ContextMenuShortcut>⌘S</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </main>,
    );
    fireEvent.contextMenu(screen.getByText("Right-click"));
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });
});
