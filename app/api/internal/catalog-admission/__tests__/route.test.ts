import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: { runCatalogAdmissionWorker: vi.fn() },
}));

vi.mock("@/lib/catalog/catalog-admission-worker", () => ({
  runCatalogAdmissionWorker: mocks.runCatalogAdmissionWorker,
}));

import { GET } from "../route";

function request(token?: string) {
  return new Request("https://app.test/api/internal/catalog-admission", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/internal/catalog-admission", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.runCatalogAdmissionWorker.mockReset();
    vi.stubEnv("CRON_SECRET", "worker-secret");
    mocks.runCatalogAdmissionWorker.mockResolvedValue({
      claimed: 1,
      completed: 1,
      retried: 0,
      exhausted: 0,
    });
  });

  it("rejects a browser request without worker authentication", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.runCatalogAdmissionWorker).not.toHaveBeenCalled();
  });

  it("fails closed when worker authentication is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request("anything"));
    expect(response.status).toBe(503);
    expect(mocks.runCatalogAdmissionWorker).not.toHaveBeenCalled();
  });

  it("runs one bounded worker batch for the authenticated scheduler", async () => {
    const response = await GET(request("worker-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      exhausted: 0,
    });
    expect(mocks.runCatalogAdmissionWorker).toHaveBeenCalledOnce();
  });
});
