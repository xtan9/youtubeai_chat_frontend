import { describe, expect, it } from "vitest";
import {
  ProjectSearchEventSchema,
  validateProjectSearchEvent,
} from "../project-search";

const SAFE_PROPERTIES = {
  project_id: "a0000000-0000-4000-8000-000000000001",
  source_set_revision: 4,
  outcome: "ready" as const,
  result_count: 3,
  total_videos: 4,
  ready_videos: 3,
  unavailable_videos: 1,
  passages_examined: 48,
};

describe("Project Search analytics privacy contract", () => {
  it("accepts only revision, classified outcome, and bounded counts", () => {
    expect(
      ProjectSearchEventSchema.safeParse({
        event: "project_search_completed",
        properties: SAFE_PROPERTIES,
      }).success,
    ).toBe(true);
    expect(
      validateProjectSearchEvent("project_search_completed", SAFE_PROPERTIES),
    ).toEqual({ success: true, properties: SAFE_PROPERTIES });
  });

  it.each([
    { project_name: "Private research" },
    { project_goal: "Private goal" },
    { query: "secret search" },
    { passage: "exact Transcript content" },
    { title: "Private Video title" },
    { youtube_url: "https://www.youtube.com/watch?v=aaaaaaa0001" },
    { channel_name: "Private channel" },
  ])("rejects private or content-bearing properties: %j", (extra) => {
    expect(
      ProjectSearchEventSchema.safeParse({
        event: "project_search_completed",
        properties: { ...SAFE_PROPERTIES, ...extra },
      }).success,
    ).toBe(false);
  });

  it("rejects incoherent outcomes and coverage counts", () => {
    expect(
      ProjectSearchEventSchema.safeParse({
        event: "project_search_completed",
        properties: { ...SAFE_PROPERTIES, outcome: "no_results" },
      }).success,
    ).toBe(false);
    expect(
      ProjectSearchEventSchema.safeParse({
        event: "project_search_completed",
        properties: { ...SAFE_PROPERTIES, total_videos: 5 },
      }).success,
    ).toBe(false);
    expect(
      ProjectSearchEventSchema.safeParse({
        event: "project_search_completed",
        properties: {
          ...SAFE_PROPERTIES,
          outcome: "not_ready",
          result_count: 0,
        },
      }).success,
    ).toBe(false);
  });
});
