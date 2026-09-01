import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getServiceRoleClient: vi.fn(),
    runCatalogBackfillWorker: vi.fn(),
    runCatalogAdmissionMaintenance: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("../catalog-backfill", () => ({
  runCatalogBackfillWorker: mocks.runCatalogBackfillWorker,
}));

vi.mock("../catalog-admission-worker", () => ({
  runCatalogAdmissionMaintenance: mocks.runCatalogAdmissionMaintenance,
}));

import { runVideoCatalogMaintenance } from "../video-catalog-maintenance";

describe("runVideoCatalogMaintenance", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.getServiceRoleClient.mockReset();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.runCatalogBackfillWorker.mockReset();
    mocks.runCatalogAdmissionMaintenance.mockReset();

    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "read_catalog_processing_configuration") {
        return {
          data: [
            {
              workType: "catalog_backfill",
              policyVersion: "catalog-backfill-v1",
              batchSize: 7,
              concurrency: 1,
              maxAttempts: 6,
              baseBackoffSeconds: 45,
              visibilityTimeoutSeconds: 180,
            },
          ],
          error: null,
        };
      }
      if (name === "schedule_catalog_backfill") {
        return { data: { outcome: "scheduled", scheduled: 2 }, error: null };
      }
      if (name === "purge_catalog_audit") {
        return { data: { outcome: "purged", purgedSets: 1 }, error: null };
      }
      if (name === "read_catalog_operational_metrics") {
        return { data: { queues: [], budgets: [] }, error: null };
      }
      return { data: { outcome: "recorded" }, error: null };
    });
    mocks.runCatalogBackfillWorker.mockResolvedValue({
      claimed: 2,
      nominated: 1,
      alreadyEnqueued: 1,
      skipped: 0,
      retried: 0,
      exhausted: 0,
    });
    mocks.runCatalogAdmissionMaintenance.mockResolvedValue({
      invalidated: 1,
      scheduled: 1,
      claimed: 1,
      completed: 1,
      retried: 0,
      exhausted: 0,
    });
  });

  it("uses the persisted backfill policy and records content-free outcomes", async () => {
    await expect(runVideoCatalogMaintenance()).resolves.toMatchObject({
      backfill: {
        scheduled: 2,
        claimed: 2,
        nominated: 1,
      },
      catalogAdmission: { invalidated: 1, completed: 1 },
      purge: { purgedSets: 1 },
      metrics: { queues: [] },
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "read_catalog_processing_configuration",
      {},
    );
    expect(mocks.rpc).toHaveBeenCalledWith("schedule_catalog_backfill", {
      p_batch_size: 7,
    });
    expect(mocks.runCatalogBackfillWorker).toHaveBeenCalledWith({
      batchSize: 7,
      concurrency: 1,
      maxAttempts: 6,
      baseRetryDelaySeconds: 45,
      visibilityTimeoutSeconds: 180,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("record_catalog_worker_outcome", {
      p_worker_kind: "catalog_backfill",
      p_claimed: 2,
      p_completed: 2,
      p_nominated: 1,
      p_already_enqueued: 1,
      p_skipped: 0,
      p_deferred: 0,
      p_obsolete: 0,
      p_retried: 0,
      p_exhausted: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("purge_catalog_audit", {
      p_batch_size: 100,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "read_catalog_operational_metrics",
      {},
    );
  });
});
