import {
  MAX_SCAN_THREADS,
  SCAN_PAGE_SIZE,
  syntheticAssessmentSchema,
  type ScanBound,
  type ScanRun,
  type ScanRunStore,
  type ScanThreadObservation,
  type SyntheticAssessment,
} from "./contracts";
import type {
  SyntheticCommentProvider,
  SyntheticProviderPage,
  SyntheticThread,
} from "./synthetic-provider";

export type ScanRunExecutionOptions = Readonly<{
  store: ScanRunStore;
  provider: SyntheticCommentProvider;
  workerId: string;
  now?: () => Date;
}>;

class InvalidProviderPageError extends Error {
  constructor() {
    super("synthetic provider returned an invalid page");
    this.name = "InvalidProviderPageError";
  }
}

class InvalidProviderThreadError extends Error {
  constructor() {
    super("synthetic provider returned an invalid interaction");
    this.name = "InvalidProviderThreadError";
  }
}

class InvalidAssessmentError extends Error {
  constructor() {
    super("synthetic provider returned an invalid assessment");
    this.name = "InvalidAssessmentError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeCode(error: unknown, fallback: string): string {
  if (!isRecord(error) || typeof error.code !== "string") return fallback;
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code)
    ? error.code
    : fallback;
}

function isValidThread(value: unknown): value is SyntheticThread {
  if (!isRecord(value)) return false;
  return (
    typeof value.threadId === "string" &&
    value.threadId.length > 0 &&
    typeof value.commentId === "string" &&
    value.commentId.length > 0 &&
    typeof value.videoId === "string" &&
    value.videoId.length > 0 &&
    typeof value.publishedAt === "string" &&
    Number.isFinite(new Date(value.publishedAt).getTime()) &&
    typeof value.content === "string" &&
    typeof value.contentHash === "string" &&
    value.contentHash.length > 0 &&
    typeof value.isTopLevel === "boolean"
  );
}

function validProviderPage(value: unknown): value is SyntheticProviderPage {
  if (!isRecord(value) || !Array.isArray(value.threads)) return false;
  return (
    value.threads.every(isValidThread) &&
    (value.nextPageToken === null || typeof value.nextPageToken === "string") &&
    typeof value.hasMoreWithinWindow === "boolean" &&
    typeof value.hasMoreOutsideWindow === "boolean"
  );
}

function observationFor(thread: SyntheticThread): ScanThreadObservation {
  if (!thread.isTopLevel) {
    throw new InvalidProviderThreadError();
  }
  return {
    threadId: thread.threadId,
    commentId: thread.commentId,
    videoId: thread.videoId,
    publishedAt: thread.publishedAt,
    contentHash: thread.contentHash,
    isTopLevel: true,
  };
}

function pageBound(input: {
  run: ScanRun;
  page: SyntheticProviderPage;
  eligibleThreads: readonly SyntheticThread[];
  acceptedThreads: readonly SyntheticThread[];
}): {
  readonly nextPageToken: string | null;
  readonly sourceExhausted: boolean;
  readonly bound: ScanBound | null;
  readonly boundPreventedCompleteCoverage: boolean;
} {
  const hasMoreWithinWindow =
    input.page.hasMoreWithinWindow ||
    input.eligibleThreads.length > input.acceptedThreads.length;
  const reachedThreadLimit =
    input.run.coverage.threadsDiscovered + input.acceptedThreads.length >=
      MAX_SCAN_THREADS && hasMoreWithinWindow;
  const reachedTimeWindow = !hasMoreWithinWindow && input.page.hasMoreOutsideWindow;
  const sourceExhausted =
    reachedThreadLimit ||
    reachedTimeWindow ||
    (!hasMoreWithinWindow && input.page.nextPageToken === null);

  if (reachedThreadLimit) {
    return {
      nextPageToken: null,
      sourceExhausted: true,
      bound: "thread_limit",
      boundPreventedCompleteCoverage: true,
    };
  }
  if (reachedTimeWindow) {
    return {
      nextPageToken: null,
      sourceExhausted: true,
      bound: "time_window",
      boundPreventedCompleteCoverage: true,
    };
  }
  if (!sourceExhausted && input.page.nextPageToken === null) {
    throw new InvalidProviderPageError();
  }
  return {
    nextPageToken: sourceExhausted ? null : input.page.nextPageToken,
    sourceExhausted,
    bound: null,
    boundPreventedCompleteCoverage: false,
  };
}

function itemFailureCode(error: unknown): string {
  if (error instanceof InvalidAssessmentError) {
    return "ITEM_INVALID_ASSESSMENT";
  }
  return safeCode(error, "ITEM_ASSESSMENT_FAILED");
}

function runFailureCode(error: unknown): string {
  if (error instanceof InvalidProviderPageError) {
    return "PROVIDER_PAGE_INVALID";
  }
  if (error instanceof InvalidProviderThreadError) {
    return "PROVIDER_THREAD_INVALID";
  }
  return safeCode(error, "SCAN_RUN_FAILED");
}

function failedAfterRunLevelError(run: ScanRun): "failed" | "partial" {
  return run.coverage.pages > 0 || run.progress.processedThreads > 0
    ? "partial"
    : "failed";
}

async function cancellationRequested(
  store: ScanRunStore,
  runId: string,
): Promise<boolean> {
  const current = await store.getRun(runId);
  return current?.cancelRequestedAt !== null && current?.cancelRequestedAt !== undefined;
}

async function finishSafely(
  store: ScanRunStore,
  input: Parameters<ScanRunStore["finishRun"]>[0],
): Promise<void> {
  try {
    await store.finishRun(input);
  } catch {
    // A lost worker lease must not let an older worker overwrite a retry.
    // The current owner will finish the durable run or a later read will
    // reclaim its expired lease.
  }
}

