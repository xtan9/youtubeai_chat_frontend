import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  logAppEvent: vi.fn(),
}));

vi.mock("@/lib/services/video-chat-history", () => ({
  cleanupInactiveAnonymousDemoConversations: mocks.cleanup,
}));
vi.mock("@/lib/observability", () => ({ logAppEvent: mocks.logAppEvent }));

import { GET } from "../route";

describe("GET /api/cron/hero-demo-conversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", "cron-secret-with-16-characters");
  });

  it("runs one bounded cleanup for the authenticated cron identity", async () => {
    mocks.cleanup.mockResolvedValue({ deletedConversations: 12 });

    const response = await GET(
      new Request("https://youtubeai.chat/api/cron/hero-demo-conversations", {
        headers: { Authorization: "Bearer cron-secret-with-16-characters" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedConversations: 12 });
    expect(mocks.cleanup).toHaveBeenCalledWith(500);
    expect(mocks.logAppEvent).toHaveBeenCalledWith(
      "info",
      "[hero-demo-conversations] retention cleanup complete",
      { count: 12 },
    );
  });

  it.each([
    ["missing secret", "", undefined],
    ["short secret", "too-short", "Bearer too-short"],
    ["missing bearer", "cron-secret-with-16-characters", undefined],
    ["wrong bearer", "cron-secret-with-16-characters", "Bearer wrong"],
  ])("fails closed for %s", async (_case, secret, authorization) => {
    vi.stubEnv("CRON_SECRET", secret);
    const response = await GET(
      new Request("https://youtubeai.chat/api/cron/hero-demo-conversations", {
        headers: authorization ? { Authorization: authorization } : undefined,
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("returns retryable unavailable and records only the error class", async () => {
    mocks.cleanup.mockRejectedValue(new Error("database private detail"));
    const response = await GET(
      new Request("https://youtubeai.chat/api/cron/hero-demo-conversations", {
        headers: { Authorization: "Bearer cron-secret-with-16-characters" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ deletedConversations: 0 });
    expect(mocks.logAppEvent).toHaveBeenCalledWith(
      "error",
      "[hero-demo-conversations] retention cleanup failed",
      { errorId: "HERO_DEMO_RETENTION_CLEANUP_FAILED", errorName: "Error" },
    );
  });
});
