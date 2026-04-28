// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Same pointer-activation pattern as DropdownMenu — see that test for
// the rationale.
function activate(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(el, { button: 0, pointerType: "mouse" });
  fireEvent.click(el);
}

describe("Menubar", () => {
  describe("rendering", () => {
    it("renders a menubar with triggers but no open content initially", () => {
      renderWithProviders(
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Edit</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>Undo</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByRole("menuitem", { name: "File" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
      expect(screen.queryByText("New")).toBeNull();
      expect(screen.queryByText("Undo")).toBeNull();
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <Menubar data-testid="root">
          <MenubarMenu>
            <MenubarTrigger data-testid="trigger">File</MenubarTrigger>
            <MenubarContent>
              <MenubarLabel data-testid="label">Recent</MenubarLabel>
              <MenubarSeparator data-testid="sep" />
              <MenubarGroup data-testid="group">
                <MenubarItem data-testid="item">
                  Open
                  <MenubarShortcut data-testid="shortcut">⌘O</MenubarShortcut>
                </MenubarItem>
              </MenubarGroup>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByTestId("root").getAttribute("data-slot")).toBe(
        "menubar",
      );
      expect(screen.getByTestId("trigger").getAttribute("data-slot")).toBe(
        "menubar-trigger",
      );
    });
  });

  describe("interaction", () => {
    it("opens a menu on trigger pointer activation", () => {
      renderWithProviders(
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      activate(screen.getByRole("menuitem", { name: "File" }));
      expect(screen.getByText("New")).toBeTruthy();
    });

    it("calls onValueChange when a menu opens (controlled menubar)", () => {
      const onValueChange = vi.fn();
      renderWithProviders(
        <Menubar value="" onValueChange={onValueChange}>
          <MenubarMenu value="file">
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      activate(screen.getByRole("menuitem", { name: "File" }));
      expect(onValueChange).toHaveBeenCalledWith("file");
    });

    it("invokes onSelect on a menu item", () => {
      const onSelect = vi.fn();
      renderWithProviders(
        <Menubar defaultValue="file">
          <MenubarMenu value="file">
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={onSelect}>New</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      activate(screen.getByText("New"));
      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe("variants", () => {
    it("destructive variant + inset emit data-attrs", () => {
      renderWithProviders(
        <Menubar defaultValue="file">
          <MenubarMenu value="file">
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                variant="destructive"
                inset
                data-testid="del"
              >
                Delete
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      const del = screen.getByTestId("del");
      expect(del.getAttribute("data-variant")).toBe("destructive");
      expect(del.getAttribute("data-inset")).toBe("true");
    });
  });

  describe("checkbox + radio items", () => {
    it("CheckboxItem reflects checked state", () => {
      renderWithProviders(
        <Menubar defaultValue="view">
          <MenubarMenu value="view">
            <MenubarTrigger>View</MenubarTrigger>
            <MenubarContent>
              <MenubarCheckboxItem checked data-testid="cb">
                Toolbar
              </MenubarCheckboxItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByTestId("cb").getAttribute("data-state")).toBe(
        "checked",
      );
    });

    it("RadioItem within RadioGroup tracks the active value", () => {
      renderWithProviders(
        <Menubar defaultValue="view">
          <MenubarMenu value="view">
            <MenubarTrigger>View</MenubarTrigger>
            <MenubarContent>
              <MenubarRadioGroup value="md">
                <MenubarRadioItem value="sm" data-testid="sm">
                  Small
                </MenubarRadioItem>
                <MenubarRadioItem value="md" data-testid="md">
                  Medium
                </MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByTestId("md").getAttribute("data-state")).toBe(
        "checked",
      );
      expect(screen.getByTestId("sm").getAttribute("data-state")).toBe(
        "unchecked",
      );
    });
  });

  describe("submenu", () => {
    it("Sub + SubTrigger render with data-slot", () => {
      renderWithProviders(
        <Menubar defaultValue="file">
          <MenubarMenu value="file">
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarSub>
                <MenubarSubTrigger data-testid="sub-trigger">
                  Open recent
                </MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem>fixture.json</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByTestId("sub-trigger").getAttribute("data-slot")).toBe(
        "menubar-sub-trigger",
      );
    });

    it("SubContent emits data-slot when forceMounted", () => {
      renderWithProviders(
        <Menubar defaultValue="file">
          <MenubarMenu value="file">
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarSub>
                <MenubarSubTrigger>More</MenubarSubTrigger>
                <MenubarSubContent forceMount data-testid="sub-content">
                  <MenubarItem>Item</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByTestId("sub-content").getAttribute("data-slot")).toBe(
        "menubar-sub-content",
      );
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto root + content + item", () => {
      renderWithProviders(
        <Menubar
          className="my-bar"
          data-testid="root"
          defaultValue="file"
        >
          <MenubarMenu value="file">
            <MenubarTrigger className="my-trig" data-testid="trig">
              File
            </MenubarTrigger>
            <MenubarContent
              className="my-content"
              data-testid="content"
            >
              <MenubarItem className="my-item" data-testid="item">
                Open
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>,
      );
      expect(screen.getByTestId("root").className).toContain("my-bar");
      expect(screen.getByTestId("root").className).toContain("rounded-md");
      expect(screen.getByTestId("trig").className).toContain("my-trig");
      expect(screen.getByTestId("content").className).toContain("my-content");
      expect(screen.getByTestId("item").className).toContain("my-item");
    });
  });
});
