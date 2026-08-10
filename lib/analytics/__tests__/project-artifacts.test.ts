import { describe, expect, it } from "vitest";
import {
  ProjectArtifactEventSchema,
  validateProjectArtifactEvent,
} from "../project-artifacts";

describe("Project Artifact analytics privacy contract", () => {
  it("accepts only bounded Artifact generation and provenance aggregates", () => {
    const properties = {
      project_id: "10000000-0000-4000-8000-000000000001",
      kind: "study_guide" as const,
      tier: "free" as const,
      source_set_revision: 4,
      evidence_videos: 2,
      evidence_passages: 8,
      generations_used: 1,
    };

    expect(
      validateProjectArtifactEvent(
        "project_artifact_generation_completed",
        properties,
      ),
    ).toEqual({ success: true, properties });
  });

  it.each([
    ["project_artifact_generation_requested", {
      project_id: "10000000-0000-4000-8000-000000000001",
      kind: "study_guide",
      tier: "pro",
      is_regeneration: true,
    }],
    ["project_artifact_generation_blocked", {
      project_id: "10000000-0000-4000-8000-000000000001",
      kind: "study_guide",
      tier: "free",
      failure_category: "quota",
    }],
    ["project_artifact_exported", {
      project_id: "10000000-0000-4000-8000-000000000001",
      kind: "creator_brief",
      format: "markdown",
    }],
  ] as const)("accepts governed %s events", (event, properties) => {
    expect(validateProjectArtifactEvent(event, properties)).toEqual({
      success: true,
      properties,
    });
  });

  it.each([
    { artifact_id: "20000000-0000-4000-8000-000000000001" },
    { project_name: "Private research" },
    { project_goal: "Private goal" },
    { content: "Generated Study Guide" },
    { passage: "Exact Transcript content" },
    { citation: "[S1 @ 00:42]" },
    { video_title: "Private Video title" },
    { model: "provider-specific-private-value" },
  ])("rejects private or content-bearing fields: %j", (extra) => {
    expect(
      ProjectArtifactEventSchema.safeParse({
        event: "project_artifact_generation_completed",
        properties: {
          project_id: "10000000-0000-4000-8000-000000000001",
          kind: "study_guide",
          tier: "free",
          source_set_revision: 4,
          evidence_videos: 2,
          evidence_passages: 8,
          generations_used: 1,
          ...extra,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported kinds, formats, categories, and unbounded counts", () => {
    expect(
      validateProjectArtifactEvent("project_artifact_exported", {
        project_id: "10000000-0000-4000-8000-000000000001",
        kind: "transcript",
        format: "pdf",
      }).success,
    ).toBe(false);
    expect(
      validateProjectArtifactEvent("project_artifact_generation_blocked", {
        project_id: "10000000-0000-4000-8000-000000000001",
        kind: "study_guide",
        tier: "free",
        failure_category: "provider_secret",
      }).success,
    ).toBe(false);
    expect(
      validateProjectArtifactEvent(
        "project_artifact_generation_completed",
        {
          project_id: "10000000-0000-4000-8000-000000000001",
          kind: "study_guide",
          tier: "free",
          source_set_revision: 4,
          evidence_videos: 6,
          evidence_passages: 8,
          generations_used: 1,
        },
      ).success,
    ).toBe(false);
  });
});
