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
    startChannelScanRun: vi.fn(),
    runChannelScanRun: vi.fn(),
    listChannelScanRuns: vi.fn(),
    getChannelScanRun: vi.fn(),
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
  startChannelScanRun: mocks.startChannelScanRun,
  runChannelScanRun: mocks.runChannelScanRun,
  listChannelScanRuns: mocks.listChannelScanRuns,
  getChannelScanRun: mocks.getChannelScanRun,
}));

import { GET, POST } from "../route";

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
  status: "queued" as const,
  outcome: null,
  retryOf: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
  cancelRequestedAt: null,
  failureCode: null,
  nextPageToken: null,
  sourceExhausted: false,
  coverage: {
    pages: 0,
    threadsDiscovered: 0,
    threadsAssessed: 0,
    threadsReused: 0,
    threadsFailed: 0,
    windowStart: "2026-08-24T12:00:00.000Z",
    windowEnd: "2026-08-31T12:00:00.000Z",
    oldestThreadAt: null,
    newestThreadAt: null,
    bound: null,
    boundPreventedCompleteCoverage: false,
    completeWithinBounds: false,
  },
  progress: { processedThreads: 0, totalThreads: 0, percent: 0 },
};

function request(body?: unknown): Request {
  return new Request("http://test/api/channel/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/channel/scans", () => {
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
    mocks.startChannelScanRun.mockResolvedValue({ kind: "started", run: RUN });
    mocks.runChannelScanRun.mockResolvedValue(undefined);
    mocks.listChannelScanRuns.mockResolvedValue([RUN]);
    mocks.getChannelScanRun.mockResolvedValue(RUN);
  });

  it("durably starts an offline synthetic run and schedules only the worker", async () => {
    const response = await POST(
      request({
        connectedChannelId: "synthetic-demo-channel",
        provider: "synthetic",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "started",
      run: { id: RUN.id, status: "queued" },
    });
    expect(mocks.startChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      connectedChannelId: "synthetic-demo-channel",
      retryOf: null,
    });
    expect(afterCallbacks).toHaveLength(1);
    expect(mocks.runChannelScanRun).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(mocks.runChannelScanRun).toHaveBeenCalledWith(RUN.id);
  });

  it("requires a registered, paid steward before touching scan persistence", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    const response = await POST(
      request({ connectedChannelId: "synthetic-demo-channel" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getUserTier).not.toHaveBeenCalled();
    expect(mocks.startChannelScanRun).not.toHaveBeenCalled();
  });

  it("keeps free accounts from starting a new scan", async () => {
    mocks.getUserTier.mockResolvedValue("free");
    const response = await POST(
      request({ connectedChannelId: "synthetic-demo-channel" }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "upgrade_required",
    });
    expect(mocks.startChannelScanRun).not.toHaveBeenCalled();
  });

  it("does not accept a real channel identifier before #471 identity onboarding", async () => {
    const response = await POST(
      request({ connectedChannelId: "UC-real-channel-id" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      outcome: "onboarding_required",
      message: "Connect a verified YouTube Channel before starting a scan.",
    });
    expect(mocks.startChannelScanRun).not.toHaveBeenCalled();
  });

  it("passes an explicitly requested real scan to the fail-closed service seam", async () => {
    const realConnectedChannelId = "00000000-0000-4000-8000-000000000001";
    mocks.startChannelScanRun.mockResolvedValueOnce({
      kind: "blocked",
      code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED",
      reason: "Written YouTube clearance is still pending.",
    });

    const response = await POST(
      request({
        connectedChannelId: realConnectedChannelId,
        provider: "youtube",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      outcome: "real_scan_blocked",
      code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED",
      message: "Written YouTube clearance is still pending.",
    });
    expect(mocks.startChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      connectedChannelId: realConnectedChannelId,
      retryOf: null,
      provider: "youtube",
    });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("passes an owned-Video scope only through the real provider seam", async () => {
    const realConnectedChannelId = "00000000-0000-4000-8000-000000000001";
    mocks.startChannelScanRun.mockResolvedValueOnce({
      kind: "blocked",
      code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED",
      reason: "Written YouTube clearance is still pending.",
    });

    const response = await POST(
      request({
        connectedChannelId: realConnectedChannelId,
        provider: "youtube",
        videoId: "AbCdEfGhI_1",
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.startChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      connectedChannelId: realConnectedChannelId,
      retryOf: null,
      provider: "youtube",
      videoId: "AbCdEfGhI_1",
    });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("reports the atomic channel-concurrency and account-hourly decisions", async () => {
    mocks.startChannelScanRun.mockResolvedValueOnce({
      kind: "concurrent",
      run: RUN,
    });
    const concurrent = await POST(
      request({ connectedChannelId: "synthetic-demo-channel" }),
    );
    expect(concurrent.status).toBe(409);
    await expect(concurrent.json()).resolves.toMatchObject({
      outcome: "concurrent",
      run: { id: RUN.id },
    });

    mocks.startChannelScanRun.mockResolvedValueOnce({
      kind: "rate_limited",
      retryAt: "2026-08-31T13:00:00.000Z",
    });
    const limited = await POST(
      request({ connectedChannelId: "synthetic-another-channel" }),
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      outcome: "rate_limited",
      retryAt: "2026-08-31T13:00:00.000Z",
    });
  });

  it("returns persisted run progress and resumes active work after navigation", async () => {
    const response = await GET(
      new Request(
        "http://test/api/channel/scans?connectedChannelId=synthetic-demo-channel",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runs: [expect.objectContaining({ id: RUN.id })],
    });
    expect(mocks.listChannelScanRuns).toHaveBeenCalledWith(
      PRINCIPAL.userId,
      "synthetic-demo-channel",
    );
  });
});
