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

import {
  captureAnalyticsEvent,
  setBusinessAnalyticsCaptureSuppressed,
} from "../client";

beforeEach(() => {
  mocks.capture.mockReset();
  setBusinessAnalyticsCaptureSuppressed(false);
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

  it("does not emit business events while the client identity is synthetic", () => {
    setBusinessAnalyticsCaptureSuppressed(true);

    captureAnalyticsEvent("checkout_started", {
      account_type: "free",
      source_surface: "pricing",
      plan: "monthly",
      billing_interval: "monthly",
    });

    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("resumes business events after synthetic suppression is cleared", () => {
    setBusinessAnalyticsCaptureSuppressed(true);
    setBusinessAnalyticsCaptureSuppressed(false);

    captureAnalyticsEvent("checkout_started", {
      account_type: "free",
      source_surface: "pricing",
      plan: "monthly",
      billing_interval: "monthly",
    });

    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});
