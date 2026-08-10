import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  captureProjectVideoProcessingEvent: vi.fn(),
  scheduleAnalyticsAfterResponse: vi.fn(),
  serviceRpc: vi.fn(),
  loadProjectSourceSet: vi.fn(),
  runServerSummaryRun: vi.fn(),
}));

vi.mock("@/lib/analytics/after", () => ({
  scheduleAnalyticsAfterResponse: mocks.scheduleAnalyticsAfterResponse,
}));

vi.mock("@/lib/analytics/server", () => ({
  captureProjectVideoProcessingEvent: mocks.captureProjectVideoProcessingEvent,
}));
vi.mock("@/lib/analytics/project-server", () => ({
  recordProjectAnalyticsTransition: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({ rpc: mocks.serviceRpc }),
}));
vi.mock("@/lib/projects/project-source-set", () => ({
  loadProjectSourceSet: mocks.loadProjectSourceSet,
}));
vi.mock("@/lib/summary-run/server-summary-run", () => ({
  runServerSummaryRun: mocks.runServerSummaryRun,
}));

import {
  completeProjectVideoProcessing,
  prepareProjectVideoProcessing,
  reconcileStaleProjectVideoProcessing,
  startProjectVideoProcessing,
} from "../project-video-processing";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000002";
const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SUBJECT = {
  kind: "project" as const,
  projectId: PROJECT_ID,
  workspaceId: "b0000000-0000-4000-8000-000000000001",
  ownerId: "owner-1",
  name: "Evidence review",
  guidance: { goal: null },
  lastActiveAt: "2026-08-08T00:00:00.000Z",
};
const PRINCIPAL = {
  userId: SUBJECT.ownerId,
  isAnonymous: false,
  email: "owner@example.com",
  businessAnalyticsSuppressed: false,
};
const LEASE = {
  projectId: PROJECT_ID,
  videoId: VIDEO_ID,
  youtubeUrl: URL,
  attemptId: ATTEMPT_ID,
  ordinal: 2,
  sourceSetRevision: 1,
  attemptKind: "new" as const,
};

