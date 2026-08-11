import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  getServiceRoleClient: vi.fn(),
  recordContinueLearningFeedback: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/services/continue-learning-reader", () => ({
  recordContinueLearningFeedback: mocks.recordContinueLearningFeedback,
}));

const TOKEN = `cl1.${"a".repeat(43)}`;
const PRINCIPAL = {
  userId: "10000000-0000-4000-8000-000000000001",
  isAnonymous: false,
  email: "learner@example.com",
  businessAnalyticsSuppressed: false,
};

function request(body: unknown = { token: TOKEN, judgment: "useful" }) {
  return new Request("http://localhost/api/continue-learning/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/continue-learning/feedback", () => {
  beforeEach(() => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "false");
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: PRINCIPAL,
    });
    mocks.getServiceRoleClient.mockReturnValue({});
    mocks.recordContinueLearningFeedback.mockResolvedValue({
      outcome: "recorded",
      judgment: "useful",
      ordinal: 1,
    });
  });

  it("keeps the dormant feedback seam disabled by default", async () => {
    const { POST } = await import("../route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "unavailable",
      reason: "feature_disabled",
    });
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("records a learner-bound judgment without returning internal IDs", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    const { POST } = await import("../route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "recorded",
      judgment: "useful",
      ordinal: 1,
    });
    expect(mocks.recordContinueLearningFeedback).toHaveBeenCalledWith(
      expect.anything(),
      {
        learnerId: PRINCIPAL.userId,
        token: TOKEN,
        judgment: "useful",
      },
    );
  });

  it.each([
    [{ token: "not-a-token", judgment: "useful" }],
    [{ token: TOKEN, judgment: "maybe" }],
    [{ token: TOKEN, judgment: "useful", reason: "free-form" }],
  ])("rejects malformed or undocumented feedback before authentication", async (body) => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    const { POST } = await import("../route");

    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.recordContinueLearningFeedback).not.toHaveBeenCalled();
  });

  it("requires a registered authenticated learner", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { ...PRINCIPAL, isAnonymous: true },
    });
    const { POST } = await import("../route");

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.recordContinueLearningFeedback).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: "missing" }, 404],
    [{ outcome: "recorded", judgment: "not_useful", ordinal: 1 }, 200],
  ])("maps durable feedback outcomes without exposing identity", async (data, status) => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.recordContinueLearningFeedback.mockResolvedValue(data);
    const { POST } = await import("../route");

    const response = await POST(request());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(data);
    expect(JSON.stringify(data)).not.toContain(PRINCIPAL.userId);
  });

  it("fails soft when the private feedback ledger is unavailable", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.recordContinueLearningFeedback.mockResolvedValue(null);
    const { POST } = await import("../route");

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ outcome: "unavailable" });
  });
});
