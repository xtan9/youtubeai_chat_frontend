import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  buildModerationClassifierPrompt,
  parseModerationClassifierResponse,
} from "../classifier";
import type { YouTubeCommentCandidate } from "../contracts";

const candidates: YouTubeCommentCandidate[] = [
  {
    commentId: "comment-1",
    parentCommentId: "comment-1",
    videoId: "abcdefghijk",
    authorChannelId: "author-1",
    authorDisplayName: "Viewer",
    text: "This argument is wrong and poorly researched.",
    publishedAt: "2026-08-31T12:00:00Z",
  },
];

describe("moderation classifier", () => {
  it("explicitly separates criticism from personal attacks", () => {
    const prompt = buildModerationClassifierPrompt(candidates);
    expect(prompt).toContain("Do not label ordinary criticism");
    expect(prompt).toContain("Never insult, diagnose, shame");
  });

  it("accepts fenced JSON while preserving a critical classification", () => {
    const parsed = parseModerationClassifierResponse(
      '```json\n{"results":[{"id":"comment-1","label":"critical","confidence":0.91,"reasonCodes":["content_criticism"],"suggestedReply":"Please point to the claim you disagree with."}]}\n```',
      candidates,
    );
    expect(parsed[0]).toMatchObject({
      classification: "critical",
      confidence: 0.91,
      suggestedReply: "Please point to the claim you disagree with.",
    });
  });

  it("fails closed on an incomplete model response", () => {
    expect(() =>
      parseModerationClassifierResponse('{"results":[]}', candidates),
    ).toThrow(/incomplete/);
  });
});
