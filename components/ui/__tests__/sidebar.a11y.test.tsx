// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

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
} from "@/components/ui/sidebar";
import { axe, axePortalOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Sidebar uses Tooltip + Sheet (mobile path) under the hood. The
// desktop path is portal-free; default `axe` runner. The mobile
// Sheet path uses Radix Dialog focus guards — `axePortalOverlay`.

describe("Sidebar a11y", () => {
  it("default (collapsible='offcanvas') sidebar with menu items has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <SidebarTrigger />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <span>Dashboard</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>
                      <span>Projects</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarSeparator />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <div>Page content</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("collapsed sidebar has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SidebarProvider defaultOpen={false}>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Dashboard">
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <div>Page</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("sidebar with submenu has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <span>Tools</span>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#a">
                      <span>Tool A</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#b" isActive>
                      <span>Tool B</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <div>Page</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("sidebar with input + group action has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <label htmlFor="sb-search" className="sr-only">
              Search workspace
            </label>
            <SidebarInput id="sb-search" placeholder="Search…" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarGroupAction aria-label="Add project">+</SidebarGroupAction>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <span>Project 1</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction aria-label="Project 1 actions">
                      ⋮
                    </SidebarMenuAction>
                    <SidebarMenuBadge>3</SidebarMenuBadge>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <div>Page</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    // Tooltip provider is portaled; sidebar renders inside.
    // Use axePortalOverlay because TooltipProvider mounts a portal
    // boundary; default axe is also acceptable but conservative.
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("sidebar with skeletons (loading) has no axe violations", async () => {
    // SidebarMenuSkeleton renders a <div>, so wrap each in a
    // <SidebarMenuItem> (<li>) to keep the <ul>/<li> structure
    // axe-clean.
    const { container } = renderWithProviders(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <div role="status" aria-busy="true" aria-label="Loading workspace">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton />
                </SidebarMenuItem>
              </SidebarMenu>
            </div>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <div>Page</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("collapsible='none' sidebar (always-open variant) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <span>Item</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <div>Page</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("sidebar with rail (drag-to-resize) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <span>Item</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div>Page</div>
        </SidebarInset>
      </SidebarProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
