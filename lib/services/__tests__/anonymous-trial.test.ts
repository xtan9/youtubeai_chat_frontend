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
  getAnonymousTrialChatAllowance,
  refundAnonymousTrialChatMessage,
  reserveAnonymousTrialChatMessage,
} from "../anonymous-trial";

describe("Anonymous Trial service boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ANONYMOUS_TRIAL_KILL_SWITCH", "false");
    vi.stubEnv(
      "ANONYMOUS_TRIAL_NETWORK_HMAC_SECRET",
      "a-required-server-secret-with-enough-entropy",
    );
    vi.stubEnv("ANONYMOUS_TRIAL_GLOBAL_24H_SPEND_LIMIT_MICROS", "50000");
    vi.stubEnv("ANONYMOUS_TRIAL_RESERVATION_COST_MICROS", "1000");
    mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
  });

  function request(): Request {
    return new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
  }

  it("reads only the authoritative content-free allowance RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "available", remainingMessages: 4 },
      error: null,
    });

    await expect(
      getAnonymousTrialChatAllowance({
        userId: "74000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toEqual({ outcome: "available", remainingMessages: 4 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_anonymous_trial_chat_allowance",
      { p_user_id: "74000000-0000-4000-8000-000000000001" },
    );
  });

  it("fails closed on malformed allowance data", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "available", remainingMessages: 6 },
      error: null,
    });

    await expect(
      getAnonymousTrialChatAllowance({
        userId: "74000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
  });

  it("validates an admitted reservation and preserves its opaque ID", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "admitted",
        reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
        remainingMessages: 3,
      },
      error: null,
    });

    await expect(
      reserveAnonymousTrialChatMessage({
        userId: "74000000-0000-4000-8000-000000000001",
        request: request(),
      }),
    ).resolves.toEqual({
      outcome: "admitted",
      reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
      remainingMessages: 3,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "reserve_anonymous_trial_chat_message",
      {
        p_user_id: "74000000-0000-4000-8000-000000000001",
        p_network_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_global_spend_limit_micros: "50000",
        p_reservation_cost_micros: "1000",
        p_admission_enabled: "true",
      },
    );
  });

  it("fails closed before the RPC when the required kill switch is absent", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_KILL_SWITCH", "");

    await expect(
      reserveAnonymousTrialChatMessage({
        userId: "74000000-0000-4000-8000-000000000001",
        request: request(),
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["network_limited", "concurrent", "global_shutdown"] as const)(
    "preserves the stable %s denial",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({
        data: { outcome, remainingMessages: 4 },
        error: null,
      });

      await expect(
        reserveAnonymousTrialChatMessage({
          userId: "74000000-0000-4000-8000-000000000001",
          request: request(),
        }),
      ).resolves.toEqual({ outcome, remainingMessages: 4 });
    },
  );

  it("accepts durable expiry reconciliation with the current allowance", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "expired", remainingMessages: 4 },
      error: null,
    });

    await expect(
      refundAnonymousTrialChatMessage({
        userId: "74000000-0000-4000-8000-000000000001",
        reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
      }),
    ).resolves.toEqual({ outcome: "expired", remainingMessages: 4 });
  });
});
