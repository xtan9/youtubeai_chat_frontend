// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFreeProjectLimitResponse } from "@/lib/projects/project-limit-response";
import { axe } from "@/tests-utils/axe";
import { WorkspaceView } from "../workspace-view";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  useEntitlements: vi.fn(),
}));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: mocks.capture,
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: mocks.useEntitlements,
}));

const PROJECT = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Evidence review",
  goal: "Compare explanations",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastActiveAt: "2026-08-02T00:00:00.000Z",
};

function entitlements(tier: "free" | "pro" | undefined) {
  mocks.useEntitlements.mockReturnValue({
    data: tier
      ? {
          tier,
          caps: {
            summariesUsed: 0,
            summariesLimit: tier === "pro" ? -1 : 10,
            projectsUsed: tier === "pro" ? 3 : 1,
            projectsLimit: tier === "pro" ? -1 : 1,
          },
        }
      : undefined,
  });
}

beforeEach(() => {
  mocks.capture.mockReset();
  mocks.useEntitlements.mockReset();
  entitlements(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Workspace Project entitlement presentation", () => {
  it("shows the Free allowance and governed upgrade action accessibly", async () => {
    entitlements("free");
    const { container } = render(
      <WorkspaceView
        initialWorkspace={{ id: "workspace-1", projects: [PROJECT] }}
      />,
    );

    const privacyBoundary = container.querySelector(
      ".ph-no-capture[data-ph-no-autocapture]",
    );
    expect(privacyBoundary?.classList.contains("ph-no-capture")).toBe(true);
    expect(privacyBoundary?.hasAttribute("data-ph-no-autocapture")).toBe(true);
    expect(screen.queryByRole("button", { name: "Create Project" })).toBeNull();
    expect(screen.getByText("1 of 1 Free Project used")).not.toBeNull();
    const upgrade = screen.getByRole("link", {
      name: "Upgrade to Pro",
    });
    expect(upgrade.getAttribute("href")).toBe(
      "/pricing?source_surface=project_limit",
    );
    expect(
      screen.getByText(/delete your current Project to free this Project slot/i),
    ).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await waitFor(() =>
      expect(mocks.capture).toHaveBeenCalledWith("project_limit_reached", {
        source_surface: "workspace_header",
        tier: "free",
        projects_used: 1,
        projects_limit: 1,
      }),
    );
    fireEvent.click(upgrade);
    expect(mocks.capture).toHaveBeenCalledWith("project_limit_cta_clicked", {
      source_surface: "workspace_header",
      tier: "free",
      projects_used: 1,
      projects_limit: 1,
      cta: "upgrade_to_pro",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      "subscription_discovery_clicked",
      expect.objectContaining({
        source_surface: "project_limit",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
      }),
    );
  });

  it("keeps Pro creation unlimited within technical and abuse limits", () => {
    entitlements("pro");
    render(
      <WorkspaceView
        initialWorkspace={{ id: "workspace-1", projects: [PROJECT] }}
      />,
    );

    expect(screen.getByRole("button", { name: "Create Project" })).not.toBeNull();
    expect(
      screen.getByText(/unlimited Projects within technical and abuse limits/i),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: /upgrade/i })).toBeNull();
  });

  it("blocks Project-private Create dialog content in its Radix portal", () => {
    entitlements("pro");
    render(
      <WorkspaceView
        initialWorkspace={{ id: "workspace-1", projects: [PROJECT] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("ph-no-capture")).toBe(true);
    expect(dialog.hasAttribute("data-ph-no-autocapture")).toBe(true);
  });

  it("fails soft when entitlement presentation is unavailable", () => {
    entitlements(undefined);
    render(
      <WorkspaceView
        initialWorkspace={{ id: "workspace-1", projects: [PROJECT] }}
      />,
    );

    expect(screen.getByRole("button", { name: "Create Project" })).not.toBeNull();
    expect(screen.queryByText(/Free Project used/i)).toBeNull();
  });

  it("presents a 402 upgrade without sending Project names or Goals to analytics", async () => {
    entitlements(undefined);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      Response.json(
        createFreeProjectLimitResponse(1),
        { status: 402 },
      ),
    );
    render(
      <WorkspaceView
        initialWorkspace={{ id: "workspace-1", projects: [PROJECT] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Sensitive research" },
    });
    fireEvent.change(screen.getByLabelText("Project Goal (optional)"), {
      target: { value: "Private goal" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Create Project" }).at(-1)!);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Free includes 1 Project.",
    );
    expect(screen.getByText("Free Project limit reached")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Upgrade to Pro" }),
    ).not.toBeNull();
    expect(mocks.capture).toHaveBeenCalledWith("project_limit_reached", {
      source_surface: "workspace_create_dialog",
      tier: "free",
      projects_used: 1,
      projects_limit: 1,
    });
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain(
      "Sensitive research",
    );
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("Private goal");
  });
});
