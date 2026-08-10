// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
}));

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

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

  it("captures a schema-validated discovery event with governed attribution", () => {
    captureAnalyticsEvent("subscription_discovery_clicked", {
      source_surface: "global_header",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "mobile",
    });

    expect(mocks.capture).toHaveBeenCalledWith(
      "subscription_discovery_clicked",
      {
        analytics_schema_version: 1,
        source_surface: "global_header",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "mobile",
      },
    );
  });

  it("captures only governed Project-limit counts and enums", () => {
    captureAnalyticsEvent("project_limit_reached", {
      source_surface: "workspace_header",
      tier: "free",
      projects_used: 1,
      projects_limit: 1,
    });

    expect(mocks.capture).toHaveBeenCalledWith("project_limit_reached", {
      analytics_schema_version: 1,
      source_surface: "workspace_header",
      tier: "free",
      projects_used: 1,
      projects_limit: 1,
    });
  });

  it("captures only governed Project Search outcome and coverage counts", () => {
    captureAnalyticsEvent("project_search_completed", {
      project_id: PROJECT_ID,
      source_set_revision: 3,
      outcome: "no_results",
      result_count: 0,
      total_videos: 2,
      ready_videos: 1,
      unavailable_videos: 1,
      passages_examined: 18,
    });

    expect(mocks.capture).toHaveBeenCalledWith("project_search_completed", {
      analytics_schema_version: 1,
      project_id: PROJECT_ID,
      source_set_revision: 3,
      outcome: "no_results",
      result_count: 0,
      total_videos: 2,
      ready_videos: 1,
      unavailable_videos: 1,
      passages_examined: 18,
    });
  });

  it("captures only governed Project Artifact provenance aggregates", () => {
    captureAnalyticsEvent("project_artifact_generation_completed", {
      project_id: PROJECT_ID,
      kind: "study_guide",
      tier: "free",
      source_set_revision: 3,
      evidence_videos: 2,
      evidence_passages: 7,
      generations_used: 1,
    });

    expect(mocks.capture).toHaveBeenCalledWith(
      "project_artifact_generation_completed",
      {
        analytics_schema_version: 1,
        project_id: PROJECT_ID,
        kind: "study_guide",
        tier: "free",
        source_set_revision: 3,
        evidence_videos: 2,
        evidence_passages: 7,
        generations_used: 1,
      },
    );
  });

  it("rejects private Artifact content before transport", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    captureAnalyticsEvent(
      "project_artifact_exported",
      {
        kind: "study_guide",
        format: "markdown",
        content: "private generated Study Guide",
      } as never,
    );

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid Project Artifact event",
      expect.objectContaining({
        errorId: "ANALYTICS_PROJECT_ARTIFACT_INVALID",
        event: "project_artifact_exported",
      }),
    );
  });

  it("rejects Project Search queries and content before transport", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    captureAnalyticsEvent(
      "project_search_completed",
      {
        source_set_revision: 3,
        outcome: "ready",
        result_count: 1,
        total_videos: 1,
        ready_videos: 1,
        unavailable_videos: 0,
        passages_examined: 18,
        query: "private query",
        passage: "private Transcript",
      } as never,
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid Project Search event",
      expect.objectContaining({
        errorId: "ANALYTICS_PROJECT_SEARCH_INVALID",
      }),
    );
  });

  it("rejects private Project metadata before transport", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    captureAnalyticsEvent(
      "project_limit_reached",
      {
        source_surface: "workspace_header",
        tier: "free",
        projects_used: 1,
        projects_limit: 1,
        project_name: "Sensitive research",
        project_goal: "Private goal",
      } as never,
    );

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid Project limit event",
      expect.objectContaining({
        errorId: "ANALYTICS_PROJECT_LIMIT_INVALID",
        event: "project_limit_reached",
      }),
    );
  });

  it("rejects private Video processing metadata before transport", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    captureAnalyticsEvent(
      "project_video_processing_failed",
      {
        status: "failed",
        ordinal: 2,
        error_class: "processing",
        processing_seconds: 4,
        youtube_url: "https://www.youtube.com/watch?v=private0001",
        title: "Private research",
      } as never,
    );

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid Project Video processing event",
      expect.objectContaining({
        errorId: "ANALYTICS_PROJECT_VIDEO_PROCESSING_INVALID",
        event: "project_video_processing_failed",
      }),
    );
  });

  it("rejects invalid discovery attribution before it reaches transport", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    captureAnalyticsEvent(
      "subscription_discovery_clicked",
      {
        source_surface: "sidebar",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "desktop",
      } as never,
    );

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid subscription discovery event",
      expect.objectContaining({
        errorId: "ANALYTICS_SUBSCRIPTION_DISCOVERY_INVALID",
        event: "subscription_discovery_clicked",
      }),
    );
  });

  it("rejects an invalid event name before it reaches transport", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    captureAnalyticsEvent("upgrade_clicked" as never, {} as never);

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[analytics] invalid event name",
      expect.objectContaining({
        errorId: "ANALYTICS_EVENT_NAME_INVALID",
        event: "upgrade_clicked",
      }),
    );
  });

  it("suppresses governed discovery events for a synthetic identity", () => {
    setBusinessAnalyticsCaptureSuppressed(true);

    captureAnalyticsEvent("subscription_discovery_viewed", {
      source_surface: "direct_pricing",
      presentation_state: "pricing",
      authentication_state: "anonymous_session",
      device_class: "desktop",
    });

    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
