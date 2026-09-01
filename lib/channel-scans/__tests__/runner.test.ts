import { describe, expect, it, vi } from "vitest";
import {
  SCAN_WINDOW_DAYS,
  type ScanRunStartInput,
  type ScanRunStore,
  type SyntheticAssessment,
} from "../contracts";
import { InMemoryScanRunStore } from "../memory-store";
import {
  executeScanRun,
  type ScanRunExecutionOptions,
} from "../runner";
import type {
  SyntheticCommentProvider,
  SyntheticProviderPage,
  SyntheticThread,
} from "../synthetic-provider";
import type { ScanProviderThread } from "../provider";
import type { StoredInteractionAssessment } from "@/lib/channel/review-queue";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const ACCOUNT_ID = "account-1";
const WINDOW_START = new Date(
  NOW.getTime() - SCAN_WINDOW_DAYS * 86_400_000,
);

function thread(id: string, contentHash = `${id}-hash`): SyntheticThread {
  return {
    threadId: id,
    commentId: `${id}-comment`,
    videoId: "video-1",
    publishedAt: "2026-08-30T12:00:00.000Z",
    content: `Synthetic content for ${id}`,
    contentHash,
    isTopLevel: true,
  };
}

function assessment(): SyntheticAssessment {
  return {
    classification: "reviewable",
    reasonCode: "synthetic_context_required",
    taxonomyVersion: "synthetic-interaction-v1",
  };
}

function page(
  threads: readonly SyntheticThread[],
  options: Partial<SyntheticProviderPage> = {},
): SyntheticProviderPage {
  return {
    threads,
    nextPageToken: null,
    hasMoreWithinWindow: false,
    hasMoreOutsideWindow: false,
    ...options,
  };
}

function startInput(
  connectedChannelId = "synthetic-channel",
  retryOf: string | null = null,
): ScanRunStartInput {
  return {
    accountId: ACCOUNT_ID,
    connectedChannelId,
    provider: "synthetic",
    windowStart: WINDOW_START,
    windowEnd: NOW,
    retryOf,
  };
}

async function start(store: InMemoryScanRunStore, input = startInput()) {
  const result = await store.startRun(input);
  if (result.kind !== "started") {
    throw new Error(`expected a started run, got ${result.kind}`);
  }
  return result.run;
}

function providerFor(
  pages: readonly SyntheticProviderPage[],
  assess: (item: SyntheticThread) => Promise<SyntheticAssessment>,
): SyntheticCommentProvider {
  return {
    listTopLevelThreads: vi.fn(async ({ pageToken }) => {
      const index = pageToken === null ? 0 : Number(pageToken);
      return pages[index] ?? page([]);
    }),
    findThread: vi.fn(async ({ threadId, contentHash }) =>
      pages
        .flatMap((candidate) => candidate.threads)
        .find(
          (candidate) =>
            candidate.threadId === threadId &&
            candidate.contentHash === contentHash,
        ) ?? null,
    ),
    assess: vi.fn(assess),
  };
}

