import {
  MAX_SCAN_THREADS,
  SCAN_ACCOUNT_HOURLY_LIMIT,
  SCAN_RUN_LEASE_MS,
  percentForProgress,
  type ScanBound,
  type ScanPagePersistenceInput,
  type ScanRun,
  type ScanRunFinishInput,
  type ScanRunStartInput,
  type ScanRunStartResult,
  type ScanRunStore,
  type ScanThreadFailureInput,
  type ScanThreadSuccessInput,
  type ScanWorkItem,
  type StoredScanAssessment,
  type SyntheticAssessment,
} from "./contracts";

type MutableRun = {
  -readonly [Key in keyof ScanRun]: ScanRun[Key];
};

type MutableWorkItem = ScanWorkItem & {
  status: "pending" | "succeeded" | "failed";
  resultKind: "assessed" | "reused" | null;
  assessmentId: string | null;
  failureCode: string | null;
};

type WorkerLease = {
  workerId: string;
  expiresAt: number;
};

type MemoryStoreOptions = Readonly<{
  now?: () => Date;
  createRunId?: () => string;
}>;

function cloneRun(run: MutableRun): ScanRun {
  return {
    ...run,
    coverage: { ...run.coverage },
    progress: { ...run.progress },
  };
}

function cloneWorkItem(item: MutableWorkItem): ScanWorkItem {
  return {
    id: item.id,
    threadId: item.threadId,
    commentId: item.commentId,
    videoId: item.videoId,
    publishedAt: item.publishedAt,
    contentHash: item.contentHash,
    position: item.position,
  };
}

function active(run: MutableRun): boolean {
  return run.status === "queued" || run.status === "running";
}

function terminal(run: MutableRun): boolean {
  return (
    run.status === "completed" ||
    run.status === "partial" ||
    run.status === "cancelled" ||
    run.status === "failed"
  );
}

function assessmentKey(
  connectedChannelId: string,
  threadId: string,
  contentHash: string,
): string {
  return `${connectedChannelId}\u0000${threadId}\u0000${contentHash}`;
}

function pageKey(runId: string, pageToken: string): string {
  return `${runId}\u0000${pageToken}`;
}

function iso(date: Date): string {
  return date.toISOString();
}

function validWindow(input: ScanRunStartInput): boolean {
  const start = input.windowStart.getTime();
  const end = input.windowEnd.getTime();
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= start &&
    end - start <= 7 * 24 * 60 * 60 * 1000
  );
}

function updateProgress(run: MutableRun): void {
  const processedThreads =
    run.coverage.threadsAssessed +
    run.coverage.threadsReused +
    run.coverage.threadsFailed;
  run.progress = {
    processedThreads,
    totalThreads: run.coverage.threadsDiscovered,
    percent: percentForProgress(
      processedThreads,
      run.coverage.threadsDiscovered,
    ),
  };
}

function newRun(input: ScanRunStartInput, id: string, createdAt: Date): MutableRun {
  const coverage = {
    pages: 0,
    threadsDiscovered: 0,
    threadsAssessed: 0,
    threadsReused: 0,
    threadsFailed: 0,
    windowStart: iso(input.windowStart),
    windowEnd: iso(input.windowEnd),
    oldestThreadAt: null,
    newestThreadAt: null,
    bound: null as ScanBound | null,
    boundPreventedCompleteCoverage: false,
    completeWithinBounds: false,
  };
  return {
    id,
    accountId: input.accountId,
    connectedChannelId: input.connectedChannelId,
    provider: "synthetic",
    status: "queued",
    outcome: null,
    retryOf: input.retryOf,
    createdAt: iso(createdAt),
    startedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    failureCode: null,
    nextPageToken: null,
    sourceExhausted: false,
    coverage,
    progress: {
      processedThreads: 0,
      totalThreads: 0,
      percent: 0,
    },
  };
}

export class InMemoryScanRunStore implements ScanRunStore {
  private readonly runs = new Map<string, MutableRun>();
  private readonly leases = new Map<string, WorkerLease>();
  private readonly pages = new Set<string>();
  private readonly work = new Map<string, MutableWorkItem[]>();
  private readonly assessments = new Map<string, StoredScanAssessment>();
  private sequence = 0;
  private assessmentSequence = 0;

  private readonly now: () => Date;
  private readonly createRunId: () => string;

  constructor(options: MemoryStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createRunId =
      options.createRunId ??
      (() => {
        this.sequence += 1;
        return `memory-scan-run-${this.sequence}`;
      });
  }

