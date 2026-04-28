// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Drawer", () => {
  describe("uncontrolled toggle", () => {
    it("is closed initially and opens on trigger click", () => {
      renderWithProviders(
        <Drawer>
          <DrawerTrigger>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerTitle>Title</DrawerTitle>
            <DrawerDescription>Description</DrawerDescription>
          </DrawerContent>
        </Drawer>,
      );
      expect(screen.queryByText("Title")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByText("Title")).toBeTruthy();
      expect(screen.getByText("Description")).toBeTruthy();
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
          <Drawer
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              onChange?.(next);
            }}
          >
            <DrawerContent>
              <DrawerTitle>Controlled</DrawerTitle>
              <DrawerClose>Programmatic close</DrawerClose>
            </DrawerContent>
          </Drawer>
        </>
      );
    }

    it("opens via external state and emits onOpenChange(false) when DrawerClose is clicked", () => {
      const onChange = vi.fn();
      renderWithProviders(<Harness onChange={onChange} />);
      expect(screen.queryByText("Controlled")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "external" }));
      expect(screen.getByText("Controlled")).toBeTruthy();

      // vaul's close animation is non-deterministic in happy-dom (the
      // content stays mounted until the spring finishes). Verify the
      // contract via the onOpenChange callback rather than DOM teardown.
      fireEvent.click(
        screen.getByRole("button", { name: "Programmatic close" }),
      );
      expect(onChange).toHaveBeenCalledWith(false);
    });

    it("calls onOpenChange when trigger toggles", () => {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <Drawer open={false} onOpenChange={onOpenChange}>
          <DrawerTrigger>Toggle</DrawerTrigger>
          <DrawerContent>
            <DrawerTitle>T</DrawerTitle>
          </DrawerContent>
        </Drawer>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe("data-slot wiring", () => {
    it("emits data-slot on every part when open", () => {
      renderWithProviders(
        <Drawer defaultOpen>
          <DrawerContent>
            <DrawerHeader data-testid="header">
              <DrawerTitle data-testid="title">T</DrawerTitle>
              <DrawerDescription data-testid="desc">D</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter data-testid="footer">
              <DrawerClose data-testid="close">x</DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>,
      );
      expect(screen.getByTestId("header").getAttribute("data-slot")).toBe(
        "drawer-header",
      );
      expect(screen.getByTestId("title").getAttribute("data-slot")).toBe(
        "drawer-title",
      );
      expect(screen.getByTestId("desc").getAttribute("data-slot")).toBe(
        "drawer-description",
      );
      expect(screen.getByTestId("footer").getAttribute("data-slot")).toBe(
        "drawer-footer",
      );
      expect(screen.getByTestId("close").getAttribute("data-slot")).toBe(
        "drawer-close",
      );
    });
  });

  describe("direction prop", () => {
    it.each(["top", "bottom", "left", "right"] as const)(
      "renders direction=%s and applies the side-aware data attribute",
      (direction) => {
        renderWithProviders(
          <Drawer defaultOpen direction={direction}>
            <DrawerContent data-testid={`content-${direction}`}>
              <DrawerTitle>T</DrawerTitle>
            </DrawerContent>
          </Drawer>,
        );
        const content = screen.getByTestId(`content-${direction}`);
        // vaul applies its data attribute on the content element.
        expect(content.getAttribute("data-vaul-drawer-direction")).toBe(
          direction,
        );
      },
    );
  });

  describe("classNames", () => {
    it("merges consumer className with baseline classes on content", () => {
      renderWithProviders(
        <Drawer defaultOpen>
          <DrawerContent className="my-drawer" data-testid="content">
            <DrawerTitle>T</DrawerTitle>
          </DrawerContent>
        </Drawer>,
      );
      const cls = screen.getByTestId("content").className;
      expect(cls).toContain("my-drawer");
      expect(cls).toContain("bg-background");
      expect(cls).toContain("fixed");
    });
  });
});
