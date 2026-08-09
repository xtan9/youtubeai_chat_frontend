import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  removeVideoFromProject: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));
vi.mock("@/lib/projects/project-source-set", () => ({
  removeVideoFromProject: mocks.removeVideoFromProject,
}));

import { DELETE } from "../route";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_ID = "10000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID, videoId: VIDEO_ID }) };
const SUBJECT = { kind: "project", projectId: PROJECT_ID, ownerId: "owner-1" };

describe("DELETE /api/projects/[projectId]/source-set/[videoId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "owner-1", isAnonymous: false },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "resolved", value: SUBJECT });
  });

  it("removes the canonical membership at the expected revision", async () => {
    mocks.removeVideoFromProject.mockResolvedValue({
      kind: "removed",
      sourceSet: { projectId: PROJECT_ID, revision: 3, videos: [] },
    });
    const response = await DELETE(
      new Request(`http://test/api?revision=2`, { method: "DELETE" }),
      CONTEXT,
    );
    expect(response.status).toBe(200);
    expect(mocks.removeVideoFromProject).toHaveBeenCalledWith(
      { fixture: true },
      SUBJECT,
      VIDEO_ID,
      2,
    );
  });

  it("rejects a missing revision before touching authentication or data", async () => {
    const response = await DELETE(
      new Request("http://test/api", { method: "DELETE" }),
      CONTEXT,
    );
    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
  });

  it("rejects an attacker DELETE without revision or membership leakage", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "attacker-2", isAnonymous: false },
    });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "missing" });

    const response = await DELETE(
      new Request("http://test/api?revision=91", { method: "DELETE" }),
      CONTEXT,
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload).toEqual({ outcome: "missing", message: "Project not found." });
    expect(payload).not.toHaveProperty("revision");
    expect(payload).not.toHaveProperty("sourceSet");
    expect(mocks.removeVideoFromProject).not.toHaveBeenCalled();
  });
});
