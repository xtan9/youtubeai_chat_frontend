import { describe, expect, it } from "vitest";
import {
  addProjectHistoryVideoSchema,
  projectHistoryCandidateQuerySchema,
  removeProjectVideoQuerySchema,
  reorderProjectVideosSchema,
} from "../project-source-set-input";

const VIDEO_ID = "10000000-0000-4000-8000-000000000001";

describe("Project Source Set input", () => {
  it("accepts a canonical History Video and nonnegative revision", () => {
    expect(
      addProjectHistoryVideoSchema.parse({
        videoId: VIDEO_ID,
        expectedRevision: 0,
      }),
    ).toEqual({ videoId: VIDEO_ID, expectedRevision: 0 });
  });

  it("rejects ownership-bearing or malformed add payloads", () => {
    expect(
      addProjectHistoryVideoSchema.safeParse({
        videoId: VIDEO_ID,
        expectedRevision: 0,
        ownerId: "someone-else",
      }).success,
    ).toBe(false);
    expect(
      addProjectHistoryVideoSchema.safeParse({
        videoId: "not-a-video",
        expectedRevision: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts a complete bounded order and rejects duplicates", () => {
    const second = "20000000-0000-4000-8000-000000000002";
    expect(
      reorderProjectVideosSchema.safeParse({
        videoIds: [second, VIDEO_ID],
        expectedRevision: 4,
      }).success,
    ).toBe(true);
    expect(
      reorderProjectVideosSchema.safeParse({
        videoIds: [VIDEO_ID, VIDEO_ID],
        expectedRevision: 4,
      }).success,
    ).toBe(false);
  });

  it("coerces the DELETE revision query and rejects missing values", () => {
    expect(
      removeProjectVideoQuerySchema.parse({ expectedRevision: "12" }),
    ).toEqual({ expectedRevision: 12 });
    expect(
      removeProjectVideoQuerySchema.safeParse({ expectedRevision: null }).success,
    ).toBe(false);
  });

  it("normalizes bounded candidate search pagination", () => {
    expect(
      projectHistoryCandidateQuerySchema.parse({
        page: "3",
        search: "  evidence  ",
      }),
    ).toEqual({ page: 3, pageSize: 10, search: "evidence" });
    expect(
      projectHistoryCandidateQuerySchema.safeParse({
        page: "0",
        search: "x".repeat(101),
      }).success,
    ).toBe(false);
  });
});
