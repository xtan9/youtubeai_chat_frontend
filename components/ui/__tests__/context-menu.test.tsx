// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
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
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Radix ContextMenu opens via a real `contextmenu` event on the
// trigger. happy-dom dispatches it, but the convenient API is
// `fireEvent.contextMenu(...)`.

describe("ContextMenu", () => {
  describe("rendering", () => {
    it("trigger only is in the DOM until opened", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Profile</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      expect(screen.getByText("Right-click me")).toBeTruthy();
      expect(screen.queryByText("Profile")).toBeNull();
    });

    it("opens on contextmenu event and mounts the items with their data-slot", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger data-testid="trigger">
            Right-click me
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem data-testid="item">Profile</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      const trigger = screen.getByTestId("trigger");
      fireEvent.contextMenu(trigger);
      const item = screen.getByTestId("item");
      expect(item.getAttribute("data-slot")).toBe("context-menu-item");
    });
  });

  describe("interaction", () => {
    it("invokes onSelect on a menu item", () => {
      const onSelect = vi.fn();
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={onSelect}>Profile</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      const item = screen.getByText("Profile");
      // Radix uses pointerup as the activation event
      fireEvent.pointerDown(item, { button: 0, pointerType: "mouse" });
      fireEvent.pointerUp(item, { button: 0, pointerType: "mouse" });
      fireEvent.click(item);
      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe("variants", () => {
    it("destructive variant carries data-variant=destructive on the item", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem variant="destructive" data-testid="del">
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      expect(screen.getByTestId("del").getAttribute("data-variant")).toBe(
        "destructive",
      );
    });

    it("default variant emits data-variant=default", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem data-testid="def">Profile</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      expect(screen.getByTestId("def").getAttribute("data-variant")).toBe(
        "default",
      );
    });

    it("inset items get data-inset=true", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel inset data-testid="label">
              Account
            </ContextMenuLabel>
            <ContextMenuItem inset data-testid="item">
              Profile
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      expect(screen.getByTestId("label").getAttribute("data-inset")).toBe(
        "true",
      );
      expect(screen.getByTestId("item").getAttribute("data-inset")).toBe(
        "true",
      );
    });
  });

  describe("composite items", () => {
    it("checkbox item carries data-slot=context-menu-checkbox-item and reflects checked state", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuCheckboxItem checked data-testid="check">
              Show grid
            </ContextMenuCheckboxItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      const item = screen.getByTestId("check");
      expect(item.getAttribute("data-slot")).toBe(
        "context-menu-checkbox-item",
      );
      expect(item.getAttribute("data-state")).toBe("checked");
    });

    it("radio group items propagate role=menuitemradio", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuRadioGroup value="b">
              <ContextMenuRadioItem value="a" data-testid="a">
                Apple
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="b" data-testid="b">
                Banana
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      expect(screen.getByTestId("a").getAttribute("role")).toBe(
        "menuitemradio",
      );
      expect(screen.getByTestId("b").getAttribute("data-state")).toBe(
        "checked",
      );
    });

    it("group + separator + label carry the right data-slot", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuGroup data-testid="group">
              <ContextMenuLabel data-testid="label">Section</ContextMenuLabel>
              <ContextMenuItem>X</ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator data-testid="sep" />
            <ContextMenuItem>Y</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      expect(screen.getByTestId("group").getAttribute("data-slot")).toBe(
        "context-menu-group",
      );
      expect(screen.getByTestId("label").getAttribute("data-slot")).toBe(
        "context-menu-label",
      );
      expect(screen.getByTestId("sep").getAttribute("data-slot")).toBe(
        "context-menu-separator",
      );
    });

    it("nested submenu mounts on hover", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuSub>
              <ContextMenuSubTrigger data-testid="subtrig">
                More
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>Inner</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      const sub = screen.getByTestId("subtrig");
      expect(sub.getAttribute("data-slot")).toBe(
        "context-menu-sub-trigger",
      );
    });
  });

  describe("shortcut presentation", () => {
    it("renders a shortcut span with data-slot=context-menu-shortcut", () => {
      renderWithProviders(
        <ContextMenu>
          <ContextMenuTrigger>T</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              Save
              <ContextMenuShortcut data-testid="sc">⌘S</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
      fireEvent.contextMenu(screen.getByText("T"));
      const sc = screen.getByTestId("sc");
      expect(sc.getAttribute("data-slot")).toBe("context-menu-shortcut");
      expect(sc.tagName).toBe("SPAN");
    });
  });
});
