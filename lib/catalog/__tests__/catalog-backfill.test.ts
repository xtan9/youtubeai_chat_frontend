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

import { runCatalogBackfillWorker } from "../catalog-backfill";

const WORK = {
  msg_id: 101,
  read_count: 1,
  backfill_job_id: "10000000-0000-4000-8000-000000000001",
  summary_id: "20000000-0000-4000-8000-000000000002",
  video_id: "30000000-0000-4000-8000-000000000003",
  youtube_video_id: "dQw4w9WgXcQ",
  idempotency_key:
    "10000000-0000-4000-8000-000000000001:catalog-backfill-v1",
  policy_version: "catalog-backfill-v1",
  priority: "cold_start",
  trace_id: "catalog-backfill:10000000-0000-4000-8000-000000000001",
};

function youtubeResponse(
  overrides: Record<string, unknown> = {},
  statusOverrides: Record<string, unknown> = {},
) {
  return Response.json({
    items: [
      {
        id: "dQw4w9WgXcQ",
        snippet: {
          title: "Backfilled title",
          channelId: "channel-backfill",
          channelTitle: "Backfilled channel",
          publishedAt: "2025-01-02T03:04:05Z",
          defaultAudioLanguage: "en-US",
          liveBroadcastContent: "none",
          thumbnails: {
            high: { url: "https://i.ytimg.com/vi/id/hqdefault.jpg" },
          },
          ...overrides,
        },
        status: {
          privacyStatus: "public",
          embeddable: true,
          ...statusOverrides,
        },
        contentDetails: {
          duration: "PT2M3S",
          contentRating: {},
        },
      },
    ],
  });
}

describe("runCatalogBackfillWorker", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_DATA_API_KEY", "provider-key");
    mocks.rpc.mockReset();
    mocks.getServiceRoleClient.mockReset();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_catalog_backfill_work") {
        return { data: [WORK], error: null };
      }
      if (name === "request_catalog_nomination") {
        return { data: { outcome: "enqueued" }, error: null };
      }
      if (name === "requeue_catalog_nomination") {
        return { data: { outcome: "already_enqueued" }, error: null };
      }
      return { data: { outcome: "completed" }, error: null };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(youtubeResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("re-verifies a summary-backed Video and submits it through ordinary Catalog Admission", async () => {
    await expect(runCatalogBackfillWorker()).resolves.toEqual({
      claimed: 1,
      nominated: 1,
      alreadyEnqueued: 0,
      skipped: 0,
      retried: 0,
      exhausted: 0,
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "claim_catalog_backfill_work", {
      p_batch_size: 4,
      p_visibility_timeout_seconds: 120,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_catalog_nomination",
      expect.objectContaining({
        p_youtube_video_id: WORK.youtube_video_id,
        p_title: "Backfilled title",
        p_privacy_status: "public",
        p_embeddable: true,
        p_live_status: "none",
        p_age_restricted: false,
        p_trace_id: WORK.trace_id,
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_catalog_backfill_work",
      {
        p_msg_id: WORK.msg_id,
        p_backfill_job_id: WORK.backfill_job_id,
        p_idempotency_key: WORK.idempotency_key,
        p_outcome: "nominated",
        p_reason_code: null,
      },
    );
  });

  it("does not submit newly ineligible provider evidence and completes the job with a reason", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      youtubeResponse({}, { privacyStatus: "private" }),
    );

    await expect(runCatalogBackfillWorker()).resolves.toMatchObject({
      claimed: 1,
      nominated: 0,
      skipped: 1,
      retried: 0,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "request_catalog_nomination",
      expect.anything(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_catalog_backfill_work",
      expect.objectContaining({
        p_outcome: "skipped",
        p_reason_code: "not_public",
      }),
    );
  });

  it("bounds provider failures with the shared retry contract", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      Object.assign(new Error("provider timeout"), { name: "TimeoutError" }),
    );

    await expect(runCatalogBackfillWorker()).resolves.toEqual({
      claimed: 1,
      nominated: 0,
      alreadyEnqueued: 0,
      skipped: 0,
      retried: 1,
      exhausted: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_catalog_backfill_work",
      {
        p_msg_id: WORK.msg_id,
        p_backfill_job_id: WORK.backfill_job_id,
        p_failure_code: "provider_timeout",
        p_max_attempts: 4,
        p_base_delay_seconds: 30,
      },
    );
  });

  it("quarantines a poison envelope and continues with the next backfill job", async () => {
    const poison = {
      ...WORK,
      msg_id: 102,
      backfill_job_id: null,
      summary_id: null,
      video_id: null,
      youtube_video_id: null,
      idempotency_key: null,
      policy_version: "invalid",
      priority: "unknown",
    };
    mocks.rpc.mockImplementation(async (name: string, input: unknown) => {
      if (name === "claim_catalog_backfill_work") {
        return { data: [poison, { ...WORK, msg_id: 103 }], error: null };
      }
      if (
        name === "fail_catalog_backfill_work" &&
        (input as { p_msg_id: number }).p_msg_id === poison.msg_id
      ) {
        return { data: { outcome: "exhausted" }, error: null };
      }
      if (name === "request_catalog_nomination") {
        return { data: { outcome: "already_enqueued" }, error: null };
      }
      if (name === "requeue_catalog_nomination") {
        return { data: { outcome: "already_enqueued" }, error: null };
      }
      return { data: { outcome: "completed" }, error: null };
    });

    await expect(runCatalogBackfillWorker()).resolves.toEqual({
      claimed: 2,
      nominated: 0,
      alreadyEnqueued: 1,
      skipped: 0,
      retried: 0,
      exhausted: 1,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_catalog_backfill_work",
      expect.objectContaining({
        p_msg_id: poison.msg_id,
        p_backfill_job_id: null,
        p_failure_code: "invalid_message",
      }),
    );
  });
});
