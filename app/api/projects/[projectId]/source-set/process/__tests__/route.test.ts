import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mocks, afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  mocks: {
    after: vi.fn(),
    resolveRequestPrincipal: vi.fn(),
    createClient: vi.fn(),
    resolveProjectSubject: vi.fn(),
    startProjectVideoProcessing: vi.fn(),
    prepareProjectVideoProcessing: vi.fn(),
    completeProjectVideoProcessing: vi.fn(),
    failProjectVideoProcessingCompletion: vi.fn(),
    failProjectVideoProcessingSchedule: vi.fn(),
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
vi.mock("@/lib/projects/project-video-processing", () => ({
  startProjectVideoProcessing: mocks.startProjectVideoProcessing,
  prepareProjectVideoProcessing: mocks.prepareProjectVideoProcessing,
  completeProjectVideoProcessing: mocks.completeProjectVideoProcessing,
  failProjectVideoProcessingCompletion: mocks.failProjectVideoProcessingCompletion,
  failProjectVideoProcessingSchedule: mocks.failProjectVideoProcessingSchedule,
}));

import { POST } from "../route";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000002";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const PRINCIPAL = {
  userId: "owner-1",
  isAnonymous: false,
  email: "owner@example.com",
};
const SUBJECT = {
  kind: "project" as const,
  projectId: PROJECT_ID,
  workspaceId: "b0000000-0000-4000-8000-000000000001",
  ownerId: PRINCIPAL.userId,
  name: "Evidence review",
  guidance: { goal: null },
  lastActiveAt: "2026-08-08T00:00:00.000Z",
};
const SOURCE_SET = {
  projectId: PROJECT_ID,
  revision: 1,
  videos: [],
};
const LEASE = {
  projectId: PROJECT_ID,
  videoId: VIDEO_ID,
  youtubeUrl: YOUTUBE_URL,
  attemptId: ATTEMPT_ID,
  ordinal: 1,
  attemptKind: "new" as const,
};

