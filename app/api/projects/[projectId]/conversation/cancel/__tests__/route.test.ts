import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: mocks.requireRegisteredResearcher,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));

import { POST } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "issue-318-cancel-test";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };

function request(body: unknown = { userMessageId: USER_MESSAGE_ID }) {
  return new Request("http://test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": REQUEST_ID,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/projects/[projectId]/conversation/cancel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: { groundedAnswers: { cancel: mocks.cancel } },
    });
    mocks.cancel.mockResolvedValue({ status: "cancelled" });
  });

  it("cancels only the resolved owner's reserved question", async () => {
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
    await expect(response.json()).resolves.toEqual({ outcome: "cancelled" });
    expect(mocks.resolveProjectSubject).toHaveBeenCalledWith(
      { fixture: true },
      USER_ID,
      PROJECT_ID,
    );
    expect(mocks.cancel).toHaveBeenCalledWith(USER_MESSAGE_ID);
  });

  it("rejects malformed requests before authentication or database work", async () => {
    for (const body of [
      {},
      { userMessageId: "not-a-uuid" },
      { userMessageId: USER_MESSAGE_ID, extra: true },
    ]) {
      const response = await POST(request(body), CONTEXT);
      expect(response.status).toBe(400);
      expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
      expect(response.headers.get("X-Error-ID")).toBe(
        "PROJECT_QUESTION_CANCELLATION_INVALID",
      );
    }
    expect(mocks.requireRegisteredResearcher).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("rejects blocked authentication before owner resolution", async () => {
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "error",
      response: Response.json({ outcome: "unauthenticated" }, { status: 401 }),
    });
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(401);
    expect(mocks.resolveProjectSubject).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each(["project", "question"])(
    "keeps a missing %s private",
    async (missing) => {
      if (missing === "project") {
        mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "missing" });
      } else {
        mocks.cancel.mockResolvedValueOnce({ status: "missing" });
      }
      const response = await POST(request(), CONTEXT);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ outcome: "missing" });
    },
  );

  it.each(["client", "capability", "rpc"])(
    "fails closed with trace headers when the %s is unavailable",
    async (failure) => {
      if (failure === "client") {
        mocks.createClient.mockRejectedValueOnce(new Error("offline"));
      } else if (failure === "capability") {
        mocks.resolveProjectSubject.mockResolvedValueOnce({
          kind: "resolved",
          value: {},
        });
      } else {
        mocks.cancel.mockResolvedValueOnce({ status: "unavailable" });
      }
      const response = await POST(request(), CONTEXT);
      expect(response.status).toBe(503);
      expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
      expect(response.headers.get("X-Error-ID")).toBe("PROJECTS_UNAVAILABLE");
    },
  );
});
