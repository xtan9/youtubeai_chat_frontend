import { afterEach, describe, expect, it, vi } from "vitest";

const { runVideoCatalogMaintenance } = vi.hoisted(() => ({
  runVideoCatalogMaintenance: vi.fn(),
}));

vi.mock("@/lib/catalog/video-catalog-maintenance", () => ({
  runVideoCatalogMaintenance,
}));

import { GET } from "../route";

describe("GET /api/internal/video-catalog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    runVideoCatalogMaintenance.mockReset();
  });

  it("fails closed when the scheduler secret is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(new Request("http://localhost/api/internal/video-catalog"));
    expect(response.status).toBe(503);
    expect(runVideoCatalogMaintenance).not.toHaveBeenCalled();
  });

  it("rejects browser requests without the exact scheduler secret", async () => {
    vi.stubEnv("CRON_SECRET", "catalog-secret");
    const response = await GET(
      new Request("http://localhost/api/internal/video-catalog", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(response.status).toBe(401);
    expect(runVideoCatalogMaintenance).not.toHaveBeenCalled();
  });

  it("runs the bounded catalog backfill, refresh, purge, and metrics cycle", async () => {
    vi.stubEnv("CRON_SECRET", "catalog-secret");
    runVideoCatalogMaintenance.mockResolvedValue({
      backfill: { scheduled: 2, claimed: 2, nominated: 2 },
      catalogAdmission: { invalidated: 1, scheduled: 1, claimed: 1, completed: 1 },
      purge: { outcome: "purged" },
      metrics: { queues: [] },
    });

    const response = await GET(
      new Request("http://localhost/api/internal/video-catalog", {
        headers: { authorization: "Bearer catalog-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      backfill: { scheduled: 2 },
      catalogAdmission: { invalidated: 1 },
    });
    expect(runVideoCatalogMaintenance).toHaveBeenCalledOnce();
  });

  it("does not expose maintenance errors", async () => {
    vi.stubEnv("CRON_SECRET", "catalog-secret");
    runVideoCatalogMaintenance.mockRejectedValue(new Error("provider secret"));
    const response = await GET(
      new Request("http://localhost/api/internal/video-catalog", {
        headers: { authorization: "Bearer catalog-secret" },
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Worker failed" });
  });
});
