import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  subject: vi.fn(),
  load: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  retrieve: vi.fn(),
  research: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: m.auth,
}));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: m.subject,
}));
vi.mock("@/lib/projects/project-research-journal", () => ({
  loadResearchVersions: m.load,
  reserveResearch: m.reserve,
  completeResearch: m.complete,
  failResearch: m.fail,
}));
vi.mock("@/lib/projects/project-passage-search", () => ({
  createProjectResearchPassageSearchCapability: vi.fn(),
}));
vi.mock("@/lib/projects/project-research-retrieval", () => ({
  retrieveProjectResearchEvidence: m.retrieve,
}));
vi.mock("@/lib/projects/project-research-engine", () => ({
  runProjectResearch: m.research,
}));
vi.mock("@/lib/services/rate-limit", () => ({ checkRateLimit: m.rate }));
import { GET, POST } from "../route";
const projectId = "10000000-0000-4000-8000-000000000001",
  ownerId = "20000000-0000-4000-8000-000000000001",
  runId = "30000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ projectId }) };
const request = (
  body: unknown = {
    question: "种子油对健康的影响有哪些证据？",
    baseVersionId: null,
  },
) =>
  new Request("https://app.test/api/projects/" + projectId + "/research", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    kind: "resolved",
    principal: { userId: ownerId },
  });
  m.client.mockResolvedValue({});
  m.subject.mockResolvedValue({
    kind: "resolved",
    value: { projectId, name: "Seed oils", guidance: { goal: null } },
  });
  m.load.mockResolvedValue([]);
  m.reserve.mockResolvedValue({ outcome: "started", id: runId });
  m.complete.mockResolvedValue({
    outcome: "completed",
    version: { id: runId, document: {} },
  });
  m.fail.mockResolvedValue(undefined);
  m.retrieve.mockResolvedValue({
    status: "not_ready",
    sourceSetRevision: 1,
    coverage: {
      totalVideos: 0,
      readyVideos: 0,
      unavailableVideos: [],
      passagesExamined: 0,
    },
    passages: [],
  });
  m.research.mockResolvedValue({ question: "test", sourceSetRevision: 1 });
  m.rate.mockResolvedValue({ allowed: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
describe("Project research route", () => {
  it("loads private versions through the authenticated project boundary", async () => {
    expect((await GET(new Request("https://app.test"), context)).status).toBe(
      200,
    );
    expect(m.load).toHaveBeenCalledWith({}, projectId);
  });
  it("does not access data or providers before sign-in", async () => {
    m.auth.mockResolvedValue({
      kind: "error",
      response: new Response(null, { status: 401 }),
    });
    expect((await POST(request(), context)).status).toBe(401);
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.research).not.toHaveBeenCalled();
  });
  it("cannot write to another owner's project", async () => {
    m.subject.mockResolvedValue({ kind: "missing" });
    expect((await POST(request(), context)).status).toBe(404);
    expect(m.reserve).not.toHaveBeenCalled();
  });
  it("publishes only after research succeeds and returns the durable publication receipt", async () => {
    expect((await POST(request(), context)).status).toBe(201);
    expect(m.complete).toHaveBeenCalledWith(runId, ownerId, expect.any(Object));
    expect(m.load).toHaveBeenCalledOnce();
    expect(m.fail).not.toHaveBeenCalled();
  });
  it("releases failed work without replacing the previous judgment or leaking upstream messages", async () => {
    m.research.mockRejectedValue(new Error("private provider body"));
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private provider body",
    );
    expect(m.fail).toHaveBeenCalledWith(projectId, runId);
    expect(m.complete).not.toHaveBeenCalled();
  });
  it("rejects stale base versions before starting paid work", async () => {
    m.load.mockResolvedValue([{ id: runId, document: {} }]);
    expect((await POST(request(), context)).status).toBe(409);
    expect(m.reserve).not.toHaveBeenCalled();
  });
  it.each([
    ["limit_reached", 402],
    ["busy", 409],
  ] as const)("stops before provider calls on %s", async (outcome, status) => {
    m.reserve.mockResolvedValue({ outcome });
    expect((await POST(request(), context)).status).toBe(status);
    expect(m.research).not.toHaveBeenCalled();
  });
  it("rejects changed project sources at publication and releases its lease", async () => {
    m.complete.mockResolvedValue({ outcome: "conflict" });
    expect((await POST(request(), context)).status).toBe(409);
    expect(m.fail).toHaveBeenCalledOnce();
  });
  it("blocks malformed and oversized research questions", async () => {
    expect(
      (
        await POST(
          request({ question: "x".repeat(2001), baseVersionId: null }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(m.reserve).not.toHaveBeenCalled();
  });
});
