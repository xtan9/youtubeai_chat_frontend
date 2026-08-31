import { describe, expect, it } from "vitest";
import {
  moderationSettingsSchema,
  renderReplyTemplate,
  scanRequestSchema,
} from "../contracts";

describe("comment moderation contracts", () => {
  it("requires a video URL for the consumer scan", () => {
    expect(scanRequestSchema.safeParse({ source: "consumer" }).success).toBe(
      false,
    );
    expect(
      scanRequestSchema.safeParse({
        source: "consumer",
        videoUrl: "https://youtu.be/abcdefghijk",
      }).success,
    ).toBe(true);
  });

  it("requires the generated reply placeholder in settings", () => {
    expect(
      moderationSettingsSchema.safeParse({
        autoReplyEnabled: false,
        autoReplyThreshold: 0.92,
        replyTemplate: "This template has no generated content placeholder.",
      }).success,
    ).toBe(false);
  });

  it("renders every reply placeholder", () => {
    expect(renderReplyTemplate("AI: {{reply}} / {{reply}}", " Keep it civil. ")).toBe(
      "AI: Keep it civil. / Keep it civil.",
    );
  });
});
