import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  createClient: vi.fn(),
  openProject: vi.fn(),
  scheduleAnalytics: vi.fn(),
  captureProjectActivity: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics/after", () => ({
  scheduleAnalyticsAfterResponse: mocks.scheduleAnalytics,
}));
vi.mock("@/lib/analytics/server", () => ({
  captureProjectActivityEvent: mocks.captureProjectActivity,
}));
vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.principal,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/projects/project-subject", () => ({
  openProject: mocks.openProject,
}));
vi.mock("../workbench", () => ({ Workbench: () => null }));
import ProjectPage from "../page";
import { Workbench } from "../workbench";

describe("canonical project page", () => {
  const params = Promise.resolve({ projectId: PROJECT_ID });
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.principal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "owner" },
    });
    mocks.openProject.mockResolvedValue({
      kind: "resolved",
      value: { id: PROJECT_ID, name: "Research" },
    });
  });
  it.each([{}, { view: "investigations" }, { conversationId: "saved-thread" }])(
    "opens the same workbench for saved links",
    async (search) => {
      const page = (await ProjectPage({
        params,
        searchParams: Promise.resolve(search),
      })) as ReactElement;
      expect(page.type).toBe(Workbench);
      expect(mocks.openProject).toHaveBeenCalledOnce();
      expect(mocks.scheduleAnalytics).toHaveBeenCalledOnce();
    },
  );
  it("preserves a signed-out reader’s destination", async () => {
    mocks.principal.mockResolvedValue({ kind: "missing" });
    const path = "/workspace/projects/" + PROJECT_ID + "?claim=selected";
    await expect(
      ProjectPage({
        params,
        searchParams: Promise.resolve({ claim: "selected" }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(encodeURIComponent(path)),
    });
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
});
