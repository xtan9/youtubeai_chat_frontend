import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  load: vi.fn(),
  loadEvents: vi.fn(),
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
      principal: { userId: USER_ID, isAnonymous: false, projectAvailability: "invited" },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: {
        groundedAnswers: {
          load: mocks.load,
          loadEvents: mocks.loadEvents,
        },
        conversations: {
          create: mocks.create,
          rename: mocks.rename,
          clear: mocks.clear,
        },
      },
    });
    mocks.load.mockResolvedValue({ status: "ready", conversation: CONVERSATION });
    mocks.loadEvents.mockResolvedValue({
      status: "ready",
      events: [],
      nextCursor: null,
    });
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
    expect(mocks.load).toHaveBeenCalledWith(undefined, null);
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
      null,
    );
  });

  it("passes a strict cursor within the selected conversation", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-08-09T00:00:00.000Z",
        userMessageId: "40000000-0000-4000-8000-000000000001",
      }),
      "utf8",
    ).toString("base64url");
    const response = await GET(
      new Request(
        `http://test?conversationId=30000000-0000-4000-8000-000000000001&cursor=${cursor}`,
      ),
      CONTEXT,
    );
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(
      "30000000-0000-4000-8000-000000000001",
      {
        createdAt: "2026-08-09T00:00:00.000Z",
        userMessageId: "40000000-0000-4000-8000-000000000001",
      },
    );
  });

  it("loads a strict Source Set activity cursor without scanning messages", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-08-09T00:00:00.000Z",
        eventId: "40000000-0000-4000-8000-000000000001",
      }),
      "utf8",
    ).toString("base64url");
    const response = await GET(
      new Request(`http://test?eventCursor=${cursor}`),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.loadEvents).toHaveBeenCalledWith({
      createdAt: "2026-08-09T00:00:00.000Z",
      eventId: "40000000-0000-4000-8000-000000000001",
    });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each([
    ["conversationId=selected", "Conversation identity is not valid."],
    ["cursor=", "Conversation cursor is not valid."],
    ["cursor=eyJjcmVhdGVkQXQiOiJ5ZXN0ZXJkYXkifQ", "Conversation cursor is not valid."],
    ["eventCursor=", "Source Set activity cursor is not valid."],
    ["eventCursor=eyJjcmVhdGVkQXQiOiJ5ZXN0ZXJkYXkifQ", "Source Set activity cursor is not valid."],
  ])("rejects malformed semantic query input: %s", async (query, message) => {
    const response = await GET(new Request(`http://test?${query}`), CONTEXT);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ message });
    expect(mocks.load).not.toHaveBeenCalled();
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