describe("executeScanRun", () => {
  it("persists a real YouTube assessment through the Review Queue boundary", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store, {
      ...startInput("00000000-0000-4000-8000-000000000001"),
      provider: "youtube",
    });
    const context = {
      videoTitle: "A governed video",
      candidate: {
        role: "candidate" as const,
        authorRole: "other_participant" as const,
        replyTargetRole: "not_a_reply" as const,
        observableTargetEvidence: ["channel_or_steward_identity" as const],
        languageHint: null,
        text: "Supported Creator, you are a fool.",
      },
      topLevelComment: {
        role: "top_level_comment" as const,
        authorRole: "other_participant" as const,
        text: "Supported Creator, you are a fool.",
      },
      neighboringReplies: [],
    };
    const realThread: ScanProviderThread = {
      ...thread("real-thread"),
      content: "Supported Creator, you are a fool.",
      contentHash: "b".repeat(64),
      assessmentContext: context,
    };
    const provider = {
      kind: "youtube" as const,
      listTopLevelThreads: vi.fn(async () => page([realThread])),
      findThread: vi.fn(async () => realThread),
      assess: vi.fn(async () => ({
        kind: "interaction" as const,
        context,
        assessment: {
          schemaVersion: "interaction-assessment-v1" as const,
          category: "actionable_abuse" as const,
          language: "english" as const,
          target: "channel_steward" as const,
          targetEvidence: ["channel_or_steward_identity" as const],
          draftEligible: true,
        },
      })),
    };
    const persistInteractionAssessment = vi
      .fn()
      .mockResolvedValue("review-assessment-1");

    await executeScanRun(run.id, {
      store,
      provider,
      persistInteractionAssessment,
      now: () => NOW,
      workerId: "worker-youtube",
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "completed",
      outcome: "completed",
      coverage: {
        threadsDiscovered: 1,
        threadsAssessed: 1,
        threadsFailed: 0,
      },
    });
    expect(persistInteractionAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ id: run.id }),
        thread: expect.objectContaining({ threadId: "real-thread" }),
        context,
        assessment: expect.objectContaining({
          category: "actionable_abuse",
          draftEligible: true,
        }),
        assessedAt: NOW,
      }),
    );
  });

  it("binds the current revalidated hash when a real comment changes", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const connectedChannelId = "00000000-0000-4000-8000-000000000003";
    const run = await start(store, {
      ...startInput(connectedChannelId),
      provider: "youtube",
    });
    const context = {
      videoTitle: "A governed video",
      candidate: {
        role: "candidate" as const,
        authorRole: "other_participant" as const,
        replyTargetRole: "not_a_reply" as const,
        observableTargetEvidence: [] as const,
        languageHint: null,
        text: "The current bounded comment.",
      },
      topLevelComment: {
        role: "top_level_comment" as const,
        authorRole: "other_participant" as const,
        text: "The current bounded comment.",
      },
      neighboringReplies: [],
    };
    const discovered: ScanProviderThread = {
      ...thread("mutable"),
      commentId: "mutable-comment",
      contentHash: "a".repeat(64),
    };
    const current: ScanProviderThread = {
      ...discovered,
      content: "The current bounded comment.",
      contentHash: "b".repeat(64),
      assessmentContext: context,
    };
    const provider = {
      kind: "youtube" as const,
      listTopLevelThreads: vi.fn(async () => page([discovered])),
      findThread: vi.fn(async () => current),
      assess: vi.fn(async () => ({
        kind: "interaction" as const,
        context,
        assessment: {
          schemaVersion: "interaction-assessment-v1" as const,
          category: "reviewable_interaction" as const,
          language: "english" as const,
          target: "ambiguous" as const,
          targetEvidence: [],
          draftEligible: false,
        },
      })),
    };
    const persistInteractionAssessment = vi.fn(
      async (
        input: Parameters<
          NonNullable<
            ScanRunExecutionOptions["persistInteractionAssessment"]
          >
        >[0],
      ) =>
        store.saveInteractionAssessment({
          assessmentId: "assessment-current",
          accountId: input.run.accountId,
          channelId: input.run.connectedChannelId,
          commentId: input.thread.commentId,
          commentTextHash: input.thread.contentHash,
          videoId: input.thread.videoId,
          videoTitle: input.context.videoTitle,
          category: input.assessment.category,
          language: input.assessment.language,
          target: input.assessment.target,
          targetEvidence: input.assessment.targetEvidence,
          candidateText: input.context.candidate.text,
          topLevelCommentText: input.context.topLevelComment.text,
          neighboringReplies: input.context.neighboringReplies.map(
            (reply) => reply.text,
          ),
          draftEligible: input.assessment.draftEligible,
          status: "reviewable",
          assessedAt: input.assessedAt.toISOString(),
        }),
    );

    await executeScanRun(run.id, {
      store,
      provider,
      persistInteractionAssessment,
      now: () => NOW,
      workerId: "worker-youtube-mutable",
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "completed",
      coverage: { threadsAssessed: 1, threadsFailed: 0 },
    });
    expect(persistInteractionAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        thread: expect.objectContaining({ contentHash: "b".repeat(64) }),
      }),
    );
    await expect(
      store.findReusableInteractionAssessment({
        accountId: run.accountId,
        connectedChannelId,
        commentId: current.commentId,
        contentHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ assessmentId: "assessment-current" });
  });

  it("fails the real item when durable Review Queue persistence is unavailable", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store, {
      ...startInput("00000000-0000-4000-8000-000000000004"),
      provider: "youtube",
    });
    const realThread: ScanProviderThread = {
      ...thread("persistence-unavailable"),
      contentHash: "c".repeat(64),
    };
    const provider = {
      kind: "youtube" as const,
      listTopLevelThreads: vi.fn(async () => page([realThread])),
      findThread: vi.fn(async () => realThread),
      assess: vi.fn(),
    };
    const unavailableStore = store as unknown as ScanRunStore;
    unavailableStore.findReusableInteractionAssessment = undefined;
    unavailableStore.saveInteractionAssessment = undefined;

    await executeScanRun(run.id, {
      store: unavailableStore,
      provider,
      now: () => NOW,
      workerId: "worker-youtube-persistence",
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "partial",
      outcome: "partial",
      coverage: { threadsAssessed: 0, threadsFailed: 1 },
    });
    expect(provider.assess).not.toHaveBeenCalled();
  });

  it("reuses only the current real-comment hash and supersedes an older revision", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const base: StoredInteractionAssessment = {
      assessmentId: "assessment-old",
      accountId: ACCOUNT_ID,
      channelId: "connected-youtube-channel",
      commentId: "comment-1",
      commentTextHash: "a".repeat(64),
      videoId: "video-1",
      videoTitle: "A governed video",
      category: "reviewable_interaction",
      language: "english",
      target: "ambiguous",
      targetEvidence: [],
      candidateText: "Old text",
      topLevelCommentText: "Old text",
      neighboringReplies: [],
      draftEligible: false,
      status: "reviewable",
      assessedAt: NOW.toISOString(),
    };
    await store.saveInteractionAssessment(base);
    await store.saveInteractionAssessment({
      ...base,
      assessmentId: "assessment-new",
      commentTextHash: "b".repeat(64),
      candidateText: "New text",
      topLevelCommentText: "New text",
    });

    await expect(
      store.findReusableInteractionAssessment({
        accountId: ACCOUNT_ID,
        connectedChannelId: base.channelId,
        commentId: base.commentId,
        contentHash: base.commentTextHash,
      }),
    ).resolves.toBeNull();
    await expect(
      store.findReusableInteractionAssessment({
        accountId: ACCOUNT_ID,
        connectedChannelId: base.channelId,
        commentId: base.commentId,
        contentHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({
      assessmentId: "assessment-new",
      candidateText: "New text",
    });
  });

  it("stops the run uniformly when the shared YouTube quota is exhausted", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store, {
      ...startInput("00000000-0000-4000-8000-000000000002"),
      provider: "youtube",
    });
    const context = {
      videoTitle: "A governed video",
      candidate: {
        role: "candidate" as const,
        authorRole: "other_participant" as const,
        replyTargetRole: "not_a_reply" as const,
        observableTargetEvidence: [],
        languageHint: null,
        text: "A bounded comment.",
      },
      topLevelComment: {
        role: "top_level_comment" as const,
        authorRole: "other_participant" as const,
        text: "A bounded comment.",
      },
      neighboringReplies: [],
    };
    const threads = ["first", "second"].map((id) => ({
      ...thread(id),
      contentHash: `${id}-hash`,
      assessmentContext: context,
    }));
    const provider = {
      kind: "youtube" as const,
      listTopLevelThreads: vi.fn(async () => page(threads)),
      findThread: vi.fn(async ({ threadId }) =>
        threads.find((candidate) => candidate.threadId === threadId) ?? null,
      ),
      assess: vi.fn(async () => {
        throw Object.assign(new Error("shared quota exhausted"), {
          code: "YOUTUBE_QUOTA_EXHAUSTED",
        });
      }),
    };

    await executeScanRun(run.id, {
      store,
      provider,
      now: () => NOW,
      workerId: "worker-youtube-quota",
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "partial",
      outcome: "partial",
      failureCode: "YOUTUBE_QUOTA_EXHAUSTED",
      coverage: { threadsDiscovered: 2, threadsFailed: 0 },
    });
    expect(provider.assess).toHaveBeenCalledOnce();
  });

  it("enforces the seven-day and 200 top-level-thread bounds", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store);
    const threads = Array.from({ length: 205 }, (_, index) =>
      thread(`thread-${index}`),
    );
    const provider = providerFor(
      [
        page(threads.slice(0, 50), {
          nextPageToken: "1",
          hasMoreWithinWindow: true,
        }),
        page(threads.slice(50, 100), {
          nextPageToken: "2",
          hasMoreWithinWindow: true,
        }),
        page(threads.slice(100, 150), {
          nextPageToken: "3",
          hasMoreWithinWindow: true,
        }),
        page(threads.slice(150, 200), {
          nextPageToken: "4",
          hasMoreWithinWindow: true,
        }),
      ],
      async () => assessment(),
    );

    await executeScanRun(run.id, {
      store,
      provider,
      now: () => NOW,
      workerId: "worker-1",
    });

    const completed = await store.getRun(run.id);
    expect(completed).toMatchObject({
      status: "partial",
      outcome: "partial",
      coverage: {
        pages: 4,
        threadsDiscovered: 200,
        bound: "thread_limit",
        boundPreventedCompleteCoverage: true,
      },
    });
    expect(completed?.coverage.threadsDiscovered).toBeLessThanOrEqual(200);
    expect(provider.listTopLevelThreads).toHaveBeenCalledTimes(4);
  });

  it("fails one interaction independently and keeps the rest of the run moving", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store);
    const provider = providerFor(
      [page([thread("ok-1"), thread("bad"), thread("ok-2")])],
      async (item) => {
        if (item.threadId === "bad") {
          throw Object.assign(new Error("synthetic provider failure"), {
            code: "SYNTHETIC_ASSESSMENT_FAILED",
          });
        }
        return assessment();
      },
    );

    await executeScanRun(run.id, {
      store,
      provider,
      now: () => NOW,
      workerId: "worker-1",
    });

    const completed = await store.getRun(run.id);
    expect(completed).toMatchObject({
      status: "partial",
      outcome: "partial",
      coverage: {
        threadsDiscovered: 3,
        threadsAssessed: 2,
        threadsFailed: 1,
      },
    });
    expect(provider.assess).toHaveBeenCalledTimes(3);
  });

  it("retains completed assessments when cancellation arrives between items", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store);
    let first = true;
    const provider = providerFor(
      [page([thread("first"), thread("second")])],
      async () => {
        if (first) {
          first = false;
          await store.requestCancellation({
            accountId: ACCOUNT_ID,
            runId: run.id,
          });
        }
        return assessment();
      },
    );

    await executeScanRun(run.id, {
      store,
      provider,
      now: () => NOW,
      workerId: "worker-1",
    });

    const completed = await store.getRun(run.id);
    expect(completed).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      coverage: { threadsAssessed: 1, threadsFailed: 0 },
    });
    expect(provider.assess).toHaveBeenCalledTimes(1);
  });

  it("reaps a cancellation left behind by a disappeared worker", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store);
    expect(await store.acquireRun(run.id, "worker-1", NOW)).not.toBeNull();
    await store.requestCancellation({ accountId: ACCOUNT_ID, runId: run.id });

    await executeScanRun(run.id, {
      store,
      provider: providerFor([page([thread("never-reached")])], async () => assessment()),
      now: () => NOW,
      workerId: "worker-2",
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
    });
  });

  it("retries incomplete work while reusing unchanged successful assessments", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const firstRun = await start(store);
    const firstProvider = providerFor(
      [page([thread("unchanged"), thread("changed")])],
      async (item) => {
        if (item.threadId === "changed") {
          throw Object.assign(new Error("temporary failure"), {
            code: "SYNTHETIC_ASSESSMENT_FAILED",
          });
        }
        return assessment();
      },
    );

    await executeScanRun(firstRun.id, {
      store,
      provider: firstProvider,
      now: () => NOW,
      workerId: "worker-1",
    });

    await expect(
      store.findReusableAssessment({
        connectedChannelId: "synthetic-channel",
        threadId: "unchanged",
        contentHash: "unchanged-hash",
      }),
    ).resolves.toMatchObject({ threadId: "unchanged" });

    const retryResult = await store.startRun(startInput("synthetic-channel", firstRun.id));
    if (retryResult.kind !== "started") {
      throw new Error(`expected a retry, got ${retryResult.kind}`);
    }
    const retryProvider = providerFor(
      [page([
        thread("unchanged"),
        thread("changed", "changed-after-first-run"),
      ])],
      async () => assessment(),
    );

    await executeScanRun(retryResult.run.id, {
      store,
      provider: retryProvider,
      now: () => NOW,
      workerId: "worker-2",
    });

    const retried = await store.getRun(retryResult.run.id);
    expect(retried).toMatchObject({
      status: "completed",
      outcome: "completed",
      coverage: {
        threadsAssessed: 1,
        threadsReused: 1,
        threadsFailed: 0,
      },
    });
    expect(retryProvider.assess).toHaveBeenCalledTimes(1);
    expect(retryProvider.assess).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "changed",
        contentHash: "changed-after-first-run",
      }),
    );
  });

  it("distinguishes the hourly account limit from a concurrent channel run", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    expect((await store.startRun(startInput("channel-a"))).kind).toBe("started");
    expect((await store.startRun(startInput("channel-a"))).kind).toBe(
      "concurrent",
    );
    expect((await store.startRun(startInput("channel-b"))).kind).toBe("started");
    expect((await store.startRun(startInput("channel-c"))).kind).toBe("started");
    expect((await store.startRun(startInput("channel-d"))).kind).toBe("started");
    expect((await store.startRun(startInput("channel-e"))).kind).toBe(
      "rate_limited",
    );
  });

  it("uses Failed for a run-level provider failure before any page is durable", async () => {
    const store = new InMemoryScanRunStore({ now: () => NOW });
    const run = await start(store);
    const provider = providerFor([], async () => assessment());
    vi.mocked(provider.listTopLevelThreads).mockRejectedValueOnce(
      Object.assign(new Error("provider unavailable"), {
        code: "SYNTHETIC_PAGE_FAILED",
      }),
    );

    await executeScanRun(run.id, {
      store,
      provider,
      now: () => NOW,
      workerId: "worker-1",
    });

    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "failed",
      outcome: "failed",
    });
  });
});
