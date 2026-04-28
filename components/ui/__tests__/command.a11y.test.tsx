// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

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
import {
  axe,
  axeCommand,
  axeCommandDialog,
} from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Command a11y", () => {
  it("standard inline command (search + groups + items) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Command label="Command palette">
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Files">
            <CommandItem>
              New file
              <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
            <CommandItem>
              Open file
              <CommandShortcut>⌘O</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Edit">
            <CommandItem>Cut</CommandItem>
            <CommandItem>Copy</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    // cmdk renders the separator with `role="separator"` directly
    // inside `role="listbox"`, which axe's `aria-required-children`
    // rule (correctly) flags. cmdk doesn't expose a way to override
    // the role; treat this as a known cmdk-pattern suppression. See
    // `tests-utils/axe.ts` for the scope.
    const results = await axeCommand(container);
    expect(results).toHaveNoViolations();
  });

  it("command without separators has no axe violations under default rules", async () => {
    const { container } = renderWithProviders(
      <Command label="Search">
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Files">
            <CommandItem>fixture.json</CommandItem>
            <CommandItem>schema.sql</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("command with disabled items has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Command label="Actions">
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandGroup heading="Actions">
            <CommandItem>Available</CommandItem>
            <CommandItem disabled>Coming soon</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("CommandDialog (open) has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <CommandDialog open>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem>
              Calendar
              <CommandShortcut>⌘C</CommandShortcut>
            </CommandItem>
            <CommandItem>Search emoji</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>,
    );
    // CommandDialog wraps cmdk in a Radix Dialog: focus guards trip
    // `aria-hidden-focus`, no separator here so the cmdk-specific
    // suppression isn't needed (but axeCommandDialog covers both).
    const results = await axeCommandDialog(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("CommandDialog with custom title + description has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <CommandDialog
        open
        title="Quick switcher"
        description="Find a file or run a command"
      >
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandGroup heading="Files">
            <CommandItem>fixture.json</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>,
    );
    const results = await axeCommandDialog(baseElement);
    expect(results).toHaveNoViolations();
  });
});
