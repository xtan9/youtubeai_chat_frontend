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
  captureAnonymousTrialConversion,
  captureProjectActivityEventWithStatus,
  captureProjectVideoProcessingEvent,
  captureSubscriptionActivated,
} from "../server";

describe("captureAnonymousTrialConversion", () => {
  it("captures a governed server-confirmed conversion without private content", async () => {
    await expect(
      captureAnonymousTrialConversion(
        "user-1",
        "google",
        { app_metadata: { provider: "google" } },
      ),
    ).resolves.toBe("sent");

    expect(mocks.captureImmediate).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "anonymous_trial_converted",
      properties: {
        analytics_schema_version: 1,
        analytics_subject: "human",
        source_surface: "hero_demo",
        registration_method: "google",
      },
    });
  });

  it("suppresses a converted production-probe identity", async () => {
    await expect(
      captureAnonymousTrialConversion("smoke-user", "email", {
        app_metadata: { is_smoke_account: true },
      }),
    ).resolves.toBe("skipped");
    expect(mocks.PostHog).not.toHaveBeenCalled();
  });
});

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
    await expect(captureSubscriptionActivated("user-1", {
      source_surface: "stripe_webhook",
      plan: "monthly",
      billing_interval: "monthly",
      subscription_status: "active",
    })).resolves.toBe("sent");

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
    await expect(captureSubscriptionActivated(
      "smoke-user",
      {
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
      { app_metadata: { is_smoke_account: true } },
    )).resolves.toBe("skipped");

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

    await expect(captureSubscriptionActivated("user-1", {
      source_surface: "stripe_webhook",
      plan: "yearly",
      billing_interval: "yearly",
      subscription_status: "trialing",
    })).resolves.toBe("skipped");

    expect(mocks.PostHog).not.toHaveBeenCalled();
  });

  it("rejects invalid activation attribution before constructing PostHog", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(captureSubscriptionActivated(
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
    )).resolves.toBe("skipped");

    expect(mocks.PostHog).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid subscription discovery event",
      expect.objectContaining({
        errorId: "ANALYTICS_SUBSCRIPTION_DISCOVERY_INVALID",
        event: "subscription_activated",
      }),
    );
  });

  it("reports a failed status when PostHog capture rejects", async () => {
    mocks.captureImmediate.mockRejectedValueOnce(new Error("posthog down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      captureSubscriptionActivated("user-1", {
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      }),
    ).resolves.toBe("failed");
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] server capture failed",
      expect.objectContaining({ errorId: "ANALYTICS_SERVER_CAPTURE_FAILED" }),
    );
  });

  it("uses the same privacy-safe event UUID for activation lease reclaims", async () => {
    const marker = "subscription_activation:user-1:sub-1";
    await captureSubscriptionActivated(
      "user-1",
      {
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
      undefined,
      { activationMarker: marker },
    );
    const first = mocks.captureImmediate.mock.calls[0]?.[0] as { uuid?: string };

    await captureSubscriptionActivated(
      "user-1",
      {
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
      undefined,
      { activationMarker: marker },
    );
    const second = mocks.captureImmediate.mock.calls[1]?.[0] as { uuid?: string };

    expect(first.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second.uuid).toBe(first.uuid);
    expect(first.uuid).not.toContain("user-1");
  });

  it("uses a new UUID for a later billing cycle while deduping that cycle", async () => {
    const firstCycle = "subscription_activation:user-1:sub-1:100-200";
    const secondCycle = "subscription_activation:user-1:sub-1:300-400";
    const properties = {
      source_surface: "stripe_webhook" as const,
      plan: "monthly" as const,
      billing_interval: "monthly" as const,
      subscription_status: "active" as const,
    };

    await captureSubscriptionActivated("user-1", properties, undefined, {
      activationMarker: firstCycle,
    });
    await captureSubscriptionActivated("user-1", properties, undefined, {
      activationMarker: firstCycle,
    });
    await captureSubscriptionActivated("user-1", properties, undefined, {
      activationMarker: secondCycle,
    });

    const uuids = mocks.captureImmediate.mock.calls.map(
      ([event]) => (event as { uuid?: string }).uuid,
    );
    expect(uuids[1]).toBe(uuids[0]);
    expect(uuids[2]).not.toBe(uuids[0]);
  });
});

describe("captureProjectActivityEvent", () => {
  it("sends the corrected activation at its authoritative timestamp", async () => {
    const occurredAt = "2026-08-09T19:59:00.123Z";

    await expect(
      captureProjectActivityEventWithStatus(
        "c0000000-0000-4000-8000-000000000001",
        "project_activated",
        {
          project_id: "a0000000-0000-4000-8000-000000000001",
          activation_kind: "search",
          activation_revision: 2,
          activation_occurred_at: occurredAt,
          ready_videos: 2,
        },
        false,
        "project-activation:a0000000-0000-4000-8000-000000000001:2",
        occurredAt,
      ),
    ).resolves.toBe("sent");

    expect(mocks.captureImmediate).toHaveBeenCalledWith({
      distinctId: "c0000000-0000-4000-8000-000000000001",
      event: "project_activated",
      properties: {
        analytics_schema_version: 1,
        analytics_subject: "human",
        project_id: "a0000000-0000-4000-8000-000000000001",
        activation_kind: "search",
        activation_revision: 2,
        activation_occurred_at: occurredAt,
        ready_videos: 2,
      },
      timestamp: new Date(occurredAt),
      uuid: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });
  });
});

describe("captureProjectVideoProcessingEvent", () => {
  it("captures only the validated governed processing payload", async () => {
    await captureProjectVideoProcessingEvent(
      "user-1",
      "project_video_processing_succeeded",
      {
        project_id: "a0000000-0000-4000-8000-000000000001",
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
        project_id: "a0000000-0000-4000-8000-000000000001",
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
      {
        project_id: "a0000000-0000-4000-8000-000000000001",
        status: "processing",
        ordinal: 1,
        attempt_kind: "new",
      },
      true,
    );

    expect(mocks.PostHog).not.toHaveBeenCalled();
  });
});
