// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

function Shell(props: React.PropsWithChildren<{ defaultOpen?: boolean }>) {
  return (
    <SidebarProvider defaultOpen={props.defaultOpen}>
      {props.children}
    </SidebarProvider>
  );
}

describe("Sidebar", () => {
  describe("provider + context", () => {
    it("provides state via useSidebar; the root SidebarProvider mounts data-slot=sidebar-wrapper", () => {
      function Probe() {
        const ctx = useSidebar();
        return <span data-testid="state">{ctx.state}</span>;
      }
      const { container } = renderWithProviders(
        <Shell>
          <Probe />
        </Shell>,
      );
      expect(screen.getByTestId("state").textContent).toBe("expanded");
      expect(
        container.querySelector('[data-slot="sidebar-wrapper"]'),
      ).toBeTruthy();
    });

    it("defaults to expanded; defaultOpen={false} starts collapsed", () => {
      function Probe() {
        const ctx = useSidebar();
        return <span data-testid="state">{ctx.state}</span>;
      }
      renderWithProviders(
        <Shell defaultOpen={false}>
          <Probe />
        </Shell>,
      );
      expect(screen.getByTestId("state").textContent).toBe("collapsed");
    });

    it("throws when useSidebar is called outside a SidebarProvider", () => {
      function Bad() {
        useSidebar();
        return null;
      }
      // happy-dom + RTL hides errors thrown during render unless the
      // component subtree triggers them; check by spying on console.
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => renderWithProviders(<Bad />)).toThrow(
        /useSidebar must be used within a SidebarProvider/,
      );
      errSpy.mockRestore();
    });
  });

  describe("Sidebar (desktop)", () => {
    it("renders sidebar root with data-slot=sidebar and data-state", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarContent>content</SidebarContent>
          </Sidebar>
        </Shell>,
      );
      const sidebar = container.querySelector('[data-slot="sidebar"]');
      expect(sidebar).toBeTruthy();
      expect(sidebar?.getAttribute("data-state")).toBe("expanded");
    });

    it("collapsible='none' renders as a plain flex column", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar collapsible="none">
            <SidebarContent>content</SidebarContent>
          </Sidebar>
        </Shell>,
      );
      const sidebar = container.querySelector('[data-slot="sidebar"]');
      // collapsible=none drops the data-state attribute
      expect(sidebar?.hasAttribute("data-state")).toBe(false);
      expect(sidebar?.className).toContain("flex");
    });

    it("toggleSidebar (via SidebarTrigger) flips state from expanded to collapsed", () => {
      function Probe() {
        const ctx = useSidebar();
        return <span data-testid="state">{ctx.state}</span>;
      }
      renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarHeader>
              <SidebarTrigger />
            </SidebarHeader>
          </Sidebar>
          <Probe />
        </Shell>,
      );
      expect(screen.getByTestId("state").textContent).toBe("expanded");
      const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
      fireEvent.click(trigger);
      expect(screen.getByTestId("state").textContent).toBe("collapsed");
    });
  });

  describe("composition slots", () => {
    it("Header / Footer / Content / Group carry their data-slot attributes", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarHeader>head</SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Label</SidebarGroupLabel>
                <SidebarGroupContent>content</SidebarGroupContent>
                <SidebarGroupAction>+</SidebarGroupAction>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>foot</SidebarFooter>
            <SidebarSeparator />
          </Sidebar>
        </Shell>,
      );
      expect(
        container.querySelector('[data-slot="sidebar-header"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-content"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-footer"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-group"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-group-label"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-group-content"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-group-action"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-separator"]'),
      ).toBeTruthy();
    });

    it("Menu / MenuItem / MenuButton / MenuAction / MenuBadge / MenuSub render with their data-slot", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>item</SidebarMenuButton>
                <SidebarMenuAction>...</SidebarMenuAction>
                <SidebarMenuBadge>3</SidebarMenuBadge>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton>nested</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </Sidebar>
        </Shell>,
      );
      expect(
        container.querySelector('[data-slot="sidebar-menu"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-item"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-button"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-action"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-badge"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-sub"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-sub-item"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-menu-sub-button"]'),
      ).toBeTruthy();
    });
  });

  describe("MenuButton variants", () => {
    it("isActive=true sets data-active=true", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>Active</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </Sidebar>
        </Shell>,
      );
      const btn = container.querySelector(
        '[data-slot="sidebar-menu-button"]',
      );
      expect(btn?.getAttribute("data-active")).toBe("true");
    });

    it("size='sm' sets data-size=sm", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="sm">Small</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </Sidebar>
        </Shell>,
      );
      const btn = container.querySelector(
        '[data-slot="sidebar-menu-button"]',
      );
      expect(btn?.getAttribute("data-size")).toBe("sm");
    });

    it("variant='outline' applies the outline classes", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton variant="outline">Outlined</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </Sidebar>
        </Shell>,
      );
      const btn = container.querySelector(
        '[data-slot="sidebar-menu-button"]',
      );
      expect(btn?.className).toContain("bg-surface-base");
    });
  });

  describe("MenuSkeleton", () => {
    it("renders a skeleton block; showIcon mounts an icon-shaped skeleton too", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarMenu>
              <SidebarMenuSkeleton showIcon />
            </SidebarMenu>
          </Sidebar>
        </Shell>,
      );
      const skel = container.querySelector(
        '[data-slot="sidebar-menu-skeleton"]',
      );
      expect(skel).toBeTruthy();
      expect(
        skel?.querySelector('[data-sidebar="menu-skeleton-icon"]'),
      ).toBeTruthy();
      expect(
        skel?.querySelector('[data-sidebar="menu-skeleton-text"]'),
      ).toBeTruthy();
    });
  });

  describe("controlled mode", () => {
    it("respects external open state and forwards onOpenChange", () => {
      const onOpenChange = vi.fn();
      function Harness({ open }: { open: boolean }) {
        return (
          <SidebarProvider open={open} onOpenChange={onOpenChange}>
            <Sidebar>
              <SidebarHeader>
                <SidebarTrigger />
              </SidebarHeader>
            </Sidebar>
          </SidebarProvider>
        );
      }
      const { rerender } = renderWithProviders(<Harness open={true} />);
      const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
      fireEvent.click(trigger);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      rerender(<Harness open={false} />);
      // Still works after re-render
      expect(trigger).toBeTruthy();
    });
  });

  describe("SidebarRail + SidebarInset + SidebarInput", () => {
    it("each carries the right data-slot", () => {
      const { container } = renderWithProviders(
        <Shell>
          <Sidebar>
            <SidebarHeader>
              <SidebarInput placeholder="search" data-testid="input" />
            </SidebarHeader>
            <SidebarRail />
          </Sidebar>
          <SidebarInset>main</SidebarInset>
        </Shell>,
      );
      expect(screen.getByTestId("input").getAttribute("data-slot")).toBe(
        "sidebar-input",
      );
      expect(
        container.querySelector('[data-slot="sidebar-rail"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-slot="sidebar-inset"]'),
      ).toBeTruthy();
    });
  });
});
