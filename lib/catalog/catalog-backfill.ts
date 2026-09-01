import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  fetchCatalogAdmissionEvidence,
  type CatalogAdmissionEvidence,
  type CatalogProviderFailureCode,
} from "./catalog-admission";

const BACKFILL_POLICY_VERSION = "catalog-backfill-v1" as const;
const BATCH_SIZE = 4;
const VISIBILITY_TIMEOUT_SECONDS = 120;
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_SECONDS = 30;
const PROVIDER_TIMEOUT_MS = 8_000;

const ClaimedWorkSchema = z
  .object({
    msg_id: z.number().int().positive(),
    read_count: z.number().int().positive(),
    backfill_job_id: z.string().uuid(),
    summary_id: z.string().uuid(),
    video_id: z.string().uuid(),
    youtube_video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    idempotency_key: z.string().min(1),
    policy_version: z.literal(BACKFILL_POLICY_VERSION),
    priority: z.literal("cold_start"),
    trace_id: z.string().min(1),
  })
  .strict();

const BackfillOutcomeSchema = z.object({
  outcome: z.string(),
  reason: z.string().optional(),
});

export type CatalogBackfillFailureCode =
  | CatalogProviderFailureCode
  | "worker_error"
  | "invalid_message";

export type CatalogBackfillReasonCode =
  | "not_public"
  | "not_embeddable"
  | "live"
  | "upcoming"
  | "age_restricted"
  | "stale_evidence"
  | "unsupported_provider"
  | "unavailable";

export type CatalogBackfillWorkerResult = Readonly<{
  claimed: number;
  nominated: number;
  alreadyEnqueued: number;
  skipped: number;
  retried: number;
  exhausted: number;
}>;

export type CatalogBackfillWorkerOptions = Readonly<{
  batchSize?: number;
  concurrency?: number;
  maxAttempts?: number;
  baseRetryDelaySeconds?: number;
  visibilityTimeoutSeconds?: number;
}>;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && z.string().uuid().safeParse(value).success;
}

function getIneligibilityReason(
  evidence: CatalogAdmissionEvidence,
): CatalogBackfillReasonCode | null {
  if (evidence.providerPath !== "youtube_data_api_v3_videos_list") {
    return "unsupported_provider";
  }
  const evidenceExpiresAt = Date.parse(evidence.evidenceExpiresAt);
  if (!Number.isFinite(evidenceExpiresAt) || evidenceExpiresAt <= Date.now()) {
    return "stale_evidence";
  }
  if (evidence.privacyStatus !== "public") return "not_public";
  if (!evidence.embeddable) return "not_embeddable";
  if (evidence.liveStatus === "live") return "live";
  if (evidence.liveStatus === "upcoming") return "upcoming";
  if (evidence.ageRestricted) return "age_restricted";
  return null;
}

