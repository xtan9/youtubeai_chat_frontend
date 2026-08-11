import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getServiceRoleClient: vi.fn(),
  logAppEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));
vi.mock("@/lib/observability", () => ({ logAppEvent: mocks.logAppEvent }));
vi.mock("server-only", () => ({}));

import {
  admitRegisteredFreeHeroDemoChatMessage,
  getRegisteredFreeHeroDemoChatAllowance,
} from "../registered-free-hero-demo";

describe("Registered Free Hero Demo allowance boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("returns the authoritative allowance for one canonical demo", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "available", remainingMessages: 3 },
      error: null,
    });

    await expect(
      getRegisteredFreeHeroDemoChatAllowance({
        userId: "75000000-0000-4000-8000-000000000001",
        youtubeVideoId: "Hrbq66XqtCo",
      }),
    ).resolves.toEqual({ outcome: "available", remainingMessages: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_registered_free_hero_demo_chat_allowance",
      {
        p_user_id: "75000000-0000-4000-8000-000000000001",
        p_youtube_video_id: "Hrbq66XqtCo",
      },
    );
  });

  it("admits through the atomic RPC and preserves its authoritative remaining value", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "admitted", remainingMessages: 0 },
      error: null,
    });

    await expect(
      admitRegisteredFreeHeroDemoChatMessage({
        userId: "75000000-0000-4000-8000-000000000001",
        youtubeVideoId: "Hrbq66XqtCo",
      }),
    ).resolves.toEqual({ outcome: "admitted", remainingMessages: 0 });
  });

  it("fails closed on an RPC error or malformed result", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "08006" } })
      .mockResolvedValueOnce({
        data: { outcome: "admitted", remainingMessages: 8 },
        error: null,
      });

    const input = {
      userId: "75000000-0000-4000-8000-000000000001",
      youtubeVideoId: "Hrbq66XqtCo",
    };
    await expect(admitRegisteredFreeHeroDemoChatMessage(input)).resolves.toEqual({
      outcome: "unavailable",
    });
    await expect(admitRegisteredFreeHeroDemoChatMessage(input)).resolves.toEqual({
      outcome: "unavailable",
    });
  });
});
