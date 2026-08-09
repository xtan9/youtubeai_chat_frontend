import { describe, expect, it } from "vitest";
import {
  ProjectPassageSearchResponseSchema,
  projectPassageSearchInputSchema,
  projectPassageSearchRequestSchema,
} from "../project-passage-search-contract";

describe("Project passage-search contract", () => {
  it("trims and bounds direct Search input", () => {
    expect(
      projectPassageSearchInputSchema.parse({
        query: "  cambio climático  ",
        limit: 8,
      }),
    ).toEqual({ query: "cambio climático", limit: 8 });
    expect(
      projectPassageSearchInputSchema.safeParse({ query: "x", limit: 8 })
        .success,
    ).toBe(false);
    expect(
      projectPassageSearchInputSchema.safeParse({
        query: "x".repeat(201),
        limit: 8,
      }).success,
    ).toBe(false);
  });

  it("applies query bounds in Unicode code points rather than UTF-16 units", () => {
    const validAstralQuery = "\u{1F30D}".repeat(200);
    expect(
      projectPassageSearchInputSchema.parse({
        query: validAstralQuery,
        limit: 8,
      }).query,
    ).toBe(validAstralQuery);
    expect(
      projectPassageSearchRequestSchema.safeParse({ query: validAstralQuery })
        .success,
    ).toBe(true);
    expect(
      projectPassageSearchInputSchema.safeParse({
        query: "\u{1F30D}".repeat(201),
        limit: 8,
      }).success,
    ).toBe(false);
  });

  it("rejects incoherent coverage and excerpt identity", () => {
    const base = {
      status: "ready",
      sourceSetRevision: 1,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 4,
      },
      passages: [
        {
          passageId: "b0000000-0000-4000-8000-000000000001:1:0:2",
          videoId: "b0000000-0000-4000-8000-000000000001",
          youtubeVideoId: "aaaaaaa0001",
          title: null,
          channelName: null,
          text: "研究",
          segmentOrdinal: 1,
          excerptStartCharacter: 0,
          excerptEndCharacter: 2,
          startSeconds: 4,
          endSeconds: 8,
          language: "zh",
          truncatedStart: false,
          truncatedEnd: false,
        },
      ],
    };
    expect(ProjectPassageSearchResponseSchema.safeParse(base).success).toBe(true);
    expect(
      ProjectPassageSearchResponseSchema.safeParse({
        ...base,
        coverage: { ...base.coverage, totalVideos: 3 },
      }).success,
    ).toBe(false);
    expect(
      ProjectPassageSearchResponseSchema.safeParse({
        ...base,
        passages: [
          { ...base.passages[0], excerptEndCharacter: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it("applies exact-passage bounds in Unicode code points", () => {
    const passageText = "\u{2000B}".repeat(600);
    const response = {
      status: "ready",
      sourceSetRevision: 1,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 1,
      },
      passages: [
        {
          passageId: "b0000000-0000-4000-8000-000000000001:1:0:600",
          videoId: "b0000000-0000-4000-8000-000000000001",
          youtubeVideoId: "aaaaaaa0001",
          title: null,
          channelName: null,
          text: passageText,
          segmentOrdinal: 1,
          excerptStartCharacter: 0,
          excerptEndCharacter: 600,
          startSeconds: 4,
          endSeconds: 8,
          language: "ja",
          truncatedStart: false,
          truncatedEnd: false,
        },
      ],
    };
    expect(ProjectPassageSearchResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      ProjectPassageSearchResponseSchema.safeParse({
        ...response,
        passages: [
          {
            ...response.passages[0],
            passageId:
              "b0000000-0000-4000-8000-000000000001:1:0:601",
            text: passageText + "\u{2000B}",
            excerptEndCharacter: 601,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects outcome classifications that disagree with ready coverage", () => {
    const base = {
      sourceSetRevision: 1,
      coverage: {
        totalVideos: 1,
        readyVideos: 0,
        unavailableVideos: [
          {
            videoId: "b0000000-0000-4000-8000-000000000001",
            youtubeVideoId: "aaaaaaa0001",
            title: null,
            channelName: null,
            status: "processing",
            failureCode: null,
          },
        ],
        passagesExamined: 0,
      },
      passages: [],
    };
    expect(
      ProjectPassageSearchResponseSchema.safeParse({
        ...base,
        status: "not_ready",
      }).success,
    ).toBe(true);
    expect(
      ProjectPassageSearchResponseSchema.safeParse({
        ...base,
        status: "no_results",
      }).success,
    ).toBe(false);
  });
});
