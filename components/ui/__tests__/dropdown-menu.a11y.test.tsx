// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { axe, axePortalOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("DropdownMenu a11y", () => {
  it("closed menu (only trigger) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <DropdownMenu>
        <DropdownMenuTrigger>Open settings</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open menu with label + items + shortcut has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Profile
              <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Settings
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    // DropdownMenuContent portals into document.body and uses Radix
    // focus guards. The portal trips `region` (no landmark wrapper)
    // and the focus guards trip `aria-hidden-focus`. axePortalOverlay
    // suppresses both — neither applies to a single-overlay fragment
    // — and runs every other rule.
    const results = await axePortalOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("open menu with checkbox + radio items has no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>View</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked>
            Show toolbar
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Show sidebar</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="light">
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    // DropdownMenuContent portals into document.body and uses Radix
    // focus guards. The portal trips `region` (no landmark wrapper)
    // and the focus guards trip `aria-hidden-focus`. axePortalOverlay
    // suppresses both — neither applies to a single-overlay fragment
    // — and runs every other rule.
    const results = await axePortalOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });

  it("inset items (no leading icon) have no axe violations", async () => {
    const { baseElement } = renderWithProviders(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Compact</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Section</DropdownMenuLabel>
          <DropdownMenuItem inset>Item one</DropdownMenuItem>
          <DropdownMenuItem inset>Item two</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    // DropdownMenuContent portals into document.body and uses Radix
    // focus guards. The portal trips `region` (no landmark wrapper)
    // and the focus guards trip `aria-hidden-focus`. axePortalOverlay
    // suppresses both — neither applies to a single-overlay fragment
    // — and runs every other rule.
    const results = await axePortalOverlay(baseElement);
    expect(results).toHaveNoViolations();
  });
});
