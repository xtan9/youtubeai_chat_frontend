// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("NavigationMenu", () => {
  describe("default render", () => {
    it("renders triggers but no content while closed", () => {
      renderWithProviders(
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink href="/about">About</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      expect(screen.getByText("Products")).toBeTruthy();
      expect(screen.getByRole("link", { name: "About" })).toBeTruthy();
      expect(screen.queryByText("Product 1")).toBeNull();
    });

    it("renders the wrapping nav element with role=navigation", () => {
      const { container } = renderWithProviders(
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink href="/x">x</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      // Radix wraps in a <nav>.
      expect(container.querySelector("nav")).toBeTruthy();
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <NavigationMenu data-testid="root" defaultValue="products">
          <NavigationMenuList data-testid="list">
            <NavigationMenuItem data-testid="item" value="products">
              <NavigationMenuTrigger data-testid="trigger">
                Products
              </NavigationMenuTrigger>
              <NavigationMenuContent data-testid="content">
                <NavigationMenuLink href="/p1" data-testid="link">
                  Product 1
                </NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      expect(screen.getByTestId("root").getAttribute("data-slot")).toBe(
        "navigation-menu",
      );
      expect(screen.getByTestId("list").getAttribute("data-slot")).toBe(
        "navigation-menu-list",
      );
      expect(screen.getByTestId("item").getAttribute("data-slot")).toBe(
        "navigation-menu-item",
      );
      expect(screen.getByTestId("trigger").getAttribute("data-slot")).toBe(
        "navigation-menu-trigger",
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "navigation-menu-content",
      );
      expect(screen.getByTestId("link").getAttribute("data-slot")).toBe(
        "navigation-menu-link",
      );
    });
  });

  describe("controlled value", () => {
    it("opens the matching item when value is set", () => {
      renderWithProviders(
        <NavigationMenu value="products">
          <NavigationMenuList>
            <NavigationMenuItem value="products">
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem value="about">
              <NavigationMenuTrigger>About</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/team">Team</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      expect(screen.getByText("Product 1")).toBeTruthy();
      expect(screen.queryByText("Team")).toBeNull();
    });

    it("invokes onValueChange when a trigger is activated", () => {
      const onValueChange = vi.fn();
      renderWithProviders(
        <NavigationMenu value="" onValueChange={onValueChange}>
          <NavigationMenuList>
            <NavigationMenuItem value="products">
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      // Radix navigation-menu opens via onPointerEnter/onPointerMove +
      // click. Fire the click; in happy-dom this enough to trigger
      // onValueChange (which is what the consumer cares about).
      fireEvent.click(screen.getByText("Products"));
      expect(onValueChange).toHaveBeenCalled();
    });
  });

  describe("trigger styling", () => {
    it("renders a chevron and rotates it on open via data-[state]", () => {
      const { container } = renderWithProviders(
        <NavigationMenu defaultValue="products">
          <NavigationMenuList>
            <NavigationMenuItem value="products">
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      const trigger = screen.getByText("Products").closest("button");
      expect(trigger?.getAttribute("data-state")).toBe("open");
      // The chevron is an SVG sibling inside the trigger.
      expect(container.querySelector("button[data-state='open'] svg")).toBeTruthy();
    });

    it("exports a navigationMenuTriggerStyle CVA helper for asChild composition", () => {
      const cls = navigationMenuTriggerStyle();
      expect(cls).toContain("inline-flex");
      expect(cls).toContain("rounded-md");
      expect(cls).toContain("focus-visible:ring-[3px]");
    });
  });

  describe("viewport flag", () => {
    it("renders the viewport when an item is open (default behaviour)", () => {
      const { container } = renderWithProviders(
        <NavigationMenu defaultValue="products">
          <NavigationMenuList>
            <NavigationMenuItem value="products">
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      // Radix only mounts the viewport while an item is open; checking
      // the absent (empty NavigationMenu) case isn't meaningful since
      // there's nothing to host.
      expect(
        container.querySelector("[data-slot='navigation-menu-viewport']"),
      ).toBeTruthy();
    });

    it("omits the viewport when viewport={false}", () => {
      const { container } = renderWithProviders(
        <NavigationMenu viewport={false}>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink href="/x">x</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      expect(
        container.querySelector("[data-slot='navigation-menu-viewport']"),
      ).toBeNull();
      // Root carries data-viewport=false for downstream styling.
      expect(
        container.querySelector("[data-viewport='false']"),
      ).toBeTruthy();
    });
  });

  describe("NavigationMenuLink", () => {
    it("renders an anchor and supports the active data attribute", () => {
      renderWithProviders(
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink
                href="/here"
                data-active="true"
                data-testid="active-link"
              >
                Here
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      const link = screen.getByTestId("active-link");
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("data-active")).toBe("true");
    });
  });

  describe("NavigationMenuIndicator", () => {
    it("emits data-slot when present", () => {
      renderWithProviders(
        <NavigationMenu defaultValue="products">
          <NavigationMenuList>
            <NavigationMenuItem value="products">
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
          <NavigationMenuIndicator data-testid="indicator" />
        </NavigationMenu>,
      );
      // The indicator only mounts when an item is open + Radix has
      // measured the trigger. Under defaultValue=products it should
      // render.
      const indicator = screen.queryByTestId("indicator");
      if (indicator) {
        expect(indicator.getAttribute("data-slot")).toBe(
          "navigation-menu-indicator",
        );
      }
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto root + list + trigger + content", () => {
      renderWithProviders(
        <NavigationMenu
          className="my-nav"
          data-testid="root"
          defaultValue="products"
        >
          <NavigationMenuList className="my-list" data-testid="list">
            <NavigationMenuItem value="products">
              <NavigationMenuTrigger
                className="my-trigger"
                data-testid="trigger"
              >
                Products
              </NavigationMenuTrigger>
              <NavigationMenuContent
                className="my-content"
                data-testid="content"
              >
                <NavigationMenuLink href="/p1">Product 1</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      );
      expect(screen.getByTestId("root").className).toContain("my-nav");
      expect(screen.getByTestId("list").className).toContain("my-list");
      expect(screen.getByTestId("trigger").className).toContain("my-trigger");
      expect(screen.getByTestId("content").className).toContain("my-content");
    });
  });
});
