import { describe, expect, it } from "vitest";
import {
  ProjectActivityEventSchema,
  validateProjectActivityEvent,
} from "../project-activity";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

describe("Project activity analytics privacy contract", () => {
  it("accepts the exact stable Project return key without private metadata", () => {
    expect(
      ProjectActivityEventSchema.parse({
        event: "project_opened",
        properties: { project_id: PROJECT_ID },
      }),
    ).toEqual({
      event: "project_opened",
      properties: { project_id: PROJECT_ID },
    });
  });

  it.each([
    ["name", "Private research"],
    ["project_name", "Private research"],
    ["goal", "Investigate a private hypothesis"],
    ["project_goal", "Investigate a private hypothesis"],
    ["title", "Sensitive Video"],
    ["video_title", "Sensitive Video"],
    ["channel", "Sensitive channel"],
    ["channel_name", "Sensitive channel"],
    ["url", "https://www.youtube.com/watch?v=private0001"],
    ["youtube_url", "https://www.youtube.com/watch?v=private0001"],
    ["query", "private search"],
    ["prompt", "private prompt"],
    ["answer", "private answer"],
    ["transcript", "private Transcript passage"],
    ["transcript_passage", "private Transcript passage"],
    ["artifact", "private generated Artifact"],
    ["artifact_content", "private generated Artifact"],
  ])("rejects prohibited payload field %s", (field, value) => {
    expect(
      validateProjectActivityEvent("project_opened", {
        project_id: PROJECT_ID,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("keeps first and subsequent message kinds coherent with bounded ordinals", () => {
    expect(
      validateProjectActivityEvent("project_message_sent", {
        project_id: PROJECT_ID,
        message_ordinal: 1,
        message_kind: "subsequent",
        tier: "free",
        mode: "question",
      }).success,
    ).toBe(false);
    expect(
      validateProjectActivityEvent("project_message_sent", {
        project_id: PROJECT_ID,
        message_ordinal: 2,
        message_kind: "subsequent",
        tier: "pro",
        mode: "compare_viewpoints",
      }).success,
    ).toBe(true);
  });

  it("accepts strict, content-free citation identities for answers and Artifacts", () => {
    expect(
      validateProjectActivityEvent("project_citation_clicked", {
        project_id: PROJECT_ID,
        citation_context: "grounded_answer",
        answer_id: "b0000000-0000-4000-8000-000000000001",
        message_ordinal: 7,
        citation_ordinal: 2,
        source_ordinal: 1,
        timestamp_seconds: 42,
      }).success,
    ).toBe(true);
    expect(
      validateProjectActivityEvent("project_citation_clicked", {
        project_id: PROJECT_ID,
        citation_context: "artifact",
        artifact_id: "c0000000-0000-4000-8000-000000000001",
        artifact_kind: "creator_brief",
        citation_ordinal: 3,
        source_ordinal: 2,
        timestamp_seconds: 84,
      }).success,
    ).toBe(true);
    expect(
      validateProjectActivityEvent("project_citation_clicked", {
        project_id: PROJECT_ID,
        citation_context: "artifact",
        artifact_id: "c0000000-0000-4000-8000-000000000001",
        artifact_kind: "study_guide",
        citation_ordinal: 3,
        source_ordinal: 2,
        timestamp_seconds: 84,
        artifact_content: "private guide",
      }).success,
    ).toBe(false);
  });

  it("never accepts estimated token counts when provider usage is unavailable", () => {
    expect(
      validateProjectActivityEvent("project_generation_cost_recorded", {
        project_id: PROJECT_ID,
        generation_kind: "grounded_answer",
        model_id: "gpt-5.3-codex-spark",
        provider_kind: "cliproxyapi",
        cost_status: "unavailable",
        error_class: "usage_unavailable",
        duration_ms: 200,
        input_tokens: 123,
        cached_input_tokens: 0,
        output_tokens: 45,
      }).success,
    ).toBe(false);
  });

  it("accepts content-free Project Brief citation and generation telemetry", () => {
    expect(
      validateProjectActivityEvent("project_citation_clicked", {
        project_id: PROJECT_ID,
        citation_context: "artifact",
        artifact_id: "c0000000-0000-4000-8000-000000000001",
        artifact_kind: "project_brief",
        citation_ordinal: 1,
        source_ordinal: 1,
        timestamp_seconds: 42,
      }).success,
    ).toBe(true);
    expect(
      validateProjectActivityEvent("project_generation_cost_recorded", {
        project_id: PROJECT_ID,
        generation_kind: "project_brief",
        model_id: "gpt-5.3-codex-spark",
        provider_kind: "cliproxyapi",
        cost_status: "unavailable",
        error_class: "usage_unavailable",
        duration_ms: 200,
      }).success,
    ).toBe(true);
  });

  it("accepts a content-free source-processing paywall view", () => {
    expect(
      validateProjectActivityEvent("project_paywall_viewed", {
        project_id: PROJECT_ID,
        paywall_kind: "source_processing",
        tier: "free",
      }).success,
    ).toBe(true);
  });
});
