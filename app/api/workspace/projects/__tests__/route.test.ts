import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  createClient: vi.fn(),
  listWorkspaceProjects: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  listWorkspaceProjects: mocks.listWorkspaceProjects,
  createProject: mocks.createProject,
}));

import { GET, POST } from "../route";

const PRINCIPAL = {
  kind: "resolved" as const,
  principal: { userId: "user-1", isAnonymous: false, email: "r@example.test" },
};
const PROJECT = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Evidence review",
  goal: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastActiveAt: "2026-08-01T00:00:00.000Z",
};

describe("/api/workspace/projects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestPrincipal.mockResolvedValue(PRINCIPAL);
    mocks.createClient.mockResolvedValue({ fixture: true });
  });

  it("lists the current Researcher's private Workspace", async () => {
    mocks.listWorkspaceProjects.mockResolvedValue({
      kind: "resolved",
      value: { id: "workspace-1", projects: [PROJECT] },
    });
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspace: { id: "workspace-1", projects: [PROJECT] },
    });
    expect(mocks.listWorkspaceProjects).toHaveBeenCalledWith(
      { fixture: true },
      "user-1",
    );
  });

  it.each([
    [{ kind: "missing" }, 401, "unauthenticated"],
    [
      {
        kind: "resolved",
        principal: { userId: "anon-1", isAnonymous: true, email: null },
      },
      403,
      "forbidden",
    ],
    [{ kind: "unavailable" }, 503, "unavailable"],
  ])("classifies auth state without touching the database", async (principal, status, outcome) => {
    mocks.resolveRequestPrincipal.mockResolvedValue(principal);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ outcome });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("validates, trims, and creates Project metadata", async () => {
    mocks.createProject.mockResolvedValue({ kind: "resolved", value: PROJECT });
    const response = await POST(
      new Request("http://test/api/workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  Evidence review  ", goal: "  " }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createProject).toHaveBeenCalledWith(
      { fixture: true },
      "user-1",
      { name: "Evidence review", goal: null },
    );
  });

  it("returns field-level invalid outcomes without calling the repository", async () => {
    const response = await POST(
      new Request("http://test/api/workspace/projects", {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      outcome: "invalid",
      fieldErrors: { name: ["Enter a project name."] },
    });
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("maps repository availability failures", async () => {
    mocks.listWorkspaceProjects.mockResolvedValue({ kind: "unavailable" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ outcome: "unavailable" });
  });
});
