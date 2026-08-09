import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  load: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: mocks.requireRegisteredResearcher,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));

import { DELETE, GET, PATCH, POST } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const CONVERSATION = {
  conversationId: null,
  messages: [],
  messagesUsed: 0,
  messagesLimit: 5 as const,
  tier: "free" as const,
};

describe("GET /api/projects/[projectId]/conversation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: {
        groundedAnswers: { load: mocks.load },
        conversations: {
          create: mocks.create,
          rename: mocks.rename,
          clear: mocks.clear,
        },
      },
    });
    mocks.load.mockResolvedValue({ status: "ready", conversation: CONVERSATION });
    mocks.create.mockResolvedValue({
      status: "created",
      conversation: {
        conversationId: "30000000-0000-4000-8000-000000000001",
        name: "Comparison",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
        messageCount: 0,
      },
    });
    mocks.rename.mockResolvedValue({ status: "renamed" });
    mocks.clear.mockResolvedValue({ status: "cleared" });
  });

  it("loads only the authenticated owner's canonical default conversation", async () => {
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversation: CONVERSATION });
    expect(mocks.resolveProjectSubject).toHaveBeenCalledWith(
      { fixture: true },
      USER_ID,
      PROJECT_ID,
    );
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it("rejects blocked authentication before owner resolution", async () => {
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "error",
      response: Response.json({ outcome: "unauthenticated" }, { status: 401 }),
    });
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(401);
    expect(mocks.resolveProjectSubject).not.toHaveBeenCalled();
  });

  it("loads the selected conversation through the compatibility GET seam", async () => {
    const response = await GET(
      new Request(
        `http://test?conversationId=30000000-0000-4000-8000-000000000001`,
      ),
      CONTEXT,
    );
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(
      "30000000-0000-4000-8000-000000000001",
    );
  });

  it("keeps compatibility mutations classified and owner-scoped", async () => {
    const created = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Comparison" }),
      }),
      CONTEXT,
    );
    expect(created.status).toBe(201);

    const renamed = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "30000000-0000-4000-8000-000000000001",
          name: "Launch questions",
        }),
      }),
      CONTEXT,
    );
    expect(renamed.status).toBe(200);
    expect(mocks.rename).toHaveBeenCalledWith(
      "30000000-0000-4000-8000-000000000001",
      "Launch questions",
    );

    const cleared = await DELETE(
      new Request("http://test", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "30000000-0000-4000-8000-000000000001",
        }),
      }),
      CONTEXT,
    );
    expect(cleared.status).toBe(200);
    expect(mocks.clear).toHaveBeenCalledWith(
      "30000000-0000-4000-8000-000000000001",
    );
  });

  it("keeps foreign and nonexistent Project responses identical", async () => {
    const bodies = [];
    for (const projectId of [PROJECT_ID, "10000000-0000-4000-8000-000000000009"]) {
      mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "missing" });
      const response = await GET(new Request("http://test"), {
        params: Promise.resolve({ projectId }),
      });
      expect(response.status).toBe(404);
      bodies.push(await response.json());
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each([
    ["missing capability", undefined],
    ["load unavailable", { load: mocks.load }],
  ])("fails closed for %s", async (_name, groundedAnswers) => {
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: { groundedAnswers },
    });
    mocks.load.mockResolvedValue({ status: "unavailable" });
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(503);
  });
});
