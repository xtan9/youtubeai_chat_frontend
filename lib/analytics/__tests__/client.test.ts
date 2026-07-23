// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: mocks.capture,
    reset: mocks.reset,
  },
}));

import {
  captureAnalyticsEvent,
  resetAnalyticsIdentity,
} from "../client";

beforeEach(() => {
  mocks.capture.mockReset();
  mocks.reset.mockReset();
});

describe("client analytics", () => {
  it("adds the schema version to typed funnel events", () => {
    captureAnalyticsEvent("checkout_started", {
      account_type: "free",
      source_surface: "pricing",
      plan: "yearly",
      billing_interval: "yearly",
    });

    expect(mocks.capture).toHaveBeenCalledWith("checkout_started", {
      analytics_schema_version: 1,
      account_type: "free",
      source_surface: "pricing",
      plan: "yearly",
      billing_interval: "yearly",
    });
  });

  it("resets the PostHog identity", () => {
    resetAnalyticsIdentity();
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });
});
