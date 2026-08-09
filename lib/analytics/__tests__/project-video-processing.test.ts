import { describe, expect, it } from "vitest";
import {
  isProjectVideoProcessingEventName,
  validateProjectVideoProcessingEvent,
} from "../project-video-processing";

describe("Project Video processing analytics", () => {
  it("accepts only governed lifecycle enums, ordinals, and timing", () => {
    expect(
      validateProjectVideoProcessingEvent(
        "project_video_processing_succeeded",
        {
          status: "ready",
          ordinal: 3,
          result_origin: "cache",
          transcription_seconds: 1.25,
          summary_seconds: 0.5,
          total_seconds: 1.75,
        },
      ),
    ).toMatchObject({ success: true });
    expect(
      isProjectVideoProcessingEventName("project_video_processing_failed"),
    ).toBe(true);
  });

  it("rejects URL, title, transcript, Project IDs, and free-form failures", () => {
    for (const privateProperty of [
      { youtube_url: "https://www.youtube.com/watch?v=private0001" },
      { title: "Private interview" },
      { transcript: "Private transcript" },
      { project_id: "private-project" },
      { failure_message: "provider leaked a URL" },
    ]) {
      expect(
        validateProjectVideoProcessingEvent(
          "project_video_processing_failed",
          {
            status: "failed",
            ordinal: 1,
            error_class: "processing",
            processing_seconds: 2,
            ...privateProperty,
          },
        ),
      ).toMatchObject({ success: false });
    }
  });

  it("rejects out-of-range ordinals and ungoverned outcome values", () => {
    expect(
      validateProjectVideoProcessingEvent(
        "project_video_processing_started",
        { status: "processing", ordinal: 6, attempt_kind: "new" },
      ),
    ).toMatchObject({ success: false });
    expect(
      validateProjectVideoProcessingEvent(
        "project_video_processing_failed",
        {
          status: "failed",
          ordinal: 1,
          error_class: "provider_secret",
          processing_seconds: 1,
        },
      ),
    ).toMatchObject({ success: false });
  });
});
