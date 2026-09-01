import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  SYNTHETIC_TAXONOMY_VERSION,
  percentForProgress,
  scanBoundSchema,
  scanProviderSchema,
  scanRunOutcomeSchema,
  scanRunStatusSchema,
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
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type { StoredInteractionAssessment } from "@/lib/channel/review-queue";

export class ChannelScanRepositoryUnavailableError extends Error {
  constructor(message = "Channel scan persistence is unavailable") {
    super(message);
    this.name = "ChannelScanRepositoryUnavailableError";
  }
}

type ScanRunRow = {
  id: string;
  account_id: string;
  connected_channel_id: string;
  video_id: string | null;
  provider: string;
  status: string;
  outcome: string | null;
  retry_of: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancel_requested_at: string | null;
  failure_code: string | null;
  next_page_token: string | null;
  source_exhausted: boolean;
  pages_scanned: number | string;
  threads_discovered: number | string;
  threads_assessed: number | string;
  threads_reused: number | string;
  threads_failed: number | string;
  window_start: string;
  window_end: string;
  oldest_thread_at: string | null;
  newest_thread_at: string | null;
  bound_kind: string | null;
  bound_prevented_complete_coverage: boolean;
  complete_within_bounds: boolean;
};

type ScanWorkItemRow = {
  id: string;
  thread_id: string;
  comment_id: string;
  video_id: string;
  published_at: string;
  content_hash: string;
  position: number | string;
};

type AssessmentRow = {
  id: string;
  connected_channel_id: string;
  thread_id: string;
  content_hash: string;
  classification: SyntheticAssessment["classification"];
  reason_code: string;
  taxonomy_version: string;
};

const storedInteractionAssessmentSchema = z
  .object({
    assessmentId: z.string().min(1),
    accountId: z.string().min(1),
    channelId: z.string().min(1),
    commentId: z.string().min(1),
    commentTextHash: z.string().regex(/^[a-f0-9]{64}$/u),
    videoId: z.string().min(1).max(200),
    videoTitle: z.string().min(1).max(300),
    category: z.enum([
      "allowed_criticism",
      "reviewable_interaction",
      "actionable_abuse",
      "safety_flag",
    ]),
    language: z.enum([
      "english",
      "simplified_chinese",
      "traditional_chinese",
      "chinese_english_code_switch",
      "other",
    ]),
    target: z.enum(["channel_steward", "other_participant", "ambiguous"]),
    targetEvidence: z
      .array(
        z.enum([
          "direct_steward_address",
          "channel_or_steward_identity",
          "reply_to_steward_comment",
          "same_thread_steward_context",
        ]),
      )
      .max(4),
    candidateText: z.string().max(2_000).nullable(),
    topLevelCommentText: z.string().max(2_000).nullable(),
    neighboringReplies: z.array(z.string().max(1_000)).max(8),
    draftEligible: z.boolean(),
    status: z.enum([
      "reviewable",
      "actionable",
      "safety_flag",
      "dismissed",
      "marked_criticism",
      "draft_requested",
      "draft_ready",
      "stale",
      "failed",
      "published",
      "publication_uncertain",
      "deleted",
    ]),
    assessedAt: z.string().datetime(),
    scanRunId: z.string().min(1).nullable().optional(),
    supersededAt: z.string().datetime().nullable().optional(),
    deletedAt: z.string().datetime().nullable().optional(),
    candidateAuthorRole: z
      .enum(["channel_steward", "other_participant", "unknown"])
      .optional(),
  })
  .strict();

function numberValue(value: number | string): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : 0;
}

