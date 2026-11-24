import { beforeEach, expect, it, vi } from "vitest";
import { emptySpace } from "@/lib/video-space/contract";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  subject: vi.fn(),
  from: vi.fn(),
  write: vi.fn(),
  starter: vi.fn(),
  versions: vi.fn(),
  rate: vi.fn(),
  sourceSet: vi.fn(),
  video: vi.fn(),
}));
vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: m.auth,
}));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: m.subject,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ from: m.from }),
}));
vi.mock("@/lib/video-space/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video-space/assistant")>()),
  writeScript: m.write,
  createStarter: m.starter,
}));
vi.mock("@/lib/projects/project-research-journal", () => ({ loadResearchVersions: m.versions }));
vi.mock("@/lib/projects/project-source-set", () => ({
  loadProjectSourceSet: m.sourceSet,
}));
vi.mock("@/lib/video-space/video-material", () => ({ readVideo: m.video }));
vi.mock("@/lib/services/rate-limit", () => ({ checkRateLimit: m.rate }));
import { GET, POST, PUT } from "../route";
const id = "10000000-0000-4000-8000-000000000001",
  context = { params: Promise.resolve({ projectId: id }) };
const req = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    kind: "resolved",
    principal: { userId: "owner" },
  });
  m.subject.mockResolvedValue({
    kind: "resolved",
    value: { projectId: id, ownerId: "owner" },
  });
  m.rate.mockResolvedValue({ allowed: true });
});
it("returns the same missing outcome for a foreign project across reads, edits and AI calls", async () => {
  m.subject.mockResolvedValue({ kind: "missing" });
  for (const handler of [GET, PUT, POST])
    expect((await handler(req({}), context)).status).toBe(404);
  expect(m.from).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
});
it("rejects a stale save when the original project revision is gone", async () => {
  const query = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  m.from.mockReturnValue(query);
  expect(
    (await PUT(req({ revision: 2, document: emptySpace() }), context)).status,
  ).toBe(409);
  expect(query.eq.mock.calls).toEqual([
    ["project_id", id],
    ["revision", 2],
  ]);
});
it("only serves transcripts belonging to the selected project", async () => {
  m.sourceSet.mockResolvedValue({ kind: "resolved", value: { videos: [] } });
  expect(
    (await POST(req({ action: "video", videoId: id }), context)).status,
  ).toBe(404);
  expect(m.video).not.toHaveBeenCalled();
});
it("guards writing before contacting a model", async () => {
  m.rate.mockResolvedValue({ allowed: false });
  expect(
    (
      await POST(
        req({
          action: "write",
          script: "",
          history: [],
          prompt: "Can we discuss this?",
        }),
        context,
      )
    ).status,
  ).toBe(429);
  expect(m.write).not.toHaveBeenCalled();
});
it("gives legacy claims stable links across reordering and distinguishes identical material in different sources", async () => {
  const claims = ["First interpretation", "Second interpretation"].map(
    (text) => ({
      text,
      quote: "The same source passage",
      location: "00:05",
    }),
  );
  const resources = ["first", "second"].map((id) => ({
    id,
    kind: "video",
    title: "Video",
    coverage: "",
    pages: [],
    digest: { summary: "", claims: [...claims] },
  }));
  m.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: async () => ({
      data: { revision: 1, document: { ...emptySpace(), resources } },
    }),
  });
  const read = async () =>
    (await (await GET(req({}), context)).json()).document.resources;
  const initial = await read();
  const ids = initial[0].digest.claims.map((claim: { id: string }) => claim.id);
  expect(new Set(ids).size).toBe(2);
  expect(ids[0]).not.toBe(initial[1].digest.claims[0].id);
  resources[0].digest.claims.reverse();
  expect(
    (await read())[0].digest.claims.map((claim: { id: string }) => claim.id),
  ).toEqual(ids.reverse());
});

it("generates only from the current saved brief after an explicit confirmation", async () => {
  const space = emptySpace();
  const turnId = crypto.randomUUID();
  space.messages.push(
    { role: "user", text: "A video about reading oil labels.", interviewId: id },
    { role: "assistant", text: "Which part of the label?", interviewId: id },
    { role: "user", text: "Compare the plant names, without health claims.", interviewId: id },
  );
  space.interview = { id, turnId, pending: true, notes: "", format: "video" };
  m.from.mockReturnValue({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: async () => ({ data: { document: space } }),
  });
  const confirm = { action: "starter", locale: "en", turnId, confirmBrief: true };
  expect((await POST(req({ action: "starter", format: "video", answer: "YouTube", locale: "en" }), context)).status).toBe(400);
  expect((await POST(req(confirm), context)).status).toBe(409);
  space.interview.pending = false;
  space.interview.brief = "Explain plant names for novice cooks.";
  expect((await POST(req({ ...confirm, confirmBrief: false }), context)).status).toBe(400);
  expect((await POST(req({ ...confirm, turnId: crypto.randomUUID() }), context)).status).toBe(409);
  expect(m.starter).not.toHaveBeenCalled();
  m.versions.mockResolvedValue([]);
  m.starter.mockResolvedValue({ title: "Reading an oil label" });
  expect((await POST(req({ ...confirm, brief: "An unrelated client-supplied brief" }), context)).status).toBe(200);
  expect(m.starter).toHaveBeenCalledWith(
    expect.objectContaining({ format: "video", turns: expect.arrayContaining([
      { role: "user", text: "Compare the plant names, without health claims." },
    ]) }), space.interview.brief, "en", expect.anything(),
  );
});
