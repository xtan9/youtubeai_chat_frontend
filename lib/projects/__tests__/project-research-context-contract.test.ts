import { describe, expect, it } from "vitest";
import { ProjectTranscriptPassageSchema } from "../project-passage-search-contract";
import { ProjectGroundedQuestionRequestSchema } from "../project-grounded-input";

const videoId = "b0000000-0000-4000-8000-000000000001";
const text = "The trial found no harm but the sample was small and follow-up lasted only six months.";
const window = {
  passageId: `${videoId}:1-3:0:${text.length}`,
  videoId, youtubeVideoId: "aaaaaaa0001", title: "Research", channelName: null,
  text, segmentOrdinal: 1, endSegmentOrdinal: 3,
  excerptStartCharacter: 0, excerptEndCharacter: text.length,
  startSeconds: 10, endSeconds: 22, language: "en",
  truncatedStart: false, truncatedEnd: false,
};

describe("Research evidence and question contracts", () => {
  it("retains the qualification in a canonical multi-segment context window", () => {
    expect(ProjectTranscriptPassageSchema.parse(window).text).toBe(text);
    expect(ProjectTranscriptPassageSchema.safeParse({ ...window, endSegmentOrdinal: 4 }).success).toBe(false);
    expect(ProjectTranscriptPassageSchema.safeParse({ ...window, excerptStartCharacter: 1 }).success).toBe(false);
  });

  it("accepts a detailed research question and rejects over 4,000 code points", () => {
    const request = { questionId: videoId, question: "研究".repeat(1500) };
    expect(ProjectGroundedQuestionRequestSchema.safeParse(request).success).toBe(true);
    expect(ProjectGroundedQuestionRequestSchema.safeParse({ ...request, question: "🌍".repeat(4001) }).success).toBe(false);
  });
});
