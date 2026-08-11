import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));

import { POST } from "../route";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const COVERAGE = {
  totalVideos: 1,
  readyVideos: 1,
  unavailableVideos: [],
  passagesExamined: 2,
};
const SUBJECT = {
  kind: "project",
  projectId: PROJECT_ID,
  workspaceId: "b0000000-0000-4000-8000-000000000001",
  ownerId: "owner-1",
  name: "Evidence",
  guidance: { goal: null },
  lastActiveAt: "2026-08-09T00:00:00.000Z",
  passageSearch: { search: mocks.search },
};

function searchRequest(query: string) {
  return new Request("http://test/api/projects/x/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

describe("POST /api/projects/[projectId]/search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "owner-1", isAnonymous: false, projectAvailability: "invited" },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: SUBJECT,
    });
  });

  it("uses only the owned ProjectSubject capability and does not meter Search", async () => {
    mocks.search.mockResolvedValue({
      status: "no_results",
      sourceSetRevision: 3,
      coverage: COVERAGE,
      passages: [],
    });

    const request = searchRequest("  renewable energy  ");
    const response = await POST(request, CONTEXT);

    expect(response.status).toBe(200);
    expect(new URL(request.url).search).toBe("");
    expect(request.method).toBe("POST");
    expect(mocks.resolveProjectSubject).toHaveBeenCalledWith(
      { fixture: true },
      "owner-1",
      PROJECT_ID,
    );
    expect(mocks.search).toHaveBeenCalledWith({
      query: "renewable energy",
      limit: 8,
    });
    await expect(response.json()).resolves.toEqual({
      search: {
        status: "no_results",
        sourceSetRevision: 3,
        coverage: COVERAGE,
        passages: [],
      },
    });
  });

  it("returns partial unavailable coverage with no results", async () => {
    const coverage = {
      totalVideos: 2,
      readyVideos: 1,
      unavailableVideos: [
        {
          videoId: "c0000000-0000-4000-8000-000000000002",
          youtubeVideoId: "bbbbbbb0002",
          title: "Processing",
          channelName: null,
          status: "processing",
          failureCode: null,
        },
      ],
      passagesExamined: 2,
    };
    mocks.search.mockResolvedValue({
      status: "no_results",
      sourceSetRevision: 4,
      coverage,
      passages: [],
    });

    const response = await POST(searchRequest("unmatched"), CONTEXT);
    await expect(response.json()).resolves.toEqual({
      search: expect.objectContaining({ status: "no_results", coverage }),
    });
  });

  it("validates input before authentication or database work", async () => {
    const response = await POST(searchRequest("x"), CONTEXT);
    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("validates strict JSON bodies with code-point-aware query bounds", async () => {
    mocks.search.mockResolvedValue({
      status: "no_results",
      sourceSetRevision: 3,
      coverage: COVERAGE,
      passages: [],
    });
    const validAstralQuery = "\u{1F30D}".repeat(200);
    const validResponse = await POST(searchRequest(validAstralQuery), CONTEXT);
    expect(validResponse.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith({
      query: validAstralQuery,
      limit: 8,
    });

    vi.clearAllMocks();
    const overLimitResponse = await POST(
      searchRequest("\u{1F30D}".repeat(201)),
      CONTEXT,
    );
    expect(overLimitResponse.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();

    const extraFieldResponse = await POST(
      new Request("http://test/api/projects/x/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "evidence", passage: "private" }),
      }),
      CONTEXT,
    );
    expect(extraFieldResponse.status).toBe(400);
  });

  it.each([
    ["missing session", { kind: "missing" }, 401],
    [
      "anonymous session",
      {
        kind: "resolved",
        principal: { userId: "anon-1", isAnonymous: true },
      },
      403,
    ],
  ])("rejects a %s before Project resolution", async (_name, principal, status) => {
    mocks.resolveRequestPrincipal.mockResolvedValue(principal);
    const response = await POST(searchRequest("evidence"), CONTEXT);
    expect(response.status).toBe(status);
    expect(mocks.resolveProjectSubject).not.toHaveBeenCalled();
  });

  it("keeps foreign and nonexistent Project responses identical", async () => {
    const envelopes: unknown[] = [];
    for (const projectId of [
      PROJECT_ID,
      "d0000000-0000-4000-8000-000000000009",
    ]) {
      mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "missing" });
      const response = await POST(searchRequest("evidence"), {
        params: Promise.resolve({ projectId }),
      });
      expect(response.status).toBe(404);
      envelopes.push(await response.json());
    }
    expect(envelopes[0]).toEqual(envelopes[1]);
    expect(envelopes[0]).toEqual({
      outcome: "missing",
      message: "Project not found.",
    });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("fails closed when the subject does not expose Search or the adapter is unavailable", async () => {
    mocks.resolveProjectSubject.mockResolvedValueOnce({
      kind: "resolved",
      value: { ...SUBJECT, passageSearch: undefined },
    });
    const missingCapability = await POST(searchRequest("evidence"), CONTEXT);
    expect(missingCapability.status).toBe(503);

    mocks.resolveProjectSubject.mockResolvedValueOnce({
      kind: "resolved",
      value: SUBJECT,
    });
    mocks.search.mockResolvedValueOnce({ status: "unavailable" });
    const unavailable = await POST(searchRequest("evidence"), CONTEXT);
    expect(unavailable.status).toBe(503);
  });
});
