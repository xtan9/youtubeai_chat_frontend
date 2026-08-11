import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getServiceRoleClient: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import {
  runCatalogAdmissionMaintenance,
  runCatalogAdmissionWorker,
} from "../catalog-admission-worker";

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

function youtubeResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    items: [
      {
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "Refreshed title",
          channelId: "channel-1",
          channelTitle: "Refreshed channel",
          publishedAt: "2025-01-02T03:04:05Z",
          defaultAudioLanguage: "en-US",
          liveBroadcastContent: "none",
          thumbnails: {
            high: { url: "https://i.ytimg.com/vi/id/hqdefault.jpg" },
          },
        },
        status: { privacyStatus: "public", embeddable: true },
        contentDetails: {
          duration: "PT2M3S",
          contentRating: {},
        },
        ...overrides,
      },
    ],
  });
}

describe("runCatalogAdmissionWorker", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "provider-key");
    mocks.rpc.mockReset();
    mocks.getServiceRoleClient.mockReset();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_catalog_admission_work") {
        return { data: [WORK], error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(youtubeResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("schedules a bounded stale-evidence refresh before draining admission work", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "schedule_catalog_admission_refresh") {
        return { data: { scheduled: 1 }, error: null };
      }
      if (name === "claim_catalog_admission_work") {
        return { data: [], error: null };
      }
      return { data: { outcome: "ok" }, error: null };
    });

    await expect(runCatalogAdmissionMaintenance()).resolves.toEqual({
      scheduled: 1,
      claimed: 0,
      completed: 0,
      retried: 0,
      exhausted: 0,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "schedule_catalog_admission_refresh",
      { p_batch_size: 4 },
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "claim_catalog_admission_work",
      {
        p_batch_size: 4,
        p_visibility_timeout_seconds: 120,
      },
    );
  });

  it("claims a bounded lease, refreshes through the provider, and commits normalized evidence", async () => {
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
    expect(fetch).toHaveBeenCalledOnce();
    const [providerUrl, providerInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(providerUrl)).toContain(
      "https://www.googleapis.com/youtube/v3/videos",
    );
    expect(String(providerUrl)).toContain("id=dQw4w9WgXcQ");
    expect(providerInit?.signal).toBeInstanceOf(AbortSignal);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_catalog_admission_work",
      expect.objectContaining({
        p_msg_id: 41,
        p_nomination_id: WORK.nomination_id,
        p_idempotency_key: WORK.idempotency_key,
        p_provider_outcome: "verified",
        p_provider_path: "youtube_data_api_v3_videos_list",
        p_title: "Refreshed title",
        p_duration_seconds: 123,
        p_privacy_status: "public",
        p_embeddable: true,
        p_live_status: "none",
        p_age_restricted: false,
      }),
    );
  });

  it("commits authoritative provider absence as a governed inactive decision", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [] }));

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

  it("classifies malformed provider metadata for retry without completion", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ items: [{ id: "dQw4w9WgXcQ" }] }),
    );

    await expect(runCatalogAdmissionWorker()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      retried: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_catalog_admission_work",
      expect.objectContaining({
        p_msg_id: 41,
        p_failure_code: "provider_schema",
      }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_catalog_admission_work",
      expect.anything(),
    );
  });

  it.each([
    ["timeout", "TimeoutError"],
    ["cancellation", "AbortError"],
  ])(
    "classifies provider %s as a bounded retry",
    async (_label, errorName) => {
      vi.mocked(fetch).mockRejectedValueOnce(
        Object.assign(new Error("provider request ended"), { name: errorName }),
      );

      await expect(runCatalogAdmissionWorker()).resolves.toMatchObject({
        claimed: 1,
        completed: 0,
        retried: 1,
      });
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
    },
  );

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
    expect(fetch).toHaveBeenCalledOnce();
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
    expect(fetch).not.toHaveBeenCalled();
  });
});
