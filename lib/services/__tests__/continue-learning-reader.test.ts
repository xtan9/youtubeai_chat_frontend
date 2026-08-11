import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readContinueLearningRecommendations,
  recordContinueLearningReadyReads,
} from "../continue-learning-reader";

const ITEM = {
  setId: "20000000-0000-4000-8000-000000000002",
  ordinal: 1,
  candidateVideoId: "30000000-0000-4000-8000-000000000003",
  canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
  title: "Next lesson",
  channelName: "Teaching Channel",
  thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
  relationship: "deeper_explanation" as const,
  explanation: "Builds on the source concept.",
};

describe("continue-learning reader service", () => {
  const rpc = vi.fn();
  const client = { rpc } as never;

  beforeEach(() => {
    rpc.mockReset();
  });

  it("calls the service-only reader RPC with the authenticated learner", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "ready", effectiveState: "on", items: [ITEM] },
      error: null,
    });

    await expect(
      readContinueLearningRecommendations(client, {
        learnerId: "10000000-0000-4000-8000-000000000001",
        sourceYoutubeVideoId: "dQw4w9WgXcQ",
        limit: 6,
      }),
    ).resolves.toEqual({
      outcome: "ready",
      effectiveState: "on",
      items: [ITEM],
    });
    expect(rpc).toHaveBeenCalledWith("read_continue_learning_recommendations", {
      p_learner_id: "10000000-0000-4000-8000-000000000001",
      p_source_youtube_video_id: "dQw4w9WgXcQ",
      p_limit: 6,
    });
  });

  it("rejects an untrusted payload instead of projecting it", async () => {
    rpc.mockResolvedValue({
      data: {
        outcome: "ready",
        effectiveState: "on",
        items: [{ ...ITEM, candidateVideoId: "internal-id" }],
      },
      error: null,
    });

    await expect(
      readContinueLearningRecommendations(client, {
        learnerId: "10000000-0000-4000-8000-000000000001",
        sourceYoutubeVideoId: "dQw4w9WgXcQ",
      }),
    ).resolves.toBeNull();
  });

  it("records every ready-read observation without failing the read", async () => {
    rpc.mockResolvedValue({ data: { outcome: "recorded" }, error: null });

    await expect(
      recordContinueLearningReadyReads(client, [ITEM, { ...ITEM, ordinal: 2 }]),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "record_recommendation_ready_read", {
      p_recommendation_set_id: ITEM.setId,
      p_recommendation_ordinal: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "record_recommendation_ready_read", {
      p_recommendation_set_id: ITEM.setId,
      p_recommendation_ordinal: 2,
    });
  });
});
