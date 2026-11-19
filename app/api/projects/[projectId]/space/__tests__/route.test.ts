import { beforeEach, expect, it, vi } from "vitest";
import { emptySpace } from "@/lib/video-space/contract";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  subject: vi.fn(),
  from: vi.fn(),
  write: vi.fn(),
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
}));
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