function summaryResponse(cached: boolean): Response {
  const events = [
    { type: "metadata", category: "general", cached, title: "Fixture" },
    { type: "content", text: "Grounded summary" },
    {
      type: "full_transcript",
      source: "manual_captions",
      segments: [{ text: "Evidence", start: 0, duration: 2 }],
    },
    {
      type: "summary",
      category: "general",
      total_time: 5,
      transcribe_time: 2,
      summarize_time: 3,
    },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("Project Video processing service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.scheduleAnalyticsAfterResponse.mockImplementation(
      (callback: () => void | Promise<void>) => {
        void callback();
      },
    );
    mocks.captureProjectVideoProcessingEvent.mockResolvedValue(undefined);
    mocks.loadProjectSourceSet.mockResolvedValue({
      kind: "resolved",
      value: { projectId: PROJECT_ID, revision: 1, videos: [] },
    });
  });

  it("retains the sole processing lease even when the post-reservation reload fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "started",
        revision: 1,
        videoId: VIDEO_ID,
        ordinal: 2,
        attemptId: ATTEMPT_ID,
        ownsProcessing: true,
      },
      error: null,
    });
    mocks.loadProjectSourceSet.mockResolvedValue({ kind: "unavailable" });

    const result = await startProjectVideoProcessing(
      { rpc } as never,
      SUBJECT,
      "dQw4w9WgXcQ",
      0,
    );

    expect(result).toEqual({
      kind: "started",
      sourceSetRevision: 1,
      lease: LEASE,
    });
  });

  it.each([
    [true, "cache"],
    [false, "generated"],
  ] as const)(
    "finalizes durable %s Summary Run evidence as ready",
    async (cached, origin) => {
      mocks.serviceRpc.mockResolvedValue({
        data: { outcome: "transitioned", revision: 2 },
        error: null,
      });

      await completeProjectVideoProcessing({
        subject: SUBJECT,
        lease: LEASE,
        principal: PRINCIPAL,
        response: summaryResponse(cached),
      });

      expect(mocks.serviceRpc).toHaveBeenCalledWith(
        "finalize_project_video_processing",
        expect.objectContaining({
          p_attempt_id: ATTEMPT_ID,
          p_status: "ready",
          p_failure_code: null,
        }),
      );
      expect(mocks.captureProjectVideoProcessingEvent).toHaveBeenLastCalledWith(
        PRINCIPAL.userId,
        "project_video_processing_succeeded",
        {
          project_id: PROJECT_ID,
          status: "ready",
          ordinal: 2,
          result_origin: origin,
          transcription_seconds: 2,
          summary_seconds: 3,
          total_seconds: 5,
        },
        false,
      );
    },
  );

  it("classifies the existing Summary quota response and fails the lease", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: { outcome: "transitioned", revision: 2 },
      error: null,
    });

    let releaseCapture = () => {};
    mocks.captureProjectVideoProcessingEvent.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseCapture = resolve;
      }),
    );

    await completeProjectVideoProcessing({
      subject: SUBJECT,
      lease: LEASE,
      principal: PRINCIPAL,
      response: Response.json(
        {
          message: "Upgrade for unlimited.",
          errorCode: "free_quota_exceeded",
          tier: "free",
          upgradeUrl: "/pricing",
        },
        { status: 402, headers: { "X-Error-ID": "QUOTA_EXCEEDED" } },
      ),
    });

    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      "finalize_project_video_processing",
      expect.objectContaining({
        p_status: "failed",
        p_failure_code: "summary_quota",
      }),
    );
    expect(mocks.captureProjectVideoProcessingEvent).toHaveBeenLastCalledWith(
      PRINCIPAL.userId,
      "project_video_processing_failed",
      expect.objectContaining({
        status: "failed",
        ordinal: 2,
        error_class: "quota",
      }),
      false,
    );
    releaseCapture();
  });

  it("turns a missing durability proof into a classified persistence failure", async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({
        data: { outcome: "evidence_missing", revision: 1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { outcome: "transitioned", revision: 2 },
        error: null,
      });

    await completeProjectVideoProcessing({
      subject: SUBJECT,
      lease: LEASE,
      principal: PRINCIPAL,
      response: summaryResponse(false),
    });

    expect(mocks.serviceRpc).toHaveBeenNthCalledWith(
      2,
      "finalize_project_video_processing",
      expect.objectContaining({
        p_status: "failed",
        p_failure_code: "summary_persistence",
      }),
    );
    expect(mocks.captureProjectVideoProcessingEvent).toHaveBeenLastCalledWith(
      PRINCIPAL.userId,
      "project_video_processing_failed",
      expect.objectContaining({ error_class: "persistence" }),
      false,
    );
  });

  it("prepares a required-persistence Summary Run with a server-owned signal", async () => {
    let receivedRequest: Request | undefined;
    mocks.runServerSummaryRun.mockImplementation(
      async (request: Request) => {
        receivedRequest = request;
        return summaryResponse(true);
      },
    );

    const prepared = await prepareProjectVideoProcessing(LEASE, PRINCIPAL);

    expect(mocks.runServerSummaryRun).toHaveBeenCalledWith(
      expect.any(Request),
      { persistence: "required", principal: PRINCIPAL },
    );
    await expect(receivedRequest!.json()).resolves.toEqual({
      youtube_url: URL,
      include_transcript: true,
    });
    expect(receivedRequest!.signal.aborted).toBe(false);
    prepared.abort();
    expect(receivedRequest!.signal.aborted).toBe(true);
  });

  it("classifies stale leases with only ordinal and elapsed timing", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: {
        outcome: "expired",
        revision: 3,
        expiredCount: 1,
        expiredAttempts: [{ ordinal: 4, processingSeconds: 420 }],
      },
      error: null,
    });

    await reconcileStaleProjectVideoProcessing(SUBJECT);

    expect(mocks.captureProjectVideoProcessingEvent).toHaveBeenCalledWith(
      SUBJECT.ownerId,
      "project_video_processing_failed",
      {
        project_id: PROJECT_ID,
        status: "failed",
        ordinal: 4,
        error_class: "interrupted",
        processing_seconds: 420,
      },
      false,
    );
  });

  it("propagates marked-Smoke analytics suppression when a stale lease expires", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: {
        outcome: "expired",
        revision: 3,
        expiredCount: 1,
        expiredAttempts: [{ ordinal: 4, processingSeconds: 420 }],
      },
      error: null,
    });

    await reconcileStaleProjectVideoProcessing(SUBJECT, true);

    expect(mocks.captureProjectVideoProcessingEvent).toHaveBeenCalledWith(
      SUBJECT.ownerId,
      "project_video_processing_failed",
      {
        project_id: PROJECT_ID,
        status: "failed",
        ordinal: 4,
        error_class: "interrupted",
        processing_seconds: 420,
      },
      true,
    );
  });
});
