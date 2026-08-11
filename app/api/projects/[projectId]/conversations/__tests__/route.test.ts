import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: mocks.requireRegisteredResearcher,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));

import { GET, POST } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const SUMMARY = {
  conversationId: CONVERSATION_ID,
  name: "Launch questions",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:01:00.000Z",
  messageCount: 2,
};

describe("/api/projects/[projectId]/conversations", () => {
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
        conversations: { list: mocks.list, create: mocks.create },
      },
    });
    mocks.list.mockResolvedValue({
      status: "ready",
      conversations: [SUMMARY],
      messagesUsed: 4,
      messagesLimit: 5,
      tier: "free",
    });
    mocks.create.mockResolvedValue({ status: "created", conversation: SUMMARY });
  });

  it("lists named threads with the Project-wide quota", async () => {
    const response = await GET(new Request("http://test"), CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversations: [SUMMARY],
      messagesUsed: 4,
      messagesLimit: 5,
      tier: "free",
    });
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("creates a thread without changing the quota contract", async () => {
    const response = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Comparison" }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ conversation: SUMMARY });
    expect(mocks.create).toHaveBeenCalledWith("Comparison");
  });

  it("does not resolve ownership for malformed input", async () => {
    const response = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: " " }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(400);
    expect(mocks.resolveProjectSubject).not.toHaveBeenCalled();
  });
});