function mapRun(row: ScanRunRow): ScanRun {
  const pages = Math.max(0, numberValue(row.pages_scanned));
  const threadsDiscovered = Math.max(
    0,
    numberValue(row.threads_discovered),
  );
  const threadsAssessed = Math.max(0, numberValue(row.threads_assessed));
  const threadsReused = Math.max(0, numberValue(row.threads_reused));
  const threadsFailed = Math.max(0, numberValue(row.threads_failed));
  const status = scanRunStatusSchema.parse(row.status);
  const outcome = row.outcome === null ? null : scanRunOutcomeSchema.parse(row.outcome);
  const bound =
    row.bound_kind === null ? null : scanBoundSchema.parse(row.bound_kind);
  const provider = scanProviderSchema.safeParse(row.provider);
  if (!provider.success) {
    throw new ChannelScanRepositoryUnavailableError(
      "Channel scan row has an unsupported provider",
    );
  }

  return {
    id: row.id,
    accountId: row.account_id,
    connectedChannelId: row.connected_channel_id,
    videoId: row.video_id ?? null,
    provider: provider.data,
    status,
    outcome,
    retryOf: row.retry_of,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelRequestedAt: row.cancel_requested_at,
    failureCode: row.failure_code,
    nextPageToken: row.next_page_token,
    sourceExhausted: row.source_exhausted,
    coverage: {
      pages,
      threadsDiscovered,
      threadsAssessed,
      threadsReused,
      threadsFailed,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      oldestThreadAt: row.oldest_thread_at,
      newestThreadAt: row.newest_thread_at,
      bound,
      boundPreventedCompleteCoverage:
        row.bound_prevented_complete_coverage,
      completeWithinBounds: row.complete_within_bounds,
    },
    progress: {
      processedThreads: threadsAssessed + threadsReused + threadsFailed,
      totalThreads: threadsDiscovered,
      percent: percentForProgress(
        threadsAssessed + threadsReused + threadsFailed,
        threadsDiscovered,
      ),
    },
  };
}

function mapWorkItem(row: ScanWorkItemRow): ScanWorkItem {
  return {
    id: row.id,
    threadId: row.thread_id,
    commentId: row.comment_id,
    videoId: row.video_id,
    publishedAt: row.published_at,
    contentHash: row.content_hash,
    position: numberValue(row.position),
  };
}

function mapAssessment(row: AssessmentRow): StoredScanAssessment {
  return {
    id: row.id,
    connectedChannelId: row.connected_channel_id,
    threadId: row.thread_id,
    contentHash: row.content_hash,
    assessment: {
      classification: row.classification,
      reasonCode: row.reason_code,
      taxonomyVersion: SYNTHETIC_TAXONOMY_VERSION,
    },
  };
}

const startRpcSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("started"), runId: z.uuid() }),
  z.object({ outcome: z.literal("concurrent"), runId: z.uuid() }),
  z.object({ outcome: z.literal("rate_limited"), retryAt: z.string().nullable() }),
  z.object({ outcome: z.literal("retry_unavailable") }),
  z.object({
    outcome: z.literal("blocked"),
    code: z.string().min(1).max(80),
    reason: z.string().min(1).max(500),
  }),
  z.object({ outcome: z.literal("invalid") }),
]);

const claimRpcSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("acquired"), runId: z.uuid() }),
  z.object({ outcome: z.enum(["busy", "missing", "cancelled"]) }),
]);

async function loadRun(
  service: SupabaseClient,
  runId: string,
  accountId?: string,
): Promise<ScanRun | null> {
  let query = service.from("channel_scan_runs").select("*").eq("id", runId);
  if (accountId) query = query.eq("account_id", accountId);
  const result = await query.maybeSingle();
  if (result.error) throw new ChannelScanRepositoryUnavailableError();
  return result.data ? mapRun(result.data as ScanRunRow) : null;
}

export class PostgresScanRunStore implements ScanRunStore {
  constructor(private readonly service: SupabaseClient) {}

