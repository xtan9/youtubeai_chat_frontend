import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mocks } = vi.hoisted(() => ({
  mocks: {
    evaluateChannelLaunchGate: vi.fn(),
    resolveRequestPrincipal: vi.fn(),
    resolveRegisteredSubscription: vi.fn(),
    createClient: vi.fn(),
    loadChannelAccessSnapshot: vi.fn(),
    startChannelScanRun: vi.fn(),
    getChannelScanRun: vi.fn(),
    cancelChannelScanRun: vi.fn(),
    failChannelScanScheduling: vi.fn(),
    scheduleWorker: vi.fn(),
  },
}));

vi.mock("@/lib/compliance/channel-launch", () => ({
  evaluateChannelLaunchGate: mocks.evaluateChannelLaunchGate,
}));
vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));
vi.mock("@/lib/services/entitlements", () => ({
  resolveRegisteredSubscription: mocks.resolveRegisteredSubscription,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/channel-exposure/server", () => ({
  loadChannelAccessSnapshot: mocks.loadChannelAccessSnapshot,
}));
vi.mock("@/lib/channel-scans/service", () => ({
  startChannelScanRun: mocks.startChannelScanRun,
  getChannelScanRun: mocks.getChannelScanRun,
  cancelChannelScanRun: mocks.cancelChannelScanRun,
  failChannelScanScheduling: mocks.failChannelScanScheduling,
}));
vi.mock("../../scans/schedule", () => ({
  scheduleWorker: mocks.scheduleWorker,
}));

import { POST } from "../route";

const PRINCIPAL = { userId: "owner-1", isAnonymous: false };
const CONNECTED_CHANNEL = {
  ownerId: PRINCIPAL.userId,
  channelId: "channel-1",
  connectedChannelId: "connected-1",
  grantId: "grant-1",
  supportedCreator: true,
  status: "active" as const,
};
const ACCESS = {
  access: {
    principal: PRINCIPAL,
    entitlement: { state: "active_pro" as const, verified: true },
    persistenceAvailable: true,
    adultAttestation: {
      attested: true,
      attestedAt: "2026-09-01T12:00:00.000Z",
      policyVersion: "channel-adult-v1",
    },
    connectedChannel: CONNECTED_CHANNEL,
    grant: {
      ownerId: PRINCIPAL.userId,
      channelId: "channel-1",
      connectedChannelId: "connected-1",
      grantId: "grant-1",
      credentialReferenceId: "credential-1",
      provider: "youtube" as const,
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
      readScopeGranted: true,
      writeScopeGranted: false,
      status: "active" as const,
    },
  },
};
const RUN = {
  id: "10000000-0000-4000-8000-000000000001",
  accountId: PRINCIPAL.userId,
  connectedChannelId: "connected-1",
  videoId: null,
  provider: "youtube" as const,
  status: "queued" as const,
  outcome: null,
  retryOf: null,
  createdAt: "2026-09-01T12:00:00.000Z",
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
    windowStart: "2026-08-25T12:00:00.000Z",
    windowEnd: "2026-09-01T12:00:00.000Z",
    oldestThreadAt: null,
    newestThreadAt: null,
    bound: null,
    boundPreventedCompleteCoverage: false,
    completeWithinBounds: false,
  },
  progress: { processedThreads: 0, totalThreads: 0, percent: 0 },
};

function request(body: unknown): Request {
  return new Request("https://youtubeai.chat/api/channel/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.evaluateChannelLaunchGate.mockReturnValue({
    status: "open",
    reason: "Every Channel release gate has explicit evidence.",
  });
  mocks.resolveRequestPrincipal.mockResolvedValue({
    kind: "resolved",
    principal: PRINCIPAL,
  });
  mocks.resolveRegisteredSubscription.mockResolvedValue({
    kind: "resolved",
    tier: "pro",
    stripeSubscriptionId: null,
    subscription: null,
    presentation: { state: "active_pro", plan: null, renewsAt: null },
  });
  mocks.createClient.mockResolvedValue({});
  mocks.loadChannelAccessSnapshot.mockResolvedValue({
    kind: "resolved",
    snapshot: ACCESS,
  });
  mocks.startChannelScanRun.mockResolvedValue({ kind: "started", run: RUN });
  mocks.getChannelScanRun.mockResolvedValue(RUN);
  mocks.cancelChannelScanRun.mockResolvedValue({
    ...RUN,
    status: "running",
    cancelRequestedAt: "2026-09-01T12:01:00.000Z",
  });
  mocks.failChannelScanScheduling.mockResolvedValue(undefined);
  mocks.scheduleWorker.mockReturnValue(true);
});

describe("/api/channel/actions", () => {
  it("starts and schedules one deliberate real Channel scan after revalidation", async () => {
    const response = await POST(request({ action: "start_scan" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "started",
      run: { id: RUN.id, status: "queued" },
    });
    expect(mocks.startChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      connectedChannelId: CONNECTED_CHANNEL.connectedChannelId,
      provider: "youtube",
    });
    expect(mocks.scheduleWorker).toHaveBeenCalledWith(RUN.id);
  });

  it("cancels only a run bound to the revalidated active Channel", async () => {
    const response = await POST(
      request({ action: "cancel_scan", subjectId: RUN.id }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "cancellation_requested",
      run: { id: RUN.id },
    });
    expect(mocks.cancelChannelScanRun).toHaveBeenCalledWith({
      accountId: PRINCIPAL.userId,
      runId: RUN.id,
    });
  });
});
