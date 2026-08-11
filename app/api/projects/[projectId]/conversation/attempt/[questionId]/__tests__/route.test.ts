import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  loadAttempt: vi.fn(),
}));
vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: mocks.requireRegisteredResearcher,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));

import { GET } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const QUESTION_ID = "40000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";

describe("GET exact Project Grounded Answer attempt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: { groundedAnswers: { loadAttempt: mocks.loadAttempt } },
    });
    mocks.loadAttempt.mockResolvedValue({
      status: "ready",
      userMessageId: QUESTION_ID,
      state: "cancelled",
      assistant: null,
    });
  });

  it("loads only the exact client-known question without exposing a token", async () => {
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ projectId: PROJECT_ID, questionId: QUESTION_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attempt).toMatchObject({
      status: "ready",
      userMessageId: QUESTION_ID,
      state: "cancelled",
    });
    expect(JSON.stringify(body)).not.toContain("attemptToken");
    expect(mocks.loadAttempt).toHaveBeenCalledWith(QUESTION_ID, undefined);
  });

  it("rejects malformed UUIDs before the attempt capability", async () => {
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ projectId: PROJECT_ID, questionId: "newest" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.loadAttempt).not.toHaveBeenCalled();
  });

  it("scopes exact reconciliation to the selected conversation", async () => {
    const response = await GET(
      new Request(`http://test?conversationId=${CONVERSATION_ID}`),
      {
        params: Promise.resolve({
          projectId: PROJECT_ID,
          questionId: QUESTION_ID,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(mocks.loadAttempt).toHaveBeenCalledWith(
      QUESTION_ID,
      CONVERSATION_ID,
    );
  });

  it("rejects a malformed selected conversation before lookup", async () => {
    const response = await GET(new Request("http://test?conversationId=newest"), {
      params: Promise.resolve({ projectId: PROJECT_ID, questionId: QUESTION_ID }),
    });
    expect(response.status).toBe(400);
    expect(mocks.loadAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", 404],
    ["unavailable", 503],
  ])("maps %s without leaking foreign attempt state", async (status, code) => {
    mocks.loadAttempt.mockResolvedValue({ status });
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ projectId: PROJECT_ID, questionId: QUESTION_ID }),
    });
    expect(response.status).toBe(code);
  });
});
