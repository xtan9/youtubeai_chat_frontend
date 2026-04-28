// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { axe, axeOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("NavigationMenu a11y", () => {
  it("closed navigation-menu has no axe violations", async () => {
    const { container } = renderWithProviders(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Products</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/cli">CLI</NavigationMenuLink>
              <NavigationMenuLink href="/api">API</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="/about">About</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open navigation-menu (controlled) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <NavigationMenu defaultValue="products">
        <NavigationMenuList>
          <NavigationMenuItem value="products">
            <NavigationMenuTrigger>Products</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul>
                <li>
                  <NavigationMenuLink href="/cli">CLI</NavigationMenuLink>
                </li>
                <li>
                  <NavigationMenuLink href="/api">API</NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="about">
            <NavigationMenuLink href="/about">About</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    // navigation-menu uses Radix focus guards around an open
    // viewport, same as the modal overlay primitives. The rendered
    // <nav> is itself a landmark so `region` isn't an issue, but
    // `aria-hidden-focus` on the focus guards is — use axeOverlay.
    const results = await axeOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("navigation-menu without viewport has no axe violations", async () => {
    const { container } = renderWithProviders(
      <NavigationMenu defaultValue="products" viewport={false}>
        <NavigationMenuList>
          <NavigationMenuItem value="products">
            <NavigationMenuTrigger>Products</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/cli">CLI</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    const results = await axeOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("navigation-menu with active link has no axe violations", async () => {
    const { container } = renderWithProviders(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink href="/" data-active="true">
              Home
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="/library">Library</NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="/settings">Settings</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
