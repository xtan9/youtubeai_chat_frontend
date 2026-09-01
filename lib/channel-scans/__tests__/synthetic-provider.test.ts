import { describe, expect, it } from "vitest";
import {
  MAX_SCAN_THREADS,
  SCAN_WINDOW_DAYS,
  SYNTHETIC_SCAN_PROVIDER,
} from "../contracts";
import {
  createSyntheticCommentProvider,
  type SyntheticThread,
} from "../synthetic-provider";

const NOW = new Date("2026-08-31T12:00:00.000Z");

function thread(overrides: Partial<SyntheticThread> = {}): SyntheticThread {
  return {
    threadId: "thread-1",
    commentId: "comment-1",
    videoId: "video-1",
    publishedAt: "2026-08-30T12:00:00.000Z",
    content: "A synthetic comment.",
    contentHash: "hash-1",
    isTopLevel: true,
    ...overrides,
  };
}

describe("SyntheticCommentProvider", () => {
  it("returns only top-level threads inside the requested seven-day window", async () => {
    const provider = createSyntheticCommentProvider({
      now: () => NOW,
      threads: [
        thread(),
        thread({
          threadId: "nested",
          commentId: "nested-comment",
          isTopLevel: false,
        }),
        thread({
          threadId: "old",
          commentId: "old-comment",
          publishedAt: "2026-08-20T12:00:00.000Z",
        }),
      ],
    });

    const page = await provider.listTopLevelThreads({
      connectedChannelId: "synthetic-demo-channel",
      windowStart: new Date(NOW.getTime() - SCAN_WINDOW_DAYS * 86_400_000),
      windowEnd: NOW,
      pageToken: null,
      pageSize: MAX_SCAN_THREADS,
    });

    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]).toMatchObject({
      threadId: "thread-1",
      isTopLevel: true,
    });
    expect(page.hasMoreWithinWindow).toBe(false);
    expect(page.hasMoreOutsideWindow).toBe(true);
  });

  it("paginates the fixed synthetic corpus and exposes older activity separately", async () => {
    const provider = createSyntheticCommentProvider({ now: () => NOW });
    const first = await provider.listTopLevelThreads({
      connectedChannelId: "synthetic-demo-channel",
      windowStart: new Date(NOW.getTime() - SCAN_WINDOW_DAYS * 86_400_000),
      windowEnd: NOW,
      pageToken: null,
      pageSize: 50,
    });

    expect(first.threads).toHaveLength(50);
    expect(first.nextPageToken).toBe("50");
    expect(first.hasMoreWithinWindow).toBe(true);
    expect(first.hasMoreOutsideWindow).toBe(true);
    expect(first.threads.every((item) => item.isTopLevel)).toBe(true);
    expect(
      first.threads.every((item) => {
        const publishedAt = new Date(item.publishedAt).getTime();
        return (
          publishedAt >=
            NOW.getTime() - SCAN_WINDOW_DAYS * 86_400_000 &&
          publishedAt <= NOW.getTime()
        );
      }),
    ).toBe(true);
  });

  it("keeps assessment failures attached to one synthetic interaction", async () => {
    const provider = createSyntheticCommentProvider({
      now: () => NOW,
      threads: [
        thread({ assessmentFailure: "provider_failure" }),
        thread({
          threadId: "malformed",
          commentId: "malformed-comment",
          assessmentFailure: "malformed_output",
        }),
      ],
    });
    const page = await provider.listTopLevelThreads({
      connectedChannelId: "synthetic-demo-channel",
      windowStart: new Date(NOW.getTime() - SCAN_WINDOW_DAYS * 86_400_000),
      windowEnd: NOW,
      pageToken: null,
      pageSize: 10,
    });

    await expect(provider.assess(page.threads[0])).rejects.toMatchObject({
      code: "SYNTHETIC_ASSESSMENT_FAILED",
    });
    await expect(provider.assess(page.threads[1])).resolves.toEqual({
      classification: "not_an_assessment",
    });
  });

  it("identifies the provider without allowing a caller to expand its bounds", () => {
    expect(SYNTHETIC_SCAN_PROVIDER).toBe("synthetic");
    expect(MAX_SCAN_THREADS).toBe(200);
    expect(SCAN_WINDOW_DAYS).toBe(7);
  });
});
