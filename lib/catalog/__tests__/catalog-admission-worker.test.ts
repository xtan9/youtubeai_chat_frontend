import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getServiceRoleClient: vi.fn(),
    rpc: vi.fn(),
    fetchCatalogAdmissionEvidence: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("../catalog-admission", async () => {
  const actual = await vi.importActual<typeof import("../catalog-admission")>(
    "../catalog-admission",
  );
  return {
    ...actual,
    fetchCatalogAdmissionEvidence: mocks.fetchCatalogAdmissionEvidence,
  };
});

import { runCatalogAdmissionWorker } from "../catalog-admission-worker";

const WORK = {
  msg_id: 41,
  read_count: 1,
  nomination_id: "10000000-0000-4000-8000-000000000001",
  video_id: "20000000-0000-4000-8000-000000000002",
  youtube_video_id: "dQw4w9WgXcQ",
  idempotency_key:
    "10000000-0000-4000-8000-000000000001:catalog-admission-v1",
  policy_version: "catalog-admission-v1",
  priority: "high",
  trace_id: "trace-worker-1",
};

const VERIFIED = {
  outcome: "verified" as const,
  evidence: {
    providerPath: "youtube_data_api_v3_videos_list" as const,
    youtubeVideoId: "dQw4w9WgXcQ",
    title: "Refreshed title",
    channelId: "channel-1",
    channelName: "Refreshed channel",
    thumbnailUrl: "https://i.ytimg.com/vi/id/hqdefault.jpg",
    defaultLanguage: "en-US",
    durationSeconds: 123,
    publishedAt: "2025-01-02T03:04:05.000Z",
    privacyStatus: "public" as const,
    embeddable: true,
    liveStatus: "none" as const,
    ageRestricted: false,
    providerVerifiedAt: "2026-08-09T20:00:00.000Z",
    evidenceExpiresAt: "2026-08-10T20:00:00.000Z",
  },
};

const ABSENT = {
  outcome: "absent" as const,
  evidence: {
    providerPath: "youtube_data_api_v3_videos_list" as const,
    youtubeVideoId: "dQw4w9WgXcQ",
    providerVerifiedAt: "2026-08-09T20:00:00.000Z",
    evidenceExpiresAt: "2026-08-10T20:00:00.000Z",
  },
};

describe("runCatalogAdmissionWorker", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.fetchCatalogAdmissionEvidence.mockResolvedValue(VERIFIED);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_catalog_admission_work") {
        return { data: [WORK], error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });
  });

  it("claims a bounded lease, independently refreshes, and commits normalized evidence", async () => {
    await expect(runCatalogAdmissionWorker()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      exhausted: 0,
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "claim_catalog_admission_work",
      {
        p_batch_size: 4,
        p_visibility_timeout_seconds: 120,
      },
    );
    expect(mocks.fetchCatalogAdmissionEvidence).toHaveBeenCalledWith(
      "dQw4w9WgXcQ",
      { timeoutMs: 8_000 },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_catalog_admission_work",
      expect.objectContaining({
        p_msg_id: 41,
        p_nomination_id: WORK.nomination_id,
        p_idempotency_key: WORK.idempotency_key,
        p_provider_path: "youtube_data_api_v3_videos_list",
        p_title: "Refreshed title",
        p_privacy_status: "public",
        p_embeddable: true,
        p_live_status: "none",
        p_age_restricted: false,
      }),
    );
  });

  it("commits authoritative provider absence as a governed inactive decision", async () => {
    mocks.fetchCatalogAdmissionEvidence.mockResolvedValue(ABSENT);

    await expect(runCatalogAdmissionWorker()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      exhausted: 0,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_catalog_admission_work",
      expect.objectContaining({
        p_msg_id: 41,
        p_nomination_id: WORK.nomination_id,
        p_provider_outcome: "absent",
        p_provider_path: "youtube_data_api_v3_videos_list",
        p_title: null,
        p_privacy_status: null,
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "fail_catalog_admission_work",
      expect.anything(),
    );
  });

  it("classifies provider failure for retry without attempting completion", async () => {
    mocks.fetchCatalogAdmissionEvidence.mockResolvedValue({
      outcome: "unavailable",
      failureCode: "provider_timeout",
    });

    const result = await runCatalogAdmissionWorker();

    expect(result).toMatchObject({ claimed: 1, completed: 0, retried: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_catalog_admission_work",
      {
        p_msg_id: 41,
        p_nomination_id: WORK.nomination_id,
        p_failure_code: "provider_timeout",
        p_max_attempts: 4,
        p_base_delay_seconds: 30,
      },
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_catalog_admission_work",
      expect.anything(),
    );
  });

  it("bounds a poison message and continues processing the next lease", async () => {
    const malformed = {
      ...WORK,
      msg_id: 42,
      nomination_id: null,
      youtube_video_id: null,
      idempotency_key: null,
    };
    mocks.rpc.mockImplementation(async (name: string, input: unknown) => {
      if (name === "claim_catalog_admission_work") {
        return { data: [malformed, { ...WORK, msg_id: 43 }], error: null };
      }
      if (
        name === "fail_catalog_admission_work" &&
        (input as { p_msg_id: number }).p_msg_id === 42
      ) {
        return { data: { outcome: "exhausted" }, error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });

    await expect(runCatalogAdmissionWorker()).resolves.toEqual({
      claimed: 2,
      completed: 1,
      retried: 0,
      exhausted: 1,
    });
    expect(mocks.fetchCatalogAdmissionEvidence).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_catalog_admission_work",
      expect.objectContaining({
        p_msg_id: 42,
        p_failure_code: "invalid_message",
      }),
    );
  });

  it("returns an empty bounded result when no work is visible", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(runCatalogAdmissionWorker()).resolves.toEqual({
      claimed: 0,
      completed: 0,
      retried: 0,
      exhausted: 0,
    });
    expect(mocks.fetchCatalogAdmissionEvidence).not.toHaveBeenCalled();
  });
});
