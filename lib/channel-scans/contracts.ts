import { z } from "zod";
import type { StoredInteractionAssessment } from "@/lib/channel/review-queue";

/**
 * Channel scans are deliberately bounded in the domain contract, not only in
 * the synthetic adapter. A future provider must satisfy these same limits.
 */
export const SCAN_WINDOW_DAYS = 7;
export const MAX_SCAN_THREADS = 200;
export const SCAN_PAGE_SIZE = 50;
export const SCAN_ACCOUNT_HOURLY_LIMIT = 4;
export const SCAN_RUN_LEASE_MS = 2 * 60 * 1000;
export const SYNTHETIC_SCAN_PROVIDER = "synthetic" as const;
export const YOUTUBE_SCAN_PROVIDER = "youtube" as const;
export const SYNTHETIC_TAXONOMY_VERSION = "synthetic-interaction-v1";

export const scanProviderSchema = z.enum([
  SYNTHETIC_SCAN_PROVIDER,
  YOUTUBE_SCAN_PROVIDER,
]);
export type ScanProviderKind = z.infer<typeof scanProviderSchema>;

/** YouTube video IDs are opaque, URL-safe 11-character identifiers. */
export const youtubeVideoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/u);

export const scanRunOutcomeSchema = z.enum([
  "completed",
  "partial",
  "cancelled",
  "failed",
]);
export type ScanRunOutcome = z.infer<typeof scanRunOutcomeSchema>;

export const scanRunStatusSchema = z.union([
  z.literal("queued"),
  z.literal("running"),
  scanRunOutcomeSchema,
]);
export type ScanRunStatus = z.infer<typeof scanRunStatusSchema>;

export const scanStartRequestSchema = z.object({
  connectedChannelId: z.string().trim().min(1).max(200),
  provider: scanProviderSchema.optional().default(SYNTHETIC_SCAN_PROVIDER),
  videoId: youtubeVideoIdSchema.nullable().optional().default(null),
  retryOf: z.uuid().nullable().optional().default(null),
});

export const scanRunIdSchema = z.uuid();

export const scanBoundSchema = z.enum([
  "thread_limit",
  "time_window",
]);
export type ScanBound = z.infer<typeof scanBoundSchema>;

export const syntheticClassificationSchema = z.enum([
  "allowed_criticism",
  "actionable_abuse",
  "reviewable",
  "safety_flag",
]);

export const syntheticAssessmentSchema = z.object({
  classification: syntheticClassificationSchema,
  reasonCode: z.string().trim().min(1).max(80),
  taxonomyVersion: z.literal(SYNTHETIC_TAXONOMY_VERSION),
});
export type SyntheticAssessment = z.infer<typeof syntheticAssessmentSchema>;

export type ScanThreadObservation = Readonly<{
  threadId: string;
  commentId: string;
  videoId: string;
  publishedAt: string;
  contentHash: string;
  isTopLevel: true;
}>;

export type ScanWorkItem = Readonly<{
  id: string;
  threadId: string;
  commentId: string;
  videoId: string;
  publishedAt: string;
  contentHash: string;
  position: number;
}>;

export type StoredScanAssessment = Readonly<{
  id: string;
  connectedChannelId: string;
  threadId: string;
  contentHash: string;
  assessment: SyntheticAssessment;
}>;

export type ScanRunCoverage = Readonly<{
  pages: number;
  threadsDiscovered: number;
  threadsAssessed: number;
  threadsReused: number;
  threadsFailed: number;
  windowStart: string;
  windowEnd: string;
  oldestThreadAt: string | null;
  newestThreadAt: string | null;
  bound: ScanBound | null;
  boundPreventedCompleteCoverage: boolean;
  completeWithinBounds: boolean;
}>;

export type ScanRunProgress = Readonly<{
  processedThreads: number;
  totalThreads: number;
  percent: number;
}>;

export type ScanRun = Readonly<{
  id: string;
  accountId: string;
  connectedChannelId: string;
  videoId: string | null;
  provider: ScanProviderKind;
  status: ScanRunStatus;
  outcome: ScanRunOutcome | null;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  failureCode: string | null;
  nextPageToken: string | null;
  sourceExhausted: boolean;
  coverage: ScanRunCoverage;
  progress: ScanRunProgress;
}>;

export type PublicScanRun = Readonly<{
  id: string;
  connectedChannelId: string;
  videoId: string | null;
  failureCode: string | null;
  status: ScanRunStatus;
  outcome: ScanRunOutcome | null;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  coverage: ScanRunCoverage;
  progress: ScanRunProgress;
}>;

