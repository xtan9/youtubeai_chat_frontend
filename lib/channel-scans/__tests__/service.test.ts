import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createStore, resolveTarget } = vi.hoisted(() => ({
  createStore: vi.fn(),
  resolveTarget: vi.fn(),
}));

vi.mock("../repository", () => ({
  createPostgresScanRunStore: createStore,
}));
vi.mock("../youtube-target", () => ({
  resolveYouTubeScanTarget: resolveTarget,
}));

import { startChannelScanRun } from "../service";

describe("channel scan service", () => {
  it("blocks a real scan before target resolution while external clearance is pending", async () => {
    const result = await startChannelScanRun({
      accountId: "00000000-0000-4000-8000-000000000010",
      connectedChannelId: "00000000-0000-4000-8000-000000000011",
      provider: "youtube",
    });

    expect(result).toEqual({
      kind: "blocked",
      code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED",
      reason: expect.stringContaining("written YouTube determination"),
    });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(createStore).not.toHaveBeenCalled();
  });
});
