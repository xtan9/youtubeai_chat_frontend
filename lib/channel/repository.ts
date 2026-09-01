import "server-only";

import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  InteractionReviewQueueItem,
  StoredInteractionAssessment,
} from "./review-queue";

export class InteractionAssessmentRepositoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionAssessmentRepositoryUnavailableError";
  }
}

export class InteractionAssessmentPersistenceRejectedError extends Error {
  constructor(reason: string) {
    super(`Interaction Assessment persistence rejected: ${reason}`);
    this.name = "InteractionAssessmentPersistenceRejectedError";
  }
}

const persistenceResultSchema = z
  .object({
    outcome: z.enum(["stored", "already_stored", "rejected"]),
    assessmentId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

const redactionResultSchema = z
  .object({
    outcome: z.literal("redacted"),
    redactedCount: z.number().int().nonnegative(),
  })
  .strict();

const queueItemSchema = z
  .object({
    assessmentId: z.string().min(1),
    channelId: z.string().min(1),
    commentId: z.string().min(1),
    videoId: z.string().min(1),
    videoTitle: z.string().min(1).max(300),
    category: z.enum([
      "reviewable_interaction",
      "actionable_abuse",
      "safety_flag",
    ]),
    target: z
      .enum(["channel_steward", "other_participant", "ambiguous"])
      .optional(),
    targetEvidence: z.array(z.string().max(80)).max(4).optional(),
    language: z.enum([
      "english",
      "simplified_chinese",
      "traditional_chinese",
      "chinese_english_code_switch",
      "other",
    ]),
    candidateText: z.string().min(1).max(2_000),
    topLevelCommentText: z.string().min(1).max(2_000),
    neighboringReplies: z.array(z.string().max(1_000)).max(8),
    draftEligible: z.boolean(),
    status: z.enum([
      "reviewable",
      "actionable",
      "safety_flag",
      "draft_requested",
      "draft_ready",
      "stale",
      "failed",
      "publication_uncertain",
    ]),
    assessedAt: z.string().datetime(),
  })
  .strict();

function client() {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    throw new InteractionAssessmentRepositoryUnavailableError(
      "Supabase service role is not configured",
    );
  }
  return supabase;
}

function parseRpcResult<T>(
  schema: z.ZodType<T>,
  value: unknown,
  operation: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InteractionAssessmentRepositoryUnavailableError(
      `${operation} result failed schema validation`,
    );
  }
  return parsed.data;
}

export async function persistInteractionAssessment(
  assessment: StoredInteractionAssessment,
): Promise<Readonly<{ outcome: "stored" | "already_stored"; assessmentId: string }>> {
  const result = await client().rpc("record_interaction_assessment", {
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
  if (result.error) {
    throw new InteractionAssessmentRepositoryUnavailableError(
      `Could not persist Interaction Assessment (${result.error.code ?? "unknown"})`,
    );
  }

  const parsed = parseRpcResult(
    persistenceResultSchema,
    result.data,
    "record_interaction_assessment",
  );
  if (parsed.outcome === "rejected") {
    throw new InteractionAssessmentPersistenceRejectedError(
      parsed.reason ?? "unknown",
    );
  }
  if (!parsed.assessmentId) {
    throw new InteractionAssessmentRepositoryUnavailableError(
      "record_interaction_assessment omitted assessmentId",
    );
  }
  return {
    outcome: parsed.outcome,
    assessmentId: parsed.assessmentId,
  };
}

export async function loadInteractionReviewQueue(input: Readonly<{
  accountId: string;
  connectedChannelId: string;
  limit?: number;
}>): Promise<readonly InteractionReviewQueueItem[]> {
  const limit = Number.isFinite(input.limit)
    ? Math.min(100, Math.max(1, Math.floor(input.limit!)))
    : 100;
  const result = await client().rpc("list_interaction_review_queue", {
    p_account_id: input.accountId,
    p_connected_channel_id: input.connectedChannelId,
    p_limit: limit,
  });
  if (result.error) {
    throw new InteractionAssessmentRepositoryUnavailableError(
      `Could not load Interaction Review Queue (${result.error.code ?? "unknown"})`,
    );
  }
  return parseRpcResult(
    z.array(queueItemSchema).max(100),
    result.data,
    "list_interaction_review_queue",
  );
}

export async function redactDeletedComment(input: Readonly<{
  accountId: string;
  connectedChannelId: string;
  commentId: string;
  deletedAt: string;
}>): Promise<number> {
  const result = await client().rpc("redact_deleted_interaction_comment", {
    p_account_id: input.accountId,
    p_connected_channel_id: input.connectedChannelId,
    p_comment_id: input.commentId,
    p_deleted_at: input.deletedAt,
  });
  if (result.error) {
    throw new InteractionAssessmentRepositoryUnavailableError(
      `Could not redact deleted Interaction Assessment (${result.error.code ?? "unknown"})`,
    );
  }
  const parsed = parseRpcResult(
    redactionResultSchema,
    result.data,
    "redact_deleted_interaction_comment",
  );
  return parsed.redactedCount;
}
