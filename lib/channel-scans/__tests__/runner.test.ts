import { describe, expect, it, vi } from "vitest";
import {
  SCAN_WINDOW_DAYS,
  type ScanRunStartInput,
  type SyntheticAssessment,
} from "../contracts";
import { InMemoryScanRunStore } from "../memory-store";
import { executeScanRun } from "../runner";
import type {
  SyntheticCommentProvider,
  SyntheticProviderPage,
  SyntheticThread,
} from "../synthetic-provider";

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
