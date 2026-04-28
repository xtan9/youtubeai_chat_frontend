// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Radix dropdown opens on a complete pointerdown→pointerup→click
// sequence. happy-dom doesn't synthesize pointer events from click(), so
// tests fire the sequence directly. Most tests below use `defaultOpen`
// to skip the open dance entirely.
function activate(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(el, { button: 0, pointerType: "mouse" });
  fireEvent.click(el);
}

describe("DropdownMenu", () => {
  describe("rendering", () => {
    it("trigger only is in the DOM until opened", () => {
      renderWithProviders(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
      expect(screen.queryByText("Profile")).toBeNull();
    });

    it("forced-open via defaultOpen mounts content with data-slot", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger data-testid="trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem data-testid="item">Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("trigger").getAttribute("data-slot")).toBe(
        "dropdown-menu-trigger",
      );
      expect(screen.getByTestId("item").getAttribute("data-slot")).toBe(
        "dropdown-menu-item",
      );
    });
  });

  describe("interaction", () => {
    it("opens on trigger pointer activation", () => {
      renderWithProviders(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      activate(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByText("Profile")).toBeTruthy();
    });

    it("invokes onSelect on a menu item", () => {
      const onSelect = vi.fn();
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onSelect}>Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      activate(screen.getByText("Profile"));
      expect(onSelect).toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <DropdownMenu defaultOpen onOpenChange={onOpenChange}>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      fireEvent.keyDown(screen.getByText("Profile"), {
        key: "Escape",
        code: "Escape",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
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
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger>T</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Inner</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
    }

    it("opens via external state", () => {
      renderWithProviders(<Harness />);
      expect(screen.queryByText("Inner")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      expect(screen.getByText("Inner")).toBeTruthy();
    });
  });

  describe("variants", () => {
    it("destructive variant emits data-variant='destructive'", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem variant="destructive" data-testid="del">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("del").getAttribute("data-variant")).toBe(
        "destructive",
      );
    });

    it("default variant emits data-variant='default'", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem data-testid="def">Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("def").getAttribute("data-variant")).toBe(
        "default",
      );
    });

    it("inset items get data-inset", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel inset data-testid="label">
              Account
            </DropdownMenuLabel>
            <DropdownMenuItem inset data-testid="item">
              Profile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("label").getAttribute("data-inset")).toBe(
        "true",
      );
      expect(screen.getByTestId("item").getAttribute("data-inset")).toBe(
        "true",
      );
    });

    it("non-inset items omit data-inset attribute", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem data-testid="item">Profile</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      // React serializes `data-inset={undefined}` by omitting the
      // attribute entirely.
      expect(screen.getByTestId("item").getAttribute("data-inset")).toBeNull();
    });
  });

  describe("checkbox + radio items", () => {
    it("CheckboxItem reflects checked state and toggles via onCheckedChange", () => {
      const onCheckedChange = vi.fn();
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem
              checked={true}
              onCheckedChange={onCheckedChange}
              data-testid="cb"
            >
              Show toolbar
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      const cb = screen.getByTestId("cb");
      expect(cb.getAttribute("data-state")).toBe("checked");
      activate(cb);
      expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it("RadioItem within RadioGroup tracks the active value", () => {
      const onValueChange = vi.fn();
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="b" onValueChange={onValueChange}>
              <DropdownMenuRadioItem value="a" data-testid="ra">
                A
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="b" data-testid="rb">
                B
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("rb").getAttribute("data-state")).toBe(
        "checked",
      );
      expect(screen.getByTestId("ra").getAttribute("data-state")).toBe(
        "unchecked",
      );
      activate(screen.getByTestId("ra"));
      expect(onValueChange).toHaveBeenCalledWith("a");
    });
  });

  describe("composition", () => {
    it("Group + Separator + Shortcut all emit data-slot", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel data-testid="label">My Account</DropdownMenuLabel>
            <DropdownMenuSeparator data-testid="sep" />
            <DropdownMenuGroup data-testid="group">
              <DropdownMenuItem>
                Profile
                <DropdownMenuShortcut data-testid="shortcut">
                  ⌘P
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("label").getAttribute("data-slot")).toBe(
        "dropdown-menu-label",
      );
      expect(screen.getByTestId("sep").getAttribute("data-slot")).toBe(
        "dropdown-menu-separator",
      );
      expect(screen.getByTestId("group").getAttribute("data-slot")).toBe(
        "dropdown-menu-group",
      );
      expect(screen.getByTestId("shortcut").getAttribute("data-slot")).toBe(
        "dropdown-menu-shortcut",
      );
    });
  });

  describe("submenu", () => {
    it("Sub + SubTrigger render with data-slot (closed)", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="sub-trigger">
                More
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Inner</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      // SubTrigger always renders inside an open root menu; SubContent
      // is only mounted when the sub itself is open. happy-dom doesn't
      // synthesize the hover/focus that opens a Radix sub, so we pin
      // the closed contract here and exercise SubContent via forceMount
      // in the next test.
      expect(screen.getByTestId("sub-trigger").getAttribute("data-slot")).toBe(
        "dropdown-menu-sub-trigger",
      );
    });

    it("SubContent emits data-slot when rendered via forceMount", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent forceMount data-testid="sub-content">
                <DropdownMenuItem data-testid="sub-item">Inner</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      expect(screen.getByTestId("sub-content").getAttribute("data-slot")).toBe(
        "dropdown-menu-sub-content",
      );
      expect(screen.getByTestId("sub-item").getAttribute("data-slot")).toBe(
        "dropdown-menu-item",
      );
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto content + item with baseline", () => {
      renderWithProviders(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>T</DropdownMenuTrigger>
          <DropdownMenuContent
            className="my-content"
            data-testid="content"
          >
            <DropdownMenuItem className="my-item" data-testid="item">
              Profile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
      const content = screen.getByTestId("content");
      expect(content.className).toContain("my-content");
      expect(content.className).toContain("bg-surface-overlay");
      expect(content.className).toContain("rounded-md");
      const item = screen.getByTestId("item");
      expect(item.className).toContain("my-item");
      expect(item.className).toContain("rounded-sm");
    });
  });
});
