import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/compliance/channel-launch", () => ({
  evaluateChannelLaunchGate: () => ({
    status: "open",
    reason: "Every Channel release gate has explicit evidence.",
  }),
}));

const { afterCallbacks, mocks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  mocks: {
    after: vi.fn(),
    resolveRequestPrincipal: vi.fn(),
    getUserTier: vi.fn(),
    getChannelScanRun: vi.fn(),
    cancelChannelScanRun: vi.fn(),
    retryChannelScanRun: vi.fn(),
    failChannelScanScheduling: vi.fn(),
    runChannelScanRun: vi.fn(),
  },
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return { ...actual, after: mocks.after };
});
vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/services/entitlements", () => ({
  getUserTier: mocks.getUserTier,
}));
vi.mock("@/lib/channel-scans/service", () => ({
  getChannelScanRun: mocks.getChannelScanRun,
  cancelChannelScanRun: mocks.cancelChannelScanRun,
  retryChannelScanRun: mocks.retryChannelScanRun,
  failChannelScanScheduling: mocks.failChannelScanScheduling,
  runChannelScanRun: mocks.runChannelScanRun,
}));

import { GET } from "../route";
import { POST as cancel } from "../cancel/route";
import { POST as retry } from "../retry/route";

const PRINCIPAL = {
  userId: "account-1",
  isAnonymous: false,
  email: "steward@example.com",
  smokeProEntitled: true,
  businessAnalyticsSuppressed: false,
};

const RUN = {
  id: "10000000-0000-4000-8000-000000000001",
  accountId: PRINCIPAL.userId,
  connectedChannelId: "synthetic-demo-channel",
  videoId: null,
  provider: "synthetic" as const,
  status: "running" as const,
  outcome: null,
  retryOf: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: "2026-08-31T12:00:00.100Z",
  completedAt: null,
  cancelRequestedAt: null,
  failureCode: null,
  nextPageToken: "50",
  sourceExhausted: false,
  coverage: {
    pages: 1,
    threadsDiscovered: 50,
    threadsAssessed: 12,
    threadsReused: 3,
    threadsFailed: 1,
    windowStart: "2026-08-24T12:00:00.000Z",
    windowEnd: "2026-08-31T12:00:00.000Z",
    oldestThreadAt: "2026-08-30T12:00:00.000Z",
    newestThreadAt: "2026-08-31T12:00:00.000Z",
    bound: null,
    boundPreventedCompleteCoverage: false,
    completeWithinBounds: false,
  },
  progress: { processedThreads: 16, totalThreads: 50, percent: 32 },
};

const CONTEXT = {
  params: Promise.resolve({ runId: RUN.id }),
};

function request(url: string): Request {
  return new Request(`http://test${url}`, { method: "POST" });
}

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
  mocks.getUserTier.mockResolvedValue("pro");
  mocks.getChannelScanRun.mockResolvedValue(RUN);
  mocks.cancelChannelScanRun.mockResolvedValue({
    ...RUN,
    status: "running",
    cancelRequestedAt: "2026-08-31T12:01:00.000Z",
  });
  mocks.retryChannelScanRun.mockResolvedValue({
    kind: "started",
    run: {
      ...RUN,
      id: "10000000-0000-4000-8000-000000000002",
      status: "queued",
      retryOf: RUN.id,
    },
  });
  mocks.runChannelScanRun.mockResolvedValue(undefined);
  mocks.failChannelScanScheduling.mockResolvedValue(undefined);
});

describe("/api/channel/scans/[runId]", () => {
  it("returns durable progress and schedules an active worker after reading", async () => {
    const response = await GET(
      new Request(`http://test/api/channel/scans/${RUN.id}`),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: expect.objectContaining({
        id: RUN.id,
        failureCode: null,
        coverage: expect.objectContaining({
          pages: 1,
          threadsDiscovered: 50,
        }),
        progress: { processedThreads: 16, totalThreads: 50, percent: 32 },
      }),
    });
    expect(mocks.getChannelScanRun).toHaveBeenCalledWith(
      RUN.id,
      PRINCIPAL.userId,
    );
    expect(afterCallbacks).toHaveLength(1);
  });

  it("exposes a bounded run failure code for truthful quota coverage", async () => {
    mocks.getChannelScanRun.mockResolvedValueOnce({
      ...RUN,
      status: "partial",
      outcome: "partial",
      failureCode: "YOUTUBE_QUOTA_EXHAUSTED",
    });

    const response = await GET(
      new Request(`http://test/api/channel/scans/${RUN.id}`),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: expect.objectContaining({
        failureCode: "YOUTUBE_QUOTA_EXHAUSTED",
        outcome: "partial",
      }),
    });
  });

  it("retains a running run while requesting cancellation", async () => {
    const response = await cancel(
      request(`/api/channel/scans/${RUN.id}/cancel`),
      CONTEXT,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "cancellation_requested",
      run: {
        id: RUN.id,
        status: "running",
        cancelRequestedAt: "2026-08-31T12:01:00.000Z",
      },
    });
    expect(mocks.cancelChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      runId: RUN.id,
    });
  });

  it("starts a retry that can be scheduled without redoing the old run", async () => {
    const response = await retry(
      request(`/api/channel/scans/${RUN.id}/retry`),
      CONTEXT,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "started",
      run: { retryOf: RUN.id, status: "queued" },
    });
    expect(mocks.retryChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      runId: RUN.id,
    });
    expect(afterCallbacks).toHaveLength(1);
  });

  it("does not schedule or retry for a free account", async () => {
    mocks.getUserTier.mockResolvedValue("free");
    const response = await retry(
      request(`/api/channel/scans/${RUN.id}/retry`),
      CONTEXT,
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "upgrade_required",
    });
    expect(mocks.retryChannelScanRun).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});
