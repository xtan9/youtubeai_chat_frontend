import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  getServiceRoleClient: vi.fn(),
  readContinueLearningRecommendations: vi.fn(),
  registerContinueLearningTokenBindings: vi.fn(),
  recordContinueLearningReadyReads: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/services/continue-learning-reader", () => ({
  readContinueLearningRecommendations:
    mocks.readContinueLearningRecommendations,
  registerContinueLearningTokenBindings:
    mocks.registerContinueLearningTokenBindings,
  recordContinueLearningReadyReads: mocks.recordContinueLearningReadyReads,
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const PRINCIPAL = {
  userId: "10000000-0000-4000-8000-000000000001",
  isAnonymous: false,
  email: "learner@example.com",
  businessAnalyticsSuppressed: false,
};
const ITEM = {
  setId: "20000000-0000-4000-8000-000000000002",
  ordinal: 1,
  candidateVideoId: "30000000-0000-4000-8000-000000000003",
  canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
  title: "Next lesson",
  channelName: "Teaching Channel",
  thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
  relationship: "deeper_explanation" as const,
  explanation: "Builds on the source concept.",
};

function request(path = "") {
  return new Request(`http://localhost/api/continue-learning${path}`);
}

describe("GET /api/continue-learning", () => {
  beforeEach(() => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "false");
    vi.stubEnv(
      "CONTINUE_LEARNING_TOKEN_SECRET",
      "continue-learning-test-secret-32-chars-min",
    );
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: PRINCIPAL,
    });
    mocks.getServiceRoleClient.mockReturnValue({ rpc: vi.fn() });
    mocks.registerContinueLearningTokenBindings.mockResolvedValue(undefined);
    mocks.recordContinueLearningReadyReads.mockResolvedValue(undefined);
  });

  it("keeps the dormant seam disabled by default", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      request(`?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "unavailable",
      reason: "feature_disabled",
    });
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("requires a non-anonymous authenticated learner", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { ...PRINCIPAL, isAnonymous: true },
    });
    const { GET } = await import("../route");

    const response = await GET(
      request(`?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(response.status).toBe(401);
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects malformed source URLs before touching private services", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    const { GET } = await import("../route");

    const response = await GET(request("?youtube_url=https%3A%2F%2Fexample.com"));
    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
  });

  it("does not expose items when rollout quality is not effective", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.readContinueLearningRecommendations.mockResolvedValue({
      outcome: "unavailable",
      reason: "rollout_off",
      effectiveState: "off",
    });
    const { GET } = await import("../route");

    const response = await GET(
      request(`?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "unavailable",
      reason: "rollout_off",
    });
    expect(mocks.recordContinueLearningReadyReads).not.toHaveBeenCalled();
  });

  it("returns an opaque pending state without exposing preparation internals", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.readContinueLearningRecommendations.mockResolvedValue({
      outcome: "pending",
    });
    const { GET } = await import("../route");

    const response = await GET(
      request(`?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "pending" });
  });

  it("keeps pilot unavailable without a cohort contract", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.readContinueLearningRecommendations.mockResolvedValue({
      outcome: "unavailable",
      reason: "pilot_cohort_unconfigured",
      effectiveState: "pilot",
    });
    const { GET } = await import("../route");

    const response = await GET(
      request(`?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(await response.json()).toEqual({
      outcome: "unavailable",
      reason: "pilot_cohort_unconfigured",
    });
  });

  it("returns display fields plus opaque learner-bound tokens when on", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.readContinueLearningRecommendations.mockResolvedValue({
      outcome: "ready",
      effectiveState: "on",
      items: [ITEM],
    });
    const { GET } = await import("../route");

    const response = await GET(
      request(`?youtube_url=${encodeURIComponent(VALID_URL)}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("ready");
    expect(body.setVersionToken).toMatch(/^cl1s\.[A-Za-z0-9_-]{43}$/);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      ordinal: 1,
      canonicalUrl: ITEM.canonicalUrl,
      title: ITEM.title,
      channelName: ITEM.channelName,
      thumbnailUrl: ITEM.thumbnailUrl,
      relationship: ITEM.relationship,
      explanation: ITEM.explanation,
    });
    expect(body.items[0].token).toMatch(/^cl1\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(body)).not.toContain(ITEM.setId);
    expect(JSON.stringify(body)).not.toContain(ITEM.candidateVideoId);
    expect(mocks.recordContinueLearningReadyReads).toHaveBeenCalledWith(
      expect.anything(),
      [ITEM],
    );
    expect(mocks.registerContinueLearningTokenBindings).toHaveBeenCalledWith(
      expect.anything(),
      PRINCIPAL.userId,
      [
        {
          token: body.items[0].token,
          setId: ITEM.setId,
          ordinal: ITEM.ordinal,
        },
      ],
    );
    expect(mocks.readContinueLearningRecommendations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 4 }),
    );
  });

  it("keeps concurrent learners on separate token bindings", async () => {
    vi.stubEnv("CONTINUE_LEARNING_READER_ENABLED", "true");
    mocks.resolveRequestPrincipal
      .mockResolvedValueOnce({
        kind: "resolved",
        principal: PRINCIPAL,
      })
      .mockResolvedValueOnce({
        kind: "resolved",
        principal: { ...PRINCIPAL, userId: "10000000-0000-4000-8000-000000000009" },
      });
    mocks.readContinueLearningRecommendations.mockResolvedValue({
      outcome: "ready",
      effectiveState: "on",
      items: [ITEM],
    });
    const { GET } = await import("../route");

    const [first, second] = await Promise.all([
      GET(request(`?youtube_url=${encodeURIComponent(VALID_URL)}`)),
      GET(request(`?youtube_url=${encodeURIComponent(VALID_URL)}`)),
    ]);
    const firstToken = (await first.json()).items[0].token;
    const secondToken = (await second.json()).items[0].token;

    expect(firstToken).not.toBe(secondToken);
    expect(mocks.readContinueLearningRecommendations).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ learnerId: PRINCIPAL.userId }),
    );
    expect(mocks.readContinueLearningRecommendations).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ learnerId: "10000000-0000-4000-8000-000000000009" }),
    );
  });
});
