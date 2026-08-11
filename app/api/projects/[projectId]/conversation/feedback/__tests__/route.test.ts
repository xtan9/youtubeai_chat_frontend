import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { afterCallbacks, mocks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  mocks: {
    after: vi.fn(),
    resolveRequestPrincipal: vi.fn(),
    createClient: vi.fn(),
    resolveProjectSubject: vi.fn(),
    captureProjectActivityEvent: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});
vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));
vi.mock("@/lib/analytics/server", () => ({
  captureProjectActivityEvent: mocks.captureProjectActivityEvent,
}));

import { POST } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const ANSWER_ID = "50000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const PRINCIPAL = {
  userId: "20000000-0000-4000-8000-000000000001",
  isAnonymous: false,
  email: "owner@example.com",
  businessAnalyticsSuppressed: false,
  projectAvailability: "invited" as const,
};
const SUBJECT = {
  kind: "project" as const,
  projectId: PROJECT_ID,
  workspaceId: "30000000-0000-4000-8000-000000000001",
  ownerId: PRINCIPAL.userId,
  name: "Evidence review",
  guidance: { goal: null },
  lastActiveAt: "2026-08-10T00:00:00.000Z",
};

function request(body: unknown = { answerId: ANSWER_ID, rating: "helpful" }) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/projects/[projectId]/conversation/feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    afterCallbacks.length = 0;
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      afterCallbacks.push(callback);
    });
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: PRINCIPAL,
    });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: SUBJECT,
    });
    mocks.captureProjectActivityEvent.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({
      data: { outcome: "recorded", rating: "helpful", messageOrdinal: 3 },
      error: null,
    });
  });

  it("records one immutable Project-global rating and captures it server-side", async () => {
    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "recorded",
      rating: "helpful",
      messageOrdinal: 3,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("record_project_answer_feedback", {
      p_project_id: PROJECT_ID,
      p_answer_id: ANSWER_ID,
      p_rating: "helpful",
    });
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(mocks.captureProjectActivityEvent).toHaveBeenCalledWith(
      PRINCIPAL.userId,
      "project_answer_feedback_submitted",
      {
        project_id: PROJECT_ID,
        answer_id: ANSWER_ID,
        message_ordinal: 3,
        rating: "helpful",
      },
      false,
      `project-answer-feedback:${ANSWER_ID}`,
    );
  });

  it("returns a repeated decision without producing duplicate analytics", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "deduplicated", rating: "helpful", messageOrdinal: 3 },
      error: null,
    });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "deduplicated",
      rating: "helpful",
    });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("preserves the first durable decision when a later rating conflicts", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "conflict", rating: "helpful", messageOrdinal: 3 },
      error: null,
    });

    const response = await POST(
      request({ answerId: ANSWER_ID, rating: "not_helpful" }),
      CONTEXT,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "conflict",
      rating: "helpful",
      messageOrdinal: 3,
    });
    expect(afterCallbacks).toHaveLength(0);
  });

  it.each([
    [{ answerId: "not-a-uuid", rating: "helpful" }, 400],
    [{ answerId: ANSWER_ID, rating: "maybe" }, 400],
  ])("rejects malformed input before authentication", async (body, status) => {
    const response = await POST(request(body), CONTEXT);

    expect(response.status).toBe(status);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the existing authentication envelope", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: "invalid" }, 400],
    [{ outcome: "missing" }, 404],
  ])("maps durable RPC outcomes to stable HTTP envelopes", async (data, status) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject(data);
    expect(afterCallbacks).toHaveLength(0);
  });

  it.each([
    [{ data: null, error: { code: "XX000" } }],
    [{ data: { outcome: "unexpected" }, error: null }],
  ])("fails soft when durable feedback is unavailable", async (rpcResult) => {
    mocks.rpc.mockResolvedValue(rpcResult);

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ outcome: "unavailable" });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("passes Smoke suppression through the trusted server boundary", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { ...PRINCIPAL, businessAnalyticsSuppressed: true },
    });

    await POST(request(), CONTEXT);
    await afterCallbacks[0]();

    expect(mocks.captureProjectActivityEvent).toHaveBeenCalledWith(
      PRINCIPAL.userId,
      "project_answer_feedback_submitted",
      expect.any(Object),
      true,
      `project-answer-feedback:${ANSWER_ID}`,
    );
  });
});
