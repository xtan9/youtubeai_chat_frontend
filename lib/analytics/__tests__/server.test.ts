import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureImmediate: vi.fn(),
  shutdown: vi.fn(),
  PostHog: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: mocks.PostHog,
}));

import { ANALYTICS_SUBJECT_PROPERTY, ANALYTICS_SYNTHETIC_SUBJECT } from "../identity";
import {
  captureProjectVideoProcessingEvent,
  captureSubscriptionActivated,
} from "../server";

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
        [ANALYTICS_SUBJECT_PROPERTY]: "human",
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
    });
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it("suppresses a trusted Smoke Account before constructing the PostHog client", async () => {
    await captureSubscriptionActivated(
      "smoke-user",
      {
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
      { app_metadata: { is_smoke_account: true } },
    );

    expect(mocks.PostHog).not.toHaveBeenCalled();
    expect(mocks.captureImmediate).not.toHaveBeenCalled();
  });

  it("captures governed discovery attribution without changing the event name", async () => {
    await captureSubscriptionActivated("user-1", {
      source_surface: "global_header",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "mobile",
      plan: "yearly",
      billing_interval: "yearly",
      subscription_status: "active",
    });

    expect(mocks.captureImmediate).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "subscription_activated",
      properties: expect.objectContaining({
        source_surface: "global_header",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "mobile",
      }),
    });
  });

  it("does not trust user-editable metadata for server suppression", async () => {
    await captureSubscriptionActivated(
      "human-user",
      {
        source_surface: "stripe_webhook",
        plan: "yearly",
        billing_interval: "yearly",
        subscription_status: "trialing",
      },
      {
        app_metadata: {},
        user_metadata: { is_smoke_account: true },
      },
    );

    expect(mocks.captureImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "human-user",
        properties: expect.objectContaining({
          [ANALYTICS_SUBJECT_PROPERTY]: "human",
        }),
      }),
    );
    expect(ANALYTICS_SYNTHETIC_SUBJECT).toBe("synthetic_smoke_account");
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

  it("rejects invalid activation attribution before constructing PostHog", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await captureSubscriptionActivated(
      "user-1",
      {
        source_surface: "global_header",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "smart_tv",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      } as never,
    );

    expect(mocks.PostHog).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid subscription discovery event",
      expect.objectContaining({
        errorId: "ANALYTICS_SUBSCRIPTION_DISCOVERY_INVALID",
        event: "subscription_activated",
      }),
    );
  });
});

describe("captureProjectVideoProcessingEvent", () => {
  it("captures only the validated governed processing payload", async () => {
    await captureProjectVideoProcessingEvent(
      "user-1",
      "project_video_processing_succeeded",
      {
        status: "ready",
        ordinal: 2,
        result_origin: "generated",
        transcription_seconds: 3,
        summary_seconds: 4,
        total_seconds: 7,
      },
    );

    expect(mocks.captureImmediate).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "project_video_processing_succeeded",
      properties: {
        analytics_schema_version: 1,
        analytics_subject: "human",
        status: "ready",
        ordinal: 2,
        result_origin: "generated",
        transcription_seconds: 3,
        summary_seconds: 4,
        total_seconds: 7,
      },
    });
  });

  it("rejects private processing properties before PostHog", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await captureProjectVideoProcessingEvent(
      "user-1",
      "project_video_processing_failed",
      {
        status: "failed",
        ordinal: 1,
        error_class: "processing",
        processing_seconds: 2,
        transcript: "private",
      } as never,
    );

    expect(mocks.PostHog).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid Project Video processing event",
      expect.objectContaining({
        errorId: "ANALYTICS_PROJECT_VIDEO_PROCESSING_INVALID",
      }),
    );
  });

  it("suppresses a trusted synthetic processing event", async () => {
    await captureProjectVideoProcessingEvent(
      "smoke-user",
      "project_video_processing_started",
      { status: "processing", ordinal: 1, attempt_kind: "new" },
      true,
    );

    expect(mocks.PostHog).not.toHaveBeenCalled();
  });
});
