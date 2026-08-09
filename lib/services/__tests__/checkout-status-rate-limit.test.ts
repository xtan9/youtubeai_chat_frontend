import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import {
  CHECKOUT_STATUS_RATE_LIMIT_PER_MINUTE,
  checkCheckoutStatusRateLimit,
} from "../checkout-status-rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-09T07:42:31.000Z"));
  mocks.getServiceRoleClient.mockReset();
  mocks.rpc.mockReset();
  mocks.getServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("checkCheckoutStatusRateLimit", () => {
  it("uses a route-specific counter instead of consuming product quota", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    await expect(checkCheckoutStatusRateLimit("user-1")).resolves.toEqual({
      allowed: true,
      reason: "within_limit",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("increment_rate_limit", {
      p_user_id: "billing_checkout_status:user-1",
      p_window_start: "2026-08-09T07:42:00.000Z",
    });
  });

  it("throttles reads above the checkout-status allowance", async () => {
    mocks.rpc.mockResolvedValue({
      data: CHECKOUT_STATUS_RATE_LIMIT_PER_MINUTE + 1,
      error: null,
    });

    await expect(checkCheckoutStatusRateLimit("user-1")).resolves.toEqual({
      allowed: false,
      reason: "exceeded",
    });
  });

  it("fails closed in production when the abuse boundary is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getServiceRoleClient.mockReturnValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(checkCheckoutStatusRateLimit("user-1")).resolves.toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });
});