export type ScanRunStartInput = Readonly<{
  accountId: string;
  connectedChannelId: string;
  videoId?: string | null;
  provider: ScanProviderKind;
  windowStart: Date;
  windowEnd: Date;
  retryOf: string | null;
  startedAt?: Date;
}>;

export type ScanRunStartResult =
  | Readonly<{ kind: "started"; run: ScanRun }>
  | Readonly<{ kind: "concurrent"; run: ScanRun }>
  | Readonly<{ kind: "rate_limited"; retryAt: string | null }>
  | Readonly<{ kind: "retry_unavailable" }>
  | Readonly<{ kind: "blocked"; code: string; reason: string }>
  | Readonly<{ kind: "invalid" }>;

export type ScanPagePersistenceInput = Readonly<{
  runId: string;
  workerId: string;
  pageToken: string;
  threads: readonly ScanThreadObservation[];
  nextPageToken: string | null;
  sourceExhausted: boolean;
  bound: ScanBound | null;
  boundPreventedCompleteCoverage: boolean;
}>;

export type ScanThreadSuccessInput = Readonly<{
  runId: string;
  workerId: string;
  workItemId: string;
  assessmentId: string;
  resultKind: "assessed" | "reused";
  assessmentKind?: "synthetic" | "interaction";
  /** The provider's current hash after revalidation, when it changed. */
  contentHash?: string;
}>;

export type ScanThreadFailureInput = Readonly<{
  runId: string;
  workerId: string;
  workItemId: string;
  failureCode: string;
}>;

export type ScanRunFinishInput = Readonly<{
  runId: string;
  workerId: string;
  outcome: ScanRunOutcome;
  failureCode?: string | null;
}>;

export interface ScanRunStore {
  startRun(input: ScanRunStartInput): Promise<ScanRunStartResult>;
  getRun(runId: string, accountId?: string): Promise<ScanRun | null>;
  listRuns(accountId: string, connectedChannelId?: string): Promise<ScanRun[]>;
  acquireRun(
    runId: string,
    workerId: string,
    now: Date,
  ): Promise<ScanRun | null>;
  heartbeat(runId: string, workerId: string, now: Date): Promise<void>;
  persistPage(input: ScanPagePersistenceInput): Promise<void>;
  nextPendingThread(runId: string): Promise<ScanWorkItem | null>;
  findReusableAssessment(input: {
    connectedChannelId: string;
    threadId: string;
    contentHash: string;
  }): Promise<StoredScanAssessment | null>;
  saveAssessment(input: {
    accountId: string;
    connectedChannelId: string;
    threadId: string;
    contentHash: string;
    assessment: SyntheticAssessment;
  }): Promise<string>;
  findReusableInteractionAssessment?(input: {
    accountId: string;
    connectedChannelId: string;
    commentId: string;
    contentHash: string;
  }): Promise<StoredInteractionAssessment | null>;
  saveInteractionAssessment?(assessment: StoredInteractionAssessment): Promise<string>;
  redactDeletedInteraction?(input: {
    accountId: string;
    connectedChannelId: string;
    commentId: string;
    deletedAt: string;
  }): Promise<number>;
  markThreadSucceeded(input: ScanThreadSuccessInput): Promise<void>;
  markThreadFailed(input: ScanThreadFailureInput): Promise<void>;
  requestCancellation(input: {
    accountId: string;
    runId: string;
  }): Promise<ScanRun | null>;
  finishRun(input: ScanRunFinishInput): Promise<void>;
  failScheduling(input: {
    accountId: string;
    runId: string;
    failureCode: string;
  }): Promise<void>;
}

export function serializeScanRun(run: ScanRun): PublicScanRun {
  return {
    id: run.id,
    connectedChannelId: run.connectedChannelId,
    videoId: run.videoId,
    failureCode: run.failureCode,
    status: run.status,
    outcome: run.outcome,
    retryOf: run.retryOf,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    cancelRequestedAt: run.cancelRequestedAt,
    coverage: run.coverage,
    progress: run.progress,
  };
}

export function scanWindowFor(now: Date): {
  readonly windowStart: Date;
  readonly windowEnd: Date;
} {
  const windowEnd = new Date(now.getTime());
  const windowStart = new Date(
    windowEnd.getTime() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  return { windowStart, windowEnd };
}

export function percentForProgress(
  processedThreads: number,
  totalThreads: number,
): number {
  if (totalThreads <= 0) return 0;
  return Math.min(100, Math.round((processedThreads / totalThreads) * 100));
}