  async startRun(input: ScanRunStartInput): Promise<ScanRunStartResult> {
    const result = await this.service.rpc("start_channel_scan_run", {
      p_account_id: input.accountId,
      p_connected_channel_id: input.connectedChannelId,
      p_video_id: input.videoId ?? null,
      p_provider: input.provider,
      p_window_start: input.windowStart.toISOString(),
      p_window_end: input.windowEnd.toISOString(),
      p_retry_of: input.retryOf,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    const parsed = startRpcSchema.safeParse(result.data);
    if (!parsed.success) throw new ChannelScanRepositoryUnavailableError();
    if (parsed.data.outcome === "rate_limited") {
      return { kind: "rate_limited", retryAt: parsed.data.retryAt };
    }
    if (parsed.data.outcome === "retry_unavailable") {
      return { kind: "retry_unavailable" };
    }
    if (parsed.data.outcome === "blocked") {
      return {
        kind: "blocked",
        code: parsed.data.code,
        reason: parsed.data.reason,
      };
    }
    if (parsed.data.outcome === "invalid") return { kind: "invalid" };

    const run = await loadRun(this.service, parsed.data.runId, input.accountId);
    if (!run) throw new ChannelScanRepositoryUnavailableError();
    return {
      kind: parsed.data.outcome,
      run,
    };
  }

  async getRun(runId: string, accountId?: string): Promise<ScanRun | null> {
    return loadRun(this.service, runId, accountId);
  }

  async listRuns(
    accountId: string,
    connectedChannelId?: string,
  ): Promise<ScanRun[]> {
    let query = this.service
      .from("channel_scan_runs")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (connectedChannelId) {
      query = query.eq("connected_channel_id", connectedChannelId);
    }
    const result = await query;
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    return ((result.data ?? []) as ScanRunRow[]).map(mapRun);
  }

  async acquireRun(
    runId: string,
    workerId: string,
    now: Date,
  ): Promise<ScanRun | null> {
    const result = await this.service.rpc("claim_channel_scan_run", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_now: now.toISOString(),
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    const parsed = claimRpcSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.outcome !== "acquired") return null;
    const run = await loadRun(this.service, runId);
    if (!run) throw new ChannelScanRepositoryUnavailableError();
    return run;
  }

  async heartbeat(runId: string, workerId: string, now: Date): Promise<void> {
    const result = await this.service.rpc("heartbeat_channel_scan_run", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_now: now.toISOString(),
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
  }

  async persistPage(input: ScanPagePersistenceInput): Promise<void> {
    const result = await this.service.rpc("persist_channel_scan_page", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_page_token: input.pageToken,
      p_threads: input.threads,
      p_next_page_token: input.nextPageToken,
      p_source_exhausted: input.sourceExhausted,
      p_bound: input.bound,
      p_bound_prevented_complete_coverage:
        input.boundPreventedCompleteCoverage,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
  }

  async nextPendingThread(runId: string): Promise<ScanWorkItem | null> {
    const result = await this.service
      .from("channel_scan_run_threads")
      .select(
        "id, thread_id, comment_id, video_id, published_at, content_hash, position",
      )
      .eq("run_id", runId)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    return result.data ? mapWorkItem(result.data as ScanWorkItemRow) : null;
  }

  async findReusableAssessment(input: {
    connectedChannelId: string;
    threadId: string;
    contentHash: string;
  }): Promise<StoredScanAssessment | null> {
    const result = await this.service
      .from("channel_scan_assessments")
      .select(
        "id, connected_channel_id, thread_id, content_hash, classification, reason_code, taxonomy_version",
      )
      .eq("connected_channel_id", input.connectedChannelId)
      .eq("thread_id", input.threadId)
      .eq("content_hash", input.contentHash)
      .eq("taxonomy_version", SYNTHETIC_TAXONOMY_VERSION)
      .maybeSingle();
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    return result.data ? mapAssessment(result.data as AssessmentRow) : null;
  }

  async saveAssessment(input: {
    accountId: string;
    connectedChannelId: string;
    threadId: string;
    contentHash: string;
    assessment: SyntheticAssessment;
  }): Promise<string> {
    const result = await this.service.rpc("remember_channel_scan_assessment", {
      p_account_id: input.accountId,
      p_connected_channel_id: input.connectedChannelId,
      p_thread_id: input.threadId,
      p_content_hash: input.contentHash,
      p_assessment: input.assessment,
    });
    if (result.error || typeof result.data !== "string") {
      throw new ChannelScanRepositoryUnavailableError();
    }
    return result.data;
  }

  async findReusableInteractionAssessment(input: {
    accountId: string;
    connectedChannelId: string;
    commentId: string;
    contentHash: string;
  }): Promise<StoredInteractionAssessment | null> {
    const result = await this.service.rpc(
      "find_reusable_interaction_assessment",
      {
        p_account_id: input.accountId,
        p_connected_channel_id: input.connectedChannelId,
        p_comment_id: input.commentId,
        p_comment_text_hash: input.contentHash,
      },
    );
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    if (result.data === null || result.data === undefined) return null;
    const parsed = storedInteractionAssessmentSchema.safeParse(result.data);
    if (!parsed.success) throw new ChannelScanRepositoryUnavailableError();
    return parsed.data;
  }

  async saveInteractionAssessment(
    assessment: StoredInteractionAssessment,
  ): Promise<string> {
    const result = await this.service.rpc("record_interaction_assessment", {
      p_assessment_id: assessment.assessmentId,
      p_account_id: assessment.accountId,
      p_connected_channel_id: assessment.channelId,
      p_scan_run_id: assessment.scanRunId ?? null,
      p_comment_id: assessment.commentId,
      p_comment_text_hash: assessment.commentTextHash,
      p_video_id: assessment.videoId,
      p_video_title: assessment.videoTitle,
      p_category: assessment.category,
      p_language: assessment.language,
      p_target: assessment.target,
      p_target_evidence: assessment.targetEvidence,
      p_candidate_text: assessment.candidateText,
      p_top_level_comment_text: assessment.topLevelCommentText,
      p_neighboring_replies: assessment.neighboringReplies,
      p_draft_eligible: assessment.draftEligible,
      p_assessed_at: assessment.assessedAt,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    const parsed = z
      .object({
        outcome: z.enum(["stored", "already_stored"]),
        assessmentId: z.string().min(1),
      })
      .strict()
      .safeParse(result.data);
    if (!parsed.success) throw new ChannelScanRepositoryUnavailableError();
    return parsed.data.assessmentId;
  }

  async redactDeletedInteraction(input: {
    accountId: string;
    connectedChannelId: string;
    commentId: string;
    deletedAt: string;
  }): Promise<number> {
    const result = await this.service.rpc(
      "redact_deleted_interaction_comment",
      {
        p_account_id: input.accountId,
        p_connected_channel_id: input.connectedChannelId,
        p_comment_id: input.commentId,
        p_deleted_at: input.deletedAt,
      },
    );
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    const parsed = z
      .object({ outcome: z.literal("redacted"), redactedCount: z.number().int().nonnegative() })
      .strict()
      .safeParse(result.data);
    if (!parsed.success) throw new ChannelScanRepositoryUnavailableError();
    return parsed.data.redactedCount;
  }

  async markThreadSucceeded(input: ScanThreadSuccessInput): Promise<void> {
    const result = await this.service.rpc("complete_channel_scan_thread", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_work_item_id: input.workItemId,
      p_result_kind: input.resultKind,
      p_current_content_hash: input.contentHash ?? null,
      p_assessment_id:
        input.assessmentKind === "interaction" ? null : input.assessmentId,
      p_interaction_assessment_id:
        input.assessmentKind === "interaction" ? input.assessmentId : null,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
  }

  async markThreadFailed(input: ScanThreadFailureInput): Promise<void> {
    const result = await this.service.rpc("fail_channel_scan_thread", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_work_item_id: input.workItemId,
      p_failure_code: input.failureCode,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
  }

  async requestCancellation(input: {
    accountId: string;
    runId: string;
  }): Promise<ScanRun | null> {
    const result = await this.service.rpc("request_channel_scan_cancellation", {
      p_account_id: input.accountId,
      p_run_id: input.runId,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
    if (result.data !== true && result.data !== false) {
      throw new ChannelScanRepositoryUnavailableError();
    }
    return loadRun(this.service, input.runId, input.accountId);
  }

  async finishRun(input: ScanRunFinishInput): Promise<void> {
    const result = await this.service.rpc("finish_channel_scan_run", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_outcome: input.outcome,
      p_failure_code: input.failureCode ?? null,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
  }

  async failScheduling(input: {
    accountId: string;
    runId: string;
    failureCode: string;
  }): Promise<void> {
    const result = await this.service.rpc("fail_channel_scan_scheduling", {
      p_account_id: input.accountId,
      p_run_id: input.runId,
      p_failure_code: input.failureCode,
    });
    if (result.error) throw new ChannelScanRepositoryUnavailableError();
  }
}

export function createPostgresScanRunStore(): ScanRunStore {
  const service = getServiceRoleClient();
  if (!service) throw new ChannelScanRepositoryUnavailableError();
  return new PostgresScanRunStore(service);
}
