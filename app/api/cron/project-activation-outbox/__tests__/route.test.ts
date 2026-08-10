import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  drainProjectActivationOutbox: vi.fn(),
}));

vi.mock("@/lib/analytics/project-server", () => ({
  drainProjectActivationOutbox: mocks.drainProjectActivationOutbox,
}));

import { GET } from "../route";

describe("GET /api/cron/project-activation-outbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", "cron-secret-with-16-characters");
  });

  it("drains durable activation exports only for the Vercel cron identity", async () => {
    mocks.drainProjectActivationOutbox.mockResolvedValue({
      claimed: 2,
      sent: 2,
      pending: 0,
      unavailable: false,
    });

    const response = await GET(
      new Request("https://youtubeai.chat/api/cron/project-activation-outbox", {
        headers: {
          Authorization: "Bearer cron-secret-with-16-characters",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimed: 2,
      sent: 2,
      pending: 0,
    });
    expect(mocks.drainProjectActivationOutbox).toHaveBeenCalledWith(100);
  });

  it.each([
    ["a missing secret", undefined, undefined],
    [
      "a missing authorization header",
      "cron-secret-with-16-characters",
      undefined,
    ],
    [
      "the wrong bearer token",
      "cron-secret-with-16-characters",
      "Bearer wrong-secret",
    ],
    ["a short configured secret", "too-short", "Bearer too-short"],
  ])("fails closed for %s", async (_case, secret, authorization) => {
    vi.stubEnv("CRON_SECRET", secret ?? "");
    const headers = authorization ? { Authorization: authorization } : undefined;

    const response = await GET(
      new Request("https://youtubeai.chat/api/cron/project-activation-outbox", {
        headers,
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.drainProjectActivationOutbox).not.toHaveBeenCalled();
  });

  it("returns retryable unavailable without exposing the drain error", async () => {
    mocks.drainProjectActivationOutbox.mockResolvedValue({
      claimed: 0,
      sent: 0,
      pending: 0,
      unavailable: true,
    });

    const response = await GET(
      new Request("https://youtubeai.chat/api/cron/project-activation-outbox", {
        headers: {
          Authorization: "Bearer cron-secret-with-16-characters",
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      claimed: 0,
      sent: 0,
      pending: 0,
    });
  });
});