function request(body: unknown = { youtubeUrl: YOUTUBE_URL, expectedRevision: 0 }) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/projects/[projectId]/source-set/process", () => {
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
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: SUBJECT,
    });
    mocks.completeProjectVideoProcessing.mockResolvedValue(undefined);
    mocks.failProjectVideoProcessingCompletion.mockResolvedValue(undefined);
    mocks.failProjectVideoProcessingSchedule.mockResolvedValue(undefined);
  });

  it("rejects an invalid URL before auth, membership, quota, or processing", async () => {
    const response = await POST(
      request({ youtubeUrl: "https://example.com/watch?v=dQw4w9WgXcQ", expectedRevision: 0 }),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.startProjectVideoProcessing).not.toHaveBeenCalled();
    expect(mocks.prepareProjectVideoProcessing).not.toHaveBeenCalled();
  });

  it("schedules the sole lease owner independently from the browser request", async () => {
    const preparedResponse = new Response("summary stream");
    mocks.startProjectVideoProcessing.mockResolvedValue({
      kind: "started",
      sourceSet: SOURCE_SET,
      lease: LEASE,
    });
    mocks.prepareProjectVideoProcessing.mockResolvedValue({
      response: preparedResponse,
      abort: vi.fn(),
    });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "started",
      sourceSet: SOURCE_SET,
    });
    expect(mocks.startProjectVideoProcessing).toHaveBeenCalledWith(
      { fixture: true },
      SUBJECT,
      "dQw4w9WgXcQ",
      0,
    );
    expect(mocks.prepareProjectVideoProcessing).toHaveBeenCalledTimes(1);
    expect(afterCallbacks).toHaveLength(1);
    expect(mocks.completeProjectVideoProcessing).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(mocks.completeProjectVideoProcessing).toHaveBeenCalledWith({
      subject: SUBJECT,
      lease: LEASE,
      principal: PRINCIPAL,
      response: preparedResponse,
    });
  });

  it("prevents concurrent duplicate requests from creating a second worker", async () => {
    mocks.startProjectVideoProcessing
      .mockResolvedValueOnce({
        kind: "started",
        sourceSet: SOURCE_SET,
        lease: LEASE,
      })
      .mockResolvedValueOnce({
        kind: "already_processing",
        sourceSet: SOURCE_SET,
      });
    mocks.prepareProjectVideoProcessing.mockResolvedValue({
      response: new Response("summary stream"),
      abort: vi.fn(),
    });

    const responses = await Promise.all([
      POST(request(), CONTEXT),
      POST(request(), CONTEXT),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(mocks.prepareProjectVideoProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("preserves the existing quota response and finalizes the membership failed", async () => {
    mocks.startProjectVideoProcessing.mockResolvedValue({
      kind: "started",
      sourceSet: SOURCE_SET,
      lease: LEASE,
    });
    mocks.prepareProjectVideoProcessing.mockResolvedValue({
      response: Response.json(
        {
          message: "You've used your 10 free summaries this month. Upgrade for unlimited.",
          errorCode: "free_quota_exceeded",
          tier: "free",
          upgradeUrl: "/pricing",
        },
        { status: 402, headers: { "X-Error-ID": "QUOTA_EXCEEDED" } },
      ),
      abort: vi.fn(),
    });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(402);
    expect(response.headers.get("X-Error-ID")).toBe("QUOTA_EXCEEDED");
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "free_quota_exceeded",
      upgradeUrl: "/pricing",
    });
    expect(mocks.completeProjectVideoProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("does no Summary Run work when the universal five-source cap wins", async () => {
    mocks.startProjectVideoProcessing.mockResolvedValue({
      kind: "limit_reached",
      sourceSet: { ...SOURCE_SET, revision: 5 },
    });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "limit_reached",
      message: expect.stringMatching(/five Videos/i),
    });
    expect(mocks.prepareProjectVideoProcessing).not.toHaveBeenCalled();
    expect(mocks.completeProjectVideoProcessing).not.toHaveBeenCalled();
  });

  it("fails the accepted lease if background scheduling throws", async () => {
    const abort = vi.fn();
    mocks.startProjectVideoProcessing.mockResolvedValue({
      kind: "retry_started",
      sourceSet: SOURCE_SET,
      lease: { ...LEASE, attemptKind: "retry" },
    });
    mocks.prepareProjectVideoProcessing.mockResolvedValue({
      response: new Response("summary stream"),
      abort,
    });
    mocks.after.mockImplementation(() => {
      throw new Error("request scope unavailable");
    });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(503);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(mocks.failProjectVideoProcessingSchedule).toHaveBeenCalledWith({
      subject: SUBJECT,
      lease: { ...LEASE, attemptKind: "retry" },
      principal: PRINCIPAL,
    });
  });

  it("fails an unexpected background exception without duplicating the started event", async () => {
    mocks.startProjectVideoProcessing.mockResolvedValue({
      kind: "started",
      sourceSet: SOURCE_SET,
      lease: LEASE,
    });
    mocks.prepareProjectVideoProcessing.mockResolvedValue({
      response: new Response("summary stream"),
      abort: vi.fn(),
    });
    mocks.completeProjectVideoProcessing.mockRejectedValue(
      new Error("unexpected completion failure"),
    );

    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(202);
    await afterCallbacks[0]();

    expect(mocks.failProjectVideoProcessingCompletion).toHaveBeenCalledWith({
      subject: SUBJECT,
      lease: LEASE,
      principal: PRINCIPAL,
    });
    expect(mocks.failProjectVideoProcessingSchedule).not.toHaveBeenCalled();
  });

  it("hides a Project owned by another Researcher before membership work", async () => {
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "missing" });

    const response = await POST(request(), CONTEXT);

    expect(response.status).toBe(404);
    expect(mocks.startProjectVideoProcessing).not.toHaveBeenCalled();
  });
});
