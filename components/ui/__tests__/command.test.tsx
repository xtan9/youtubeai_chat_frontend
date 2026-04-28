// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Command", () => {
  describe("default render", () => {
    it("renders items as listbox options with the first selected", () => {
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandGroup heading="Actions">
              <CommandItem>New file</CommandItem>
              <CommandItem>Open file</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>,
      );
      const items = screen.getAllByRole("option");
      expect(items).toHaveLength(2);
      // cmdk auto-selects the first non-disabled item.
      expect(items[0].getAttribute("data-selected")).toBe("true");
      expect(items[1].getAttribute("data-selected")).toBe("false");
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <Command data-testid="root">
          <CommandInput placeholder="Search" data-testid="input" />
          <CommandList data-testid="list">
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup heading="Actions" data-testid="group">
              <CommandItem data-testid="item">
                Open
                <CommandShortcut data-testid="shortcut">⌘O</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator data-testid="sep" />
          </CommandList>
        </Command>,
      );
      expect(screen.getByTestId("root").getAttribute("data-slot")).toBe(
        "command",
      );
      expect(screen.getByTestId("input").getAttribute("data-slot")).toBe(
        "command-input",
      );
      // Input is wrapped in a sibling div for icon spacing.
      const wrapper = screen.getByTestId("input").parentElement;
      expect(wrapper?.getAttribute("data-slot")).toBe("command-input-wrapper");
      expect(screen.getByTestId("list").getAttribute("data-slot")).toBe(
        "command-list",
      );
      expect(screen.getByTestId("group").getAttribute("data-slot")).toBe(
        "command-group",
      );
      expect(screen.getByTestId("item").getAttribute("data-slot")).toBe(
        "command-item",
      );
      expect(screen.getByTestId("shortcut").getAttribute("data-slot")).toBe(
        "command-shortcut",
      );
      expect(screen.getByTestId("sep").getAttribute("data-slot")).toBe(
        "command-separator",
      );
    });
  });

  describe("filtering", () => {
    it("typing in the input filters items", () => {
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandGroup heading="Actions">
              <CommandItem>New file</CommandItem>
              <CommandItem>Open file</CommandItem>
              <CommandItem>Delete file</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>,
      );
      const input = screen.getByPlaceholderText("Search");
      fireEvent.change(input, { target: { value: "open" } });
      expect(screen.queryByText("New file")).toBeNull();
      expect(screen.queryByText("Delete file")).toBeNull();
      expect(screen.getByText("Open file")).toBeTruthy();
    });

    it("CommandEmpty shows when nothing matches", () => {
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandEmpty>No results found</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem>New file</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>,
      );
      // Empty state isn't shown until a query runs.
      expect(screen.queryByText("No results found")).toBeNull();
      const input = screen.getByPlaceholderText("Search");
      fireEvent.change(input, { target: { value: "zzz" } });
      expect(screen.getByText("No results found")).toBeTruthy();
    });
  });

  describe("keyboard navigation", () => {
    it("ArrowDown moves selection to the next item", () => {
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandItem>A</CommandItem>
            <CommandItem>B</CommandItem>
            <CommandItem>C</CommandItem>
          </CommandList>
        </Command>,
      );
      const input = screen.getByPlaceholderText("Search");
      const items = screen.getAllByRole("option");
      expect(items[0].getAttribute("data-selected")).toBe("true");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(items[1].getAttribute("data-selected")).toBe("true");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(items[2].getAttribute("data-selected")).toBe("true");
    });

    it("ArrowUp moves selection to the previous item", () => {
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandItem>A</CommandItem>
            <CommandItem>B</CommandItem>
          </CommandList>
        </Command>,
      );
      const input = screen.getByPlaceholderText("Search");
      const items = screen.getAllByRole("option");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(items[1].getAttribute("data-selected")).toBe("true");
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(items[0].getAttribute("data-selected")).toBe("true");
    });

    it("Enter activates the selected item", () => {
      const onSelectA = vi.fn();
      const onSelectB = vi.fn();
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandItem onSelect={onSelectA}>A</CommandItem>
            <CommandItem onSelect={onSelectB}>B</CommandItem>
          </CommandList>
        </Command>,
      );
      const input = screen.getByPlaceholderText("Search");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelectA).not.toHaveBeenCalled();
      expect(onSelectB).toHaveBeenCalled();
    });
  });

  describe("controlled value", () => {
    function Harness() {
      const [value, setValue] = useState("a");
      return (
        <>
          <button type="button" onClick={() => setValue("b")}>
            external-b
          </button>
          <Command value={value} onValueChange={setValue}>
            <CommandInput placeholder="Search" />
            <CommandList>
              <CommandItem value="a">A</CommandItem>
              <CommandItem value="b">B</CommandItem>
            </CommandList>
          </Command>
        </>
      );
    }

    it("respects external value updates", () => {
      renderWithProviders(<Harness />);
      const items = screen.getAllByRole("option");
      expect(items[0].getAttribute("data-selected")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "external-b" }));
      expect(items[1].getAttribute("data-selected")).toBe("true");
    });
  });

  describe("disabled item", () => {
    it("disabled items get data-disabled and skip arrow-key selection", () => {
      renderWithProviders(
        <Command>
          <CommandInput placeholder="Search" />
          <CommandList>
            <CommandItem>A</CommandItem>
            <CommandItem disabled>B</CommandItem>
            <CommandItem>C</CommandItem>
          </CommandList>
        </Command>,
      );
      const items = screen.getAllByRole("option");
      expect(items[1].getAttribute("data-disabled")).toBe("true");
      const input = screen.getByPlaceholderText("Search");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      // Skips the disabled middle item, lands on C.
      expect(items[0].getAttribute("data-selected")).toBe("false");
      expect(items[2].getAttribute("data-selected")).toBe("true");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto root + list + item", () => {
      renderWithProviders(
        <Command className="my-cmd" data-testid="root">
          <CommandList className="my-list" data-testid="list">
            <CommandItem className="my-item" data-testid="item">
              A
            </CommandItem>
          </CommandList>
        </Command>,
      );
      expect(screen.getByTestId("root").className).toContain("my-cmd");
      expect(screen.getByTestId("root").className).toContain("bg-popover");
      expect(screen.getByTestId("list").className).toContain("my-list");
      expect(screen.getByTestId("list").className).toContain("max-h-[300px]");
      expect(screen.getByTestId("item").className).toContain("my-item");
    });
  });
});

describe("CommandDialog", () => {
  it("does not render content when closed", () => {
    renderWithProviders(
      <CommandDialog>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandItem>Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.queryByText("Item")).toBeNull();
  });

  it("renders content when open + auto-injects DialogTitle for a11y", () => {
    renderWithProviders(
      <CommandDialog open>
        <CommandInput placeholder="Search commands" />
        <CommandList>
          <CommandItem>Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Item")).toBeTruthy();
    // Auto-injected sr-only DialogTitle uses the default "Command Palette".
    expect(screen.getByText("Command Palette")).toBeTruthy();
  });

  it("respects custom title + description", () => {
    renderWithProviders(
      <CommandDialog
        open
        title="Quick switcher"
        description="Find a file or command"
      >
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandItem>Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.getByText("Quick switcher")).toBeTruthy();
    expect(screen.getByText("Find a file or command")).toBeTruthy();
  });

  it("hides the close button when showCloseButton=false", () => {
    renderWithProviders(
      <CommandDialog open showCloseButton={false}>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandItem>Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("invokes onOpenChange via Escape", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CommandDialog open onOpenChange={onOpenChange}>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandItem>Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