export async function runCatalogBackfillWorker(
  options: CatalogBackfillWorkerOptions = {},
): Promise<CatalogBackfillWorkerResult> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new Error("Catalog backfill worker is not configured");

  const batchSize = options.batchSize ?? BATCH_SIZE;
  const concurrency = options.concurrency ?? 1;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const baseRetryDelaySeconds =
    options.baseRetryDelaySeconds ?? BASE_RETRY_DELAY_SECONDS;
  const visibilityTimeoutSeconds =
    options.visibilityTimeoutSeconds ?? VISIBILITY_TIMEOUT_SECONDS;
  const workerConcurrency = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1;

  const claim = await supabase.rpc("claim_catalog_backfill_work", {
    p_batch_size: batchSize,
    p_visibility_timeout_seconds: visibilityTimeoutSeconds,
  });
  if (claim.error) {
    throw new Error("Catalog backfill claim failed", { cause: claim.error });
  }

  const rawWork = Array.isArray(claim.data) ? claim.data : [];
  let nominated = 0;
  let alreadyEnqueued = 0;
  let skipped = 0;
  let retried = 0;
  let exhausted = 0;

  const fail = async (
    raw: Record<string, unknown>,
    failureCode: CatalogBackfillFailureCode,
  ): Promise<void> => {
    const result = await supabase.rpc("fail_catalog_backfill_work", {
      p_msg_id: raw.msg_id,
      p_backfill_job_id: isUuid(raw.backfill_job_id)
        ? raw.backfill_job_id
        : null,
      p_failure_code: failureCode,
      p_max_attempts: maxAttempts,
      p_base_delay_seconds: baseRetryDelaySeconds,
    });
    if (result.error) {
      throw new Error("Catalog backfill retry failed", { cause: result.error });
    }
    const outcome =
      result.data && typeof result.data === "object" && "outcome" in result.data
        ? result.data.outcome
        : null;
    if (outcome === "exhausted") exhausted += 1;
    else retried += 1;
  };

  const processCandidate = async (
    candidate: unknown,
  ): Promise<"nominated" | "already_enqueued" | "skipped" | null> => {
    const raw = candidate as Record<string, unknown>;
    const parsed = ClaimedWorkSchema.safeParse(candidate);
    if (!parsed.success) {
      await fail(raw, "invalid_message");
      return null;
    }

    try {
      const work = parsed.data;
      const provider = await fetchCatalogAdmissionEvidence(work.youtube_video_id, {
        timeoutMs: PROVIDER_TIMEOUT_MS,
      });
      if (provider.outcome === "unavailable") {
        await fail(raw, provider.failureCode);
        return null;
      }

      let outcome: "nominated" | "already_enqueued" | "skipped" = "skipped";
      let reasonCode: CatalogBackfillReasonCode | null = null;

      if (provider.outcome === "absent") {
        reasonCode = "unavailable";
      } else {
        reasonCode = getIneligibilityReason(provider.evidence);
        if (!reasonCode) {
          const evidence = provider.evidence;
          const nomination = await supabase.rpc("request_catalog_nomination", {
            p_youtube_video_id: work.youtube_video_id,
            p_title: evidence.title,
            p_channel_id: evidence.channelId,
            p_channel_name: evidence.channelName,
            p_thumbnail_url: evidence.thumbnailUrl,
            p_default_language: evidence.defaultLanguage,
            p_duration_seconds: evidence.durationSeconds,
            p_published_at: evidence.publishedAt,
            p_privacy_status: evidence.privacyStatus,
            p_embeddable: evidence.embeddable,
            p_live_status: evidence.liveStatus,
            p_age_restricted: evidence.ageRestricted,
            p_provider_path: evidence.providerPath,
            p_provider_verified_at: evidence.providerVerifiedAt,
            p_evidence_expires_at: evidence.evidenceExpiresAt,
            p_trace_id: work.trace_id,
          });
          if (nomination.error) {
            await fail(raw, "worker_error");
            return null;
          }
          const nominationOutcome = BackfillOutcomeSchema.safeParse(
            nomination.data,
          );
          if (!nominationOutcome.success) {
            await fail(raw, "worker_error");
            return null;
          }
          if (nominationOutcome.data.outcome === "enqueued") {
            outcome = "nominated";
          } else if (nominationOutcome.data.outcome === "already_enqueued") {
            const requeue = await supabase.rpc("requeue_catalog_nomination", {
              p_youtube_video_id: work.youtube_video_id,
              p_trace_id: work.trace_id,
            });
            if (requeue.error) {
              await fail(raw, "worker_error");
              return null;
            }
            const requeueOutcome = BackfillOutcomeSchema.safeParse(
              requeue.data,
            );
            if (!requeueOutcome.success) {
              await fail(raw, "worker_error");
              return null;
            }
            if (requeueOutcome.data.outcome === "enqueued") {
              outcome = "nominated";
            } else if (requeueOutcome.data.outcome === "already_enqueued") {
              outcome = "already_enqueued";
            } else {
              await fail(raw, "worker_error");
              return null;
            }
          } else if (nominationOutcome.data.outcome === "skipped") {
            reasonCode =
              nominationOutcome.data.reason === "provider_unavailable"
                ? "unavailable"
                : "stale_evidence";
          } else {
            await fail(raw, "worker_error");
            return null;
          }
        }
      }

      const completion = await supabase.rpc("complete_catalog_backfill_work", {
        p_msg_id: work.msg_id,
        p_backfill_job_id: work.backfill_job_id,
        p_idempotency_key: work.idempotency_key,
        p_outcome: outcome,
        p_reason_code: reasonCode,
      });
      if (completion.error) {
        await fail(raw, "worker_error");
        return null;
      }

      return outcome;
    } catch {
      await fail(raw, "worker_error");
      return null;
    }
  };

  for (let start = 0; start < rawWork.length; start += workerConcurrency) {
    const outcomes = await Promise.all(
      rawWork
        .slice(start, start + workerConcurrency)
        .map((candidate) => processCandidate(candidate)),
    );
    for (const outcome of outcomes) {
      if (outcome === "nominated") nominated += 1;
      else if (outcome === "already_enqueued") alreadyEnqueued += 1;
      else if (outcome === "skipped") skipped += 1;
    }
  }

  return {
    claimed: rawWork.length,
    nominated,
    alreadyEnqueued,
    skipped,
    retried,
    exhausted,
  };
}
