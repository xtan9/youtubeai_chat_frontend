// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { axe, axePortalOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Menubar a11y", () => {
  it("closed menubar (triggers only) has no axe violations", async () => {
    const { container } = renderWithProviders(
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
        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Toggle sidebar</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("opened menu with label, items, shortcuts has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Menubar defaultValue="file">
        <MenubarMenu value="file">
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarLabel>Recent</MenubarLabel>
            <MenubarSeparator />
            <MenubarItem>
              New file
              <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Open
              <MenubarShortcut>⌘O</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem variant="destructive">Delete project</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    const results = await axePortalOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("opened menu with checkbox + radio rows has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <Menubar defaultValue="view">
        <MenubarMenu value="view">
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem checked>Toolbar</MenubarCheckboxItem>
            <MenubarCheckboxItem>Status bar</MenubarCheckboxItem>
            <MenubarSeparator />
            <MenubarLabel>Density</MenubarLabel>
            <MenubarRadioGroup value="md">
              <MenubarRadioItem value="sm">Compact</MenubarRadioItem>
              <MenubarRadioItem value="md">Comfortable</MenubarRadioItem>
              <MenubarRadioItem value="lg">Spacious</MenubarRadioItem>
            </MenubarRadioGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    const results = await axePortalOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });
});
