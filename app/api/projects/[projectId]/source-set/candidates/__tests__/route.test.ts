import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  loadProjectHistoryCandidates: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));
vi.mock("@/lib/projects/project-source-set", () => ({
  loadProjectHistoryCandidates: mocks.loadProjectHistoryCandidates,
}));

import { GET } from "../route";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const SUBJECT = {
  kind: "project",
  projectId: PROJECT_ID,
  workspaceId: "b0000000-0000-4000-8000-000000000001",
  ownerId: "owner-1",
};

describe("GET /api/projects/[projectId]/source-set/candidates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "owner-1", isAnonymous: false, projectAvailability: "invited" },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "resolved", value: SUBJECT });
  });

  it("returns one server-filtered page of processed History Videos", async () => {
    const candidatePage = {
      page: 3,
      pageSize: 10,
      total: 27,
      totalPages: 3,
      search: "evidence",
      candidates: [],
    };
    mocks.loadProjectHistoryCandidates.mockResolvedValue({
      kind: "resolved",
      value: candidatePage,
    });

    const response = await GET(
      new Request("http://test/api?search=%20evidence%20&page=3"),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.loadProjectHistoryCandidates).toHaveBeenCalledWith(
      { fixture: true },
      SUBJECT,
      { page: 3, pageSize: 10, search: "evidence" },
    );
    await expect(response.json()).resolves.toEqual({ candidatePage });
  });

  it("does not expose another Researcher's processed History candidates", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "attacker-2", isAnonymous: false, projectAvailability: "invited" },
    });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "missing" });

    const response = await GET(new Request("http://test/api?page=1"), CONTEXT);

    expect(response.status).toBe(404);
    expect(mocks.loadProjectHistoryCandidates).not.toHaveBeenCalled();
  });

  it("rejects invalid pagination before touching authentication or data", async () => {
    const response = await GET(new Request("http://test/api?page=-1"), CONTEXT);

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
  });
});
