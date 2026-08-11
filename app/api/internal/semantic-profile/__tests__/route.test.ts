import { afterEach, describe, expect, it, vi } from "vitest";

const { runSemanticProfileWorker } = vi.hoisted(() => ({
  runSemanticProfileWorker: vi.fn(),
}));

vi.mock("@/lib/catalog/semantic-profile-worker", () => ({
  runSemanticProfileWorker,
}));

import { GET } from "../route";

describe("GET /api/internal/semantic-profile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    runSemanticProfileWorker.mockReset();
  });

  it("fails closed when the cron secret is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(new Request("http://localhost/api/internal/semantic-profile"));
    expect(response.status).toBe(503);
    expect(runSemanticProfileWorker).not.toHaveBeenCalled();
  });

  it("rejects an invalid Authorization header", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const response = await GET(
      new Request("http://localhost/api/internal/semantic-profile", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(response.status).toBe(401);
    expect(runSemanticProfileWorker).not.toHaveBeenCalled();
  });

  it("runs only for the exact server-side cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    runSemanticProfileWorker.mockResolvedValue({
      claimed: 1,
      completed: 1,
      deferred: 0,
      obsolete: 0,
      retried: 0,
      exhausted: 0,
    });
    const response = await GET(
      new Request("http://localhost/api/internal/semantic-profile", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ completed: 1 });
    expect(runSemanticProfileWorker).toHaveBeenCalledOnce();
  });

  it("returns a bounded failure without exposing provider details", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    runSemanticProfileWorker.mockRejectedValue(new Error("provider secret"));
    const response = await GET(
      new Request("http://localhost/api/internal/semantic-profile", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Worker failed" });
  });
});
