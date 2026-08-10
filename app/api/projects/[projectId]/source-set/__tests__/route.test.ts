import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  loadProjectSourceSet: vi.fn(),
  addHistoryVideoToProject: vi.fn(),
  reorderProjectVideos: vi.fn(),
  reconcileStaleProjectVideoProcessing: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));
vi.mock("@/lib/projects/project-source-set", () => ({
  loadProjectSourceSet: mocks.loadProjectSourceSet,
  addHistoryVideoToProject: mocks.addHistoryVideoToProject,
  reorderProjectVideos: mocks.reorderProjectVideos,
}));
vi.mock("@/lib/projects/project-video-processing", () => ({
  reconcileStaleProjectVideoProcessing:
    mocks.reconcileStaleProjectVideoProcessing,
}));

import { GET, PATCH, POST } from "../route";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_A = "10000000-0000-4000-8000-000000000001";
const VIDEO_B = "20000000-0000-4000-8000-000000000002";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const SUBJECT = {
  kind: "project",
  projectId: PROJECT_ID,
  workspaceId: "b0000000-0000-4000-8000-000000000001",
  ownerId: "owner-1",
  name: "Evidence review",
  guidance: { goal: null },
  lastActiveAt: "2026-08-08T00:00:00.000Z",
};
const SOURCE_SET = { projectId: PROJECT_ID, revision: 1, videos: [] };

describe("/api/projects/[projectId]/source-set", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "owner-1",
        isAnonymous: false,
        smokeProEntitled: false,
        businessAnalyticsSuppressed: false,
      },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "resolved", value: SUBJECT });
  });

  it("loads membership only after resolving the owned ProjectSubject", async () => {
    mocks.loadProjectSourceSet.mockResolvedValue({
      kind: "resolved",
      value: SOURCE_SET,
    });
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(200);
    expect(mocks.resolveProjectSubject).toHaveBeenCalledWith(
      { fixture: true },
      "owner-1",
      PROJECT_ID,
    );
    expect(mocks.loadProjectSourceSet).toHaveBeenCalledWith(
      { fixture: true },
      SUBJECT,
    );
    expect(mocks.reconcileStaleProjectVideoProcessing).toHaveBeenCalledWith(
      SUBJECT,
      false,
    );
  });

  it("suppresses stale-processing analytics for a marked Smoke Account without Pro entitlement", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "owner-1",
        isAnonymous: false,
        smokeProEntitled: false,
        businessAnalyticsSuppressed: true,
      },
    });
    mocks.loadProjectSourceSet.mockResolvedValue({
      kind: "resolved",
      value: SOURCE_SET,
    });

    const response = await GET(new Request("http://test"), CONTEXT);

    expect(response.status).toBe(200);
    expect(mocks.reconcileStaleProjectVideoProcessing).toHaveBeenCalledWith(
      SUBJECT,
      true,
    );
  });

  it("adds one canonical History Video with the caller's revision", async () => {
    mocks.addHistoryVideoToProject.mockResolvedValue({
      kind: "added",
      sourceSet: SOURCE_SET,
    });
    const response = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_A, expectedRevision: 0 }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(200);
    expect(mocks.addHistoryVideoToProject).toHaveBeenCalledWith(
      { fixture: true },
      SUBJECT,
      VIDEO_A,
      0,
    );
  });

  it("rejects duplicate membership safely and returns the latest Source Set", async () => {
    mocks.addHistoryVideoToProject.mockResolvedValue({
      kind: "duplicate",
      sourceSet: SOURCE_SET,
    });
    const response = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_A, expectedRevision: 1 }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      outcome: "duplicate",
      sourceSet: SOURCE_SET,
    });
  });

  it("rejects History whose canonical Transcript and Summary are not ready", async () => {
    mocks.addHistoryVideoToProject.mockResolvedValue({
      kind: "not_ready",
      sourceSet: SOURCE_SET,
    });
    const response = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_A, expectedRevision: 1 }),
      }),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "not_ready",
      sourceSet: SOURCE_SET,
      message: expect.stringMatching(/canonical Transcript and Summary/i),
    });
  });

  it("allows only one same-revision concurrent reorder to win", async () => {
    mocks.reorderProjectVideos
      .mockResolvedValueOnce({ kind: "reordered", sourceSet: { ...SOURCE_SET, revision: 2 } })
      .mockResolvedValueOnce({ kind: "conflict", sourceSet: { ...SOURCE_SET, revision: 2 } });
    const request = () =>
      PATCH(
        new Request("http://test", {
          method: "PATCH",
          body: JSON.stringify({
            videoIds: [VIDEO_B, VIDEO_A],
            expectedRevision: 1,
          }),
        }),
        CONTEXT,
      );
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await expect(responses[1].json()).resolves.toMatchObject({
      outcome: "conflict",
      sourceSet: { revision: 2 },
    });
  });

  it("does not expose another Researcher's Project membership", async () => {
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "missing" });
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(404);
    expect(mocks.loadProjectSourceSet).not.toHaveBeenCalled();
  });

  it("rejects attacker POST and PATCH without revision or membership leakage", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "attacker-2", isAnonymous: false },
    });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "missing" });

    const addResponse = await POST(
      new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_A, expectedRevision: 91 }),
      }),
      CONTEXT,
    );
    const reorderResponse = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        body: JSON.stringify({ videoIds: [VIDEO_A], expectedRevision: 91 }),
      }),
      CONTEXT,
    );

    expect(addResponse.status).toBe(404);
    expect(reorderResponse.status).toBe(404);
    for (const response of [addResponse, reorderResponse]) {
      const payload = await response.json();
      expect(payload).toEqual({ outcome: "missing", message: "Project not found." });
      expect(payload).not.toHaveProperty("revision");
      expect(payload).not.toHaveProperty("sourceSet");
    }
    expect(mocks.addHistoryVideoToProject).not.toHaveBeenCalled();
    expect(mocks.reorderProjectVideos).not.toHaveBeenCalled();
  });
});
