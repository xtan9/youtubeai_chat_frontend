import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  createClient: vi.fn(),
  openProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  openProject: mocks.openProject,
  updateProject: mocks.updateProject,
  deleteProject: mocks.deleteProject,
}));

import { DELETE, GET, PATCH } from "../route";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const PROJECT = {
  id: PROJECT_ID,
  name: "Evidence review",
  goal: "Compare explanations",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastActiveAt: "2026-08-02T00:00:00.000Z",
};

describe("/api/projects/[projectId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "user-1", isAnonymous: false, email: "r@example.test" },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
  });

  it("opens the Project through the server-owned subject boundary", async () => {
    mocks.openProject.mockResolvedValue({ kind: "resolved", value: PROJECT });
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: PROJECT });
    expect(mocks.openProject).toHaveBeenCalledWith(
      { fixture: true },
      "user-1",
      PROJECT_ID,
    );
  });

  it.each([
    [{ kind: "invalid", message: "That project link is not valid." }, 400, "invalid"],
    [{ kind: "missing" }, 404, "missing"],
    [{ kind: "forbidden" }, 403, "forbidden"],
    [{ kind: "unavailable" }, 503, "unavailable"],
  ])("returns classified GET outcome %s", async (result, status, outcome) => {
    mocks.openProject.mockResolvedValue(result);
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ outcome });
  });

  it("updates only supported Project metadata", async () => {
    mocks.updateProject.mockResolvedValue({
      kind: "resolved",
      value: { ...PROJECT, name: "Renamed", goal: null },
    });
    const response = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        body: JSON.stringify({ name: "  Renamed ", goal: " " }),
      }),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProject).toHaveBeenCalledWith(
      { fixture: true },
      "user-1",
      PROJECT_ID,
      { name: "Renamed", goal: null },
    );
  });

  it("rejects empty or ownership-bearing PATCH payloads", async () => {
    for (const body of [{}, { ownerId: "other-user" }]) {
      const response = await PATCH(
        new Request("http://test", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
        CONTEXT,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ outcome: "invalid" });
    }
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("deletes the owned Project and returns no content", async () => {
    mocks.deleteProject.mockResolvedValue({
      kind: "resolved",
      value: { id: PROJECT_ID },
    });
    const response = await DELETE(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