  async startRun(input: ScanRunStartInput): Promise<ScanRunStartResult> {
    if (
      !input.accountId ||
      !input.connectedChannelId ||
      input.provider !== "synthetic" ||
      !validWindow(input)
    ) {
      return { kind: "invalid" };
    }

    const createdAt = input.startedAt ?? this.now();
    const cutoff = createdAt.getTime() - 60 * 60 * 1000;
    const recentStarts = [...this.runs.values()].filter(
      (run) =>
        run.accountId === input.accountId &&
        new Date(run.createdAt).getTime() >= cutoff,
    );

    const concurrent = [...this.runs.values()].find(
      (run) =>
        run.connectedChannelId === input.connectedChannelId && active(run),
    );
    if (concurrent) return { kind: "concurrent", run: cloneRun(concurrent) };

    if (input.retryOf) {
      const previous = this.runs.get(input.retryOf);
      if (
        !previous ||
        previous.accountId !== input.accountId ||
        previous.connectedChannelId !== input.connectedChannelId ||
        !terminal(previous)
      ) {
        return { kind: "retry_unavailable" };
      }
    }

    if (recentStarts.length >= SCAN_ACCOUNT_HOURLY_LIMIT) {
      const oldest = recentStarts
        .map((run) => new Date(run.createdAt).getTime())
        .sort((left, right) => left - right)[0];
      return {
        kind: "rate_limited",
        retryAt: Number.isFinite(oldest)
          ? new Date(oldest + 60 * 60 * 1000).toISOString()
          : null,
      };
    }

    const run = newRun(input, this.createRunId(), createdAt);
    this.runs.set(run.id, run);
    this.work.set(run.id, []);
    return { kind: "started", run: cloneRun(run) };
  }

  async getRun(runId: string, accountId?: string): Promise<ScanRun | null> {
    const run = this.runs.get(runId);
    if (!run || (accountId && run.accountId !== accountId)) return null;
    return cloneRun(run);
  }