/**
 * Executes a durable run until it reaches a terminal outcome. The store
 * persists each fetched page before assessment, and each item transition
 * independently, so a later worker can resume after navigation, timeout, or
 * deployment interruption.
 */
export async function executeScanRun(
  runId: string,
  options: ScanRunExecutionOptions,
): Promise<void> {
  const now = options.now ?? (() => new Date());
  const claimed = await options.store.acquireRun(
    runId,
    options.workerId,
    now(),
  );
  if (!claimed) return;

  try {
    while (true) {
      await options.store.heartbeat(runId, options.workerId, now());
      if (await cancellationRequested(options.store, runId)) {
        await finishSafely(options.store, {
          runId,
          workerId: options.workerId,
          outcome: "cancelled",
        });
        return;
      }

      const run = await options.store.getRun(runId);
      if (!run || run.status !== "running") return;

      const pending = await options.store.nextPendingThread(runId);
      if (pending) {
        // `ScanRunStore` intentionally persists only metadata. The provider
        // rehydrates the bounded interaction by its immutable hash when a
        // worker resumes after navigation or interruption.
        await assessPending(run, pending, options);
        continue;
      }

      if (run.sourceExhausted) {
        const outcome =
          run.coverage.threadsFailed > 0 ||
          run.coverage.boundPreventedCompleteCoverage
            ? "partial"
            : "completed";
        await finishSafely(options.store, {
          runId,
          workerId: options.workerId,
          outcome,
        });
        return;
      }

      const remaining = MAX_SCAN_THREADS - run.coverage.threadsDiscovered;
      if (remaining <= 0) {
        await finishSafely(options.store, {
          runId,
          workerId: options.workerId,
          outcome: "partial",
          failureCode: "THREAD_LIMIT_REACHED",
        });
        return;
      }

      const page = await options.provider.listTopLevelThreads({
        connectedChannelId: run.connectedChannelId,
        windowStart: new Date(run.coverage.windowStart),
        windowEnd: new Date(run.coverage.windowEnd),
        pageToken: run.nextPageToken,
        pageSize: Math.min(SCAN_PAGE_SIZE, remaining),
      });
      if (!validProviderPage(page)) throw new InvalidProviderPageError();

      const windowStart = new Date(run.coverage.windowStart).getTime();
      const windowEnd = new Date(run.coverage.windowEnd).getTime();
      const eligibleThreads = page.threads.filter((thread) => {
        const publishedAt = new Date(thread.publishedAt).getTime();
        return (
          thread.isTopLevel &&
          publishedAt >= windowStart &&
          publishedAt <= windowEnd
        );
      });
      const acceptedThreads = eligibleThreads.slice(0, remaining);
      const bounds = pageBound({
        run,
        page,
        eligibleThreads,
        acceptedThreads,
      });
      await options.store.persistPage({
        runId,
        workerId: options.workerId,
        pageToken: run.nextPageToken ?? "",
        threads: acceptedThreads.map(observationFor),
        nextPageToken: bounds.nextPageToken,
        sourceExhausted: bounds.sourceExhausted,
        bound: bounds.bound,
        boundPreventedCompleteCoverage: bounds.boundPreventedCompleteCoverage,
      });
    }
  } catch (error) {
    const current = await options.store.getRun(runId);
    if (!current || current.status !== "running") return;
    await finishSafely(options.store, {
      runId,
      workerId: options.workerId,
      outcome: failedAfterRunLevelError(current),
      failureCode: runFailureCode(error),
    });
  }
}

async function assessPending(
  run: ScanRun,
  workItem: NonNullable<Awaited<ReturnType<ScanRunStore["nextPendingThread"]>>>,
  options: ScanRunExecutionOptions,
): Promise<void> {
  const reusable = await options.store.findReusableAssessment({
    connectedChannelId: run.connectedChannelId,
    threadId: workItem.threadId,
    contentHash: workItem.contentHash,
  });
  if (reusable) {
    await options.store.markThreadSucceeded({
      runId: run.id,
      workerId: options.workerId,
      workItemId: workItem.id,
      assessmentId: reusable.id,
      resultKind: "reused",
    });
    return;
  }

  const providerThread = await options.provider.findThread({
    connectedChannelId: run.connectedChannelId,
    windowStart: new Date(run.coverage.windowStart),
    windowEnd: new Date(run.coverage.windowEnd),
    threadId: workItem.threadId,
    contentHash: workItem.contentHash,
  });
  if (!providerThread) {
    await options.store.markThreadFailed({
      runId: run.id,
      workerId: options.workerId,
      workItemId: workItem.id,
      failureCode: "ITEM_NO_LONGER_AVAILABLE",
    });
    return;
  }

  let assessment: SyntheticAssessment;
  try {
    const raw = await options.provider.assess(providerThread);
    const parsed = syntheticAssessmentSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidAssessmentError();
    assessment = parsed.data;
  } catch (error) {
    await options.store.markThreadFailed({
      runId: run.id,
      workerId: options.workerId,
      workItemId: workItem.id,
      failureCode: itemFailureCode(error),
    });
    return;
  }

  const assessmentId = await options.store.saveAssessment({
    accountId: run.accountId,
    connectedChannelId: run.connectedChannelId,
    threadId: workItem.threadId,
    contentHash: workItem.contentHash,
    assessment,
  });
  await options.store.markThreadSucceeded({
    runId: run.id,
    workerId: options.workerId,
    workItemId: workItem.id,
    assessmentId,
    resultKind: "assessed",
  });
}
