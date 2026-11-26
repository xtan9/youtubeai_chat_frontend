// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
import { ProjectSettings } from "../project-settings";

describe("Project settings", () => {
  it("protects the project name in the delete confirmation portal", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectSettings
        onSaved={vi.fn()}
        project={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Private launch research",
          goal: "Private Goal",
          lastActiveAt: "2026-08-09T00:00:00.000Z",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete Project" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.classList.contains("ph-no-capture")).toBe(true);
    expect(dialog.hasAttribute("data-ph-no-autocapture")).toBe(true);
  });
});
