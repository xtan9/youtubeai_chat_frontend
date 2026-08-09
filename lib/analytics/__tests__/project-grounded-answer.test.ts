import { describe, expect, it } from "vitest";
import {
  ProjectGroundedAnswerEventSchema,
  validateProjectGroundedAnswerEvent,
} from "../project-grounded-answer";

const SAFE_PROPERTIES = {
  classification: "supported" as const,
  source_set_revision: 4,
  total_videos: 4,
  ready_videos: 3,
  evidence_videos: 2,
  unavailable_videos: 1,
  passages_examined: 48,
  evidence_passages: 8,
  citation_diagnostics: 2,
};

describe("Project Grounded Answer analytics privacy contract", () => {
  it("accepts only a classification, revision, and bounded aggregate counts", () => {
    expect(
      validateProjectGroundedAnswerEvent(
        "project_grounded_answer_completed",
        SAFE_PROPERTIES,
      ),
    ).toEqual({ success: true, properties: SAFE_PROPERTIES });
  });

  it("accepts guided mode metadata without accepting research content", () => {
    expect(
      validateProjectGroundedAnswerEvent(
        "project_grounded_answer_completed",
        { ...SAFE_PROPERTIES, mode: "compare_viewpoints" },
      ),
    ).toEqual({
      success: true,
      properties: { ...SAFE_PROPERTIES, mode: "compare_viewpoints" },
    });
  });

  it.each([
    { project_id: "10000000-0000-4000-8000-000000000001" },
    { conversation_id: "private" },
    { project_name: "Private research" },
    { project_goal: "Private goal" },
    { question: "secret question" },
    { answer: "generated content" },
    { passage: "exact Transcript content" },
    { citation: "[S1 @ 00:42]" },
    { video_title: "Private Video title" },
  ])("rejects private or content-bearing properties: %j", (extra) => {
    expect(
      ProjectGroundedAnswerEventSchema.safeParse({
        event: "project_grounded_answer_completed",
        properties: { ...SAFE_PROPERTIES, ...extra },
      }).success,
    ).toBe(false);
  });

  it("rejects incoherent and unbounded coverage", () => {
    expect(
      ProjectGroundedAnswerEventSchema.safeParse({
        event: "project_grounded_answer_completed",
        properties: { ...SAFE_PROPERTIES, total_videos: 5 },
      }).success,
    ).toBe(false);
    expect(
      ProjectGroundedAnswerEventSchema.safeParse({
        event: "project_grounded_answer_completed",
        properties: { ...SAFE_PROPERTIES, citation_diagnostics: 21 },
      }).success,
    ).toBe(false);
  });
});