  async listRuns(
    accountId: string,
    connectedChannelId?: string,
  ): Promise<ScanRun[]> {
    return [...this.runs.values()]
      .filter(
        (run) =>
          run.accountId === accountId &&
          (!connectedChannelId || run.connectedChannelId === connectedChannelId),
      )
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      )
      .map(cloneRun);
  }

  async acquireRun(
    runId: string,
    workerId: string,
    now: Date,
  ): Promise<ScanRun | null> {
    const run = this.runs.get(runId);
    if (!run || !active(run)) return null;

    if (run.cancelRequestedAt) {
      run.status = "cancelled";
      run.outcome = "cancelled";
      run.completedAt ??= iso(now);
      this.leases.delete(runId);
      return null;
    }

    const lease = this.leases.get(runId);
    if (
      run.status === "running" &&
      lease &&
      lease.workerId !== workerId &&
      lease.expiresAt > now.getTime()
    ) {
      return null;
    }

    run.status = "running";
    run.startedAt ??= iso(now);
    this.leases.set(runId, {
      workerId,
      expiresAt: now.getTime() + SCAN_RUN_LEASE_MS,
    });
    return cloneRun(run);
  }

  async heartbeat(runId: string, workerId: string, now: Date): Promise<void> {
    const run = this.runs.get(runId);
    const lease = this.leases.get(runId);
    if (!run || run.status !== "running" || lease?.workerId !== workerId) {
      throw new Error("scan worker lease is no longer owned");
    }
    lease.expiresAt = now.getTime() + SCAN_RUN_LEASE_MS;
  }

  async persistPage(input: ScanPagePersistenceInput): Promise<void> {
    const run = this.runs.get(input.runId);
    const lease = this.leases.get(input.runId);
    if (!run || run.status !== "running" || lease?.workerId !== input.workerId) {
      throw new Error("scan worker lease is no longer owned");
    }
    const key = pageKey(input.runId, input.pageToken);
    if (this.pages.has(key)) return;
    this.pages.add(key);

    const items = this.work.get(input.runId) ?? [];
    const known = new Set(
      items.map((item) => `${item.threadId}\u0000${item.contentHash}`),
    );
    let position = run.coverage.threadsDiscovered;
    let discovered = 0;
    for (const observation of input.threads) {
      const observedAt = new Date(observation.publishedAt).getTime();
      if (
        !observation.isTopLevel ||
        !Number.isFinite(observedAt) ||
        observedAt < new Date(run.coverage.windowStart).getTime() ||
        observedAt > new Date(run.coverage.windowEnd).getTime() ||
        position >= MAX_SCAN_THREADS
      ) {
        continue;
      }
      const observationKey = `${observation.threadId}\u0000${observation.contentHash}`;
      if (known.has(observationKey)) continue;
      known.add(observationKey);
      position += 1;
      discovered += 1;
      items.push({
        id: `memory-work-${input.runId}-${position}`,
        threadId: observation.threadId,
        commentId: observation.commentId,
        videoId: observation.videoId,
        publishedAt: observation.publishedAt,
        contentHash: observation.contentHash,
        position,
        status: "pending",
        resultKind: null,
        assessmentId: null,
        failureCode: null,
      });
      if (
        run.coverage.newestThreadAt === null ||
        observedAt > new Date(run.coverage.newestThreadAt).getTime()
      ) {
        run.coverage = {
          ...run.coverage,
          newestThreadAt: observation.publishedAt,
        };
      }
      if (
        run.coverage.oldestThreadAt === null ||
        observedAt < new Date(run.coverage.oldestThreadAt).getTime()
      ) {
        run.coverage = {
          ...run.coverage,
          oldestThreadAt: observation.publishedAt,
        };
      }
    }
    this.work.set(input.runId, items);

    const bound = input.bound ?? run.coverage.bound;
    run.coverage = {
      ...run.coverage,
      pages: run.coverage.pages + 1,
      threadsDiscovered: run.coverage.threadsDiscovered + discovered,
      bound,
      boundPreventedCompleteCoverage:
        run.coverage.boundPreventedCompleteCoverage ||
        input.boundPreventedCompleteCoverage,
      completeWithinBounds:
        input.sourceExhausted &&
        !input.boundPreventedCompleteCoverage &&
        bound === null,
    };
    run.nextPageToken = input.nextPageToken;
    run.sourceExhausted = input.sourceExhausted;
    updateProgress(run);
  }

  async nextPendingThread(runId: string): Promise<ScanWorkItem | null> {
    const items = this.work.get(runId) ?? [];
    const pending = items.find((item) => item.status === "pending");
    return pending ? cloneWorkItem(pending) : null;
  }

  async findReusableAssessment(input: {
    connectedChannelId: string;
    threadId: string;
    contentHash: string;
  }): Promise<StoredScanAssessment | null> {
    const result = this.assessments.get(
      assessmentKey(
        input.connectedChannelId,
        input.threadId,
        input.contentHash,
      ),
    );
    return result ? { ...result, assessment: { ...result.assessment } } : null;
  }

  async saveAssessment(input: {
    accountId: string;
    connectedChannelId: string;
    threadId: string;
    contentHash: string;
    assessment: SyntheticAssessment;
  }): Promise<string> {
    const key = assessmentKey(
      input.connectedChannelId,
      input.threadId,
      input.contentHash,
    );
    const existing = this.assessments.get(key);
    if (existing) return existing.id;
    this.assessmentSequence += 1;
    const assessment: StoredScanAssessment = {
      id: `memory-assessment-${this.assessmentSequence}`,
      connectedChannelId: input.connectedChannelId,
      threadId: input.threadId,
      contentHash: input.contentHash,
      assessment: { ...input.assessment },
    };
    this.assessments.set(key, assessment);
    return assessment.id;
  }

  private assertLease(runId: string, workerId: string): MutableRun {
    const run = this.runs.get(runId);
    const lease = this.leases.get(runId);
    if (!run || run.status !== "running" || lease?.workerId !== workerId) {
      throw new Error("scan worker lease is no longer owned");
    }
    return run;
  }

  async markThreadSucceeded(input: ScanThreadSuccessInput): Promise<void> {
    const run = this.assertLease(input.runId, input.workerId);
    const item = (this.work.get(input.runId) ?? []).find(
      (candidate) => candidate.id === input.workItemId,
    );
    if (!item || item.status !== "pending") return;
    item.status = "succeeded";
    item.resultKind = input.resultKind;
    item.assessmentId = input.assessmentId;
    run.coverage = {
      ...run.coverage,
      threadsAssessed:
        run.coverage.threadsAssessed +
        (input.resultKind === "assessed" ? 1 : 0),
      threadsReused:
        run.coverage.threadsReused +
        (input.resultKind === "reused" ? 1 : 0),
    };
    updateProgress(run);
  }

  async markThreadFailed(input: ScanThreadFailureInput): Promise<void> {
    const run = this.assertLease(input.runId, input.workerId);
    const item = (this.work.get(input.runId) ?? []).find(
      (candidate) => candidate.id === input.workItemId,
    );
    if (!item || item.status !== "pending") return;
    item.status = "failed";
    item.failureCode = input.failureCode.slice(0, 80);
    run.coverage = {
      ...run.coverage,
      threadsFailed: run.coverage.threadsFailed + 1,
    };
    updateProgress(run);
  }

  async requestCancellation(input: {
    accountId: string;
    runId: string;
  }): Promise<ScanRun | null> {
    const run = this.runs.get(input.runId);
    if (!run || run.accountId !== input.accountId) return null;
    if (active(run)) {
      const requestedAt = this.now();
      run.cancelRequestedAt ??= iso(requestedAt);
      if (run.status === "queued") {
        run.status = "cancelled";
        run.outcome = "cancelled";
        run.completedAt = iso(requestedAt);
      }
    }
    return cloneRun(run);
  }

  async finishRun(input: ScanRunFinishInput): Promise<void> {
    const run = this.runs.get(input.runId);
    const lease = this.leases.get(input.runId);
    if (!run || run.status !== "running" || lease?.workerId !== input.workerId) {
      return;
    }
    const completedAt = this.now();
    const outcome = run.cancelRequestedAt ? "cancelled" : input.outcome;
    run.status = outcome;
    run.outcome = outcome;
    run.failureCode = input.failureCode ?? run.failureCode;
    run.completedAt = iso(completedAt);
    this.leases.delete(input.runId);
  }

  async failScheduling(input: {
    accountId: string;
    runId: string;
    failureCode: string;
  }): Promise<void> {
    const run = this.runs.get(input.runId);
    if (!run || run.accountId !== input.accountId || !active(run)) return;
    run.status = "failed";
    run.outcome = "failed";
    run.failureCode = input.failureCode.slice(0, 80);
    run.completedAt = iso(this.now());
    this.leases.delete(input.runId);
  }
}
