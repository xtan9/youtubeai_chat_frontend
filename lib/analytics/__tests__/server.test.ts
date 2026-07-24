import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureImmediate: vi.fn(),
  shutdown: vi.fn(),
  PostHog: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: mocks.PostHog,
}));

import { captureSubscriptionActivated } from "../server";

beforeEach(() => {
  mocks.captureImmediate.mockReset().mockResolvedValue(undefined);
  mocks.shutdown.mockReset().mockResolvedValue(undefined);
  mocks.PostHog.mockReset().mockImplementation(function PostHogMock() {
    return {
      captureImmediate: mocks.captureImmediate,
      shutdown: mocks.shutdown,
    };
  });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("captureSubscriptionActivated", () => {
  it("captures the server-confirmed activation using the shared person ID", async () => {
    await captureSubscriptionActivated("user-1", {
      source_surface: "stripe_webhook",
      plan: "monthly",
      billing_interval: "monthly",
      subscription_status: "active",
    });

    expect(mocks.captureImmediate).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "subscription_activated",
      properties: {
        analytics_schema_version: 1,
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
    });
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");

    await captureSubscriptionActivated("user-1", {
      source_surface: "stripe_webhook",
      plan: "yearly",
      billing_interval: "yearly",
      subscription_status: "trialing",
    });

    expect(mocks.PostHog).not.toHaveBeenCalled();
  });
});
