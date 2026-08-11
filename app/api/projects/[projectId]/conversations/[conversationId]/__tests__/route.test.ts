import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
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

import { DELETE, PATCH } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const CONTEXT = {
  params: Promise.resolve({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID }),
};

describe("/api/projects/[projectId]/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false, projectAvailability: "invited" },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: { conversations: { rename: mocks.rename, clear: mocks.clear } },
    });
    mocks.rename.mockResolvedValue({ status: "renamed" });
    mocks.clear.mockResolvedValue({ status: "cleared" });
  });

  it("renames an owner-scoped conversation", async () => {
    const response = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Comparison" }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "renamed" });
    expect(mocks.rename).toHaveBeenCalledWith(CONVERSATION_ID, "Comparison");
  });

  it("clears an owner-scoped conversation", async () => {
    const response = await DELETE(new Request("http://test", { method: "DELETE" }), CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "cleared" });
    expect(mocks.clear).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("classifies missing conversations without leaking details", async () => {
    mocks.rename.mockResolvedValue({ status: "missing" });
    const response = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Comparison" }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ outcome: "missing" });
  });

  it("rejects malformed names before the mutation capability", async () => {
    const response = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: " " }),
      }),
      CONTEXT,
    );
    expect(response.status).toBe(400);
    expect(mocks.resolveProjectSubject).not.toHaveBeenCalled();
  });
});
