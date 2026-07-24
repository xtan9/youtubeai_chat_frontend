// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: mocks.capture,
  },
}));

import { captureAnalyticsEvent } from "../client";

beforeEach(() => {
  mocks.capture.mockReset();
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
});
