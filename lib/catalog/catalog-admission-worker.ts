import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchCatalogAdmissionEvidence } from "./catalog-admission";

const ClaimedWorkSchema = z.object({
  msg_id: z.number().int().positive(),
  read_count: z.number().int().positive(),
  nomination_id: z.string().uuid(),
  video_id: z.string().uuid(),
  youtube_video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  idempotency_key: z.string().min(1),
  policy_version: z.literal("catalog-admission-v1"),
  priority: z.literal("high"),
  trace_id: z.string().min(1),
});

const RefreshScheduleSchema = z.object({
  scheduled: z.number().int().nonnegative(),
});

type WorkerResult = Readonly<{
  claimed: number;
  completed: number;
  retried: number;
  exhausted: number;
}>;

type MaintenanceResult = WorkerResult & Readonly<{ scheduled: number }>;

const BATCH_SIZE = 4;
const VISIBILITY_TIMEOUT_SECONDS = 120;
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_SECONDS = 30;
const PROVIDER_TIMEOUT_MS = 8_000;

export async function runCatalogAdmissionMaintenance(): Promise<MaintenanceResult> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new Error("Catalog Admission worker is not configured");

  const schedule = await supabase.rpc("schedule_catalog_admission_refresh", {
    p_batch_size: BATCH_SIZE,
  });
  if (schedule.error) {
    throw new Error("Catalog Admission refresh schedule failed", {
      cause: schedule.error,
    });
  }
  const parsedSchedule = RefreshScheduleSchema.safeParse(schedule.data);
  if (!parsedSchedule.success) {
    throw new Error("Catalog Admission refresh schedule returned invalid data");
  }

  return {
    scheduled: parsedSchedule.data.scheduled,
    ...(await runCatalogAdmissionWorker()),
  };
}

export async function runCatalogAdmissionWorker(): Promise<WorkerResult> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new Error("Catalog Admission worker is not configured");

  const claim = await supabase.rpc("claim_catalog_admission_work", {
    p_batch_size: BATCH_SIZE,
    p_visibility_timeout_seconds: VISIBILITY_TIMEOUT_SECONDS,
  });
  if (claim.error) throw new Error("Catalog Admission claim failed", { cause: claim.error });

  const rawWork = Array.isArray(claim.data) ? claim.data : [];
  let completed = 0;
  let retried = 0;
  let exhausted = 0;

  const fail = async (
    raw: Record<string, unknown>,
    failureCode:
      | "provider_timeout"
      | "provider_non_ok"
      | "provider_schema"
      | "provider_error"
      | "worker_error"
      | "invalid_message",
  ): Promise<void> => {
    const result = await supabase.rpc("fail_catalog_admission_work", {
      p_msg_id: raw.msg_id,
      p_nomination_id: raw.nomination_id,
      p_failure_code: failureCode,
      p_max_attempts: MAX_ATTEMPTS,
      p_base_delay_seconds: BASE_RETRY_DELAY_SECONDS,
    });
    if (result.error) throw new Error("Catalog Admission retry failed", { cause: result.error });
    if (
      result.data &&
      typeof result.data === "object" &&
      "outcome" in result.data &&
      result.data.outcome === "exhausted"
    ) {
      exhausted += 1;
    } else {
      retried += 1;
    }
  };

  for (const candidate of rawWork) {
    const raw = candidate as Record<string, unknown>;
    const parsed = ClaimedWorkSchema.safeParse(candidate);
    if (!parsed.success) {
      await fail(raw, "invalid_message");
      continue;
    }

    const work = parsed.data;
    const provider = await fetchCatalogAdmissionEvidence(work.youtube_video_id, {
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    if (provider.outcome === "unavailable") {
      await fail(raw, provider.failureCode);
      continue;
    }

    const evidence = provider.evidence;
    const verifiedMetadata =
      provider.outcome === "verified"
        ? {
            p_title: provider.evidence.title,
            p_channel_id: provider.evidence.channelId,
            p_channel_name: provider.evidence.channelName,
            p_thumbnail_url: provider.evidence.thumbnailUrl,
            p_default_language: provider.evidence.defaultLanguage,
            p_duration_seconds: provider.evidence.durationSeconds,
            p_published_at: provider.evidence.publishedAt,
            p_privacy_status: provider.evidence.privacyStatus,
            p_embeddable: provider.evidence.embeddable,
            p_live_status: provider.evidence.liveStatus,
            p_age_restricted: provider.evidence.ageRestricted,
          }
        : {
            p_title: null,
            p_channel_id: null,
            p_channel_name: null,
            p_thumbnail_url: null,
            p_default_language: null,
            p_duration_seconds: null,
            p_published_at: null,
            p_privacy_status: null,
            p_embeddable: null,
            p_live_status: null,
            p_age_restricted: null,
          };
    const completion = await supabase.rpc("complete_catalog_admission_work", {
      p_msg_id: work.msg_id,
      p_nomination_id: work.nomination_id,
      p_idempotency_key: work.idempotency_key,
      p_provider_outcome: provider.outcome,
      p_provider_path: evidence.providerPath,
      ...verifiedMetadata,
      p_provider_verified_at: evidence.providerVerifiedAt,
      p_evidence_expires_at: evidence.evidenceExpiresAt,
      p_policy_version: work.policy_version,
    });
    if (completion.error) {
      await fail(raw, "worker_error");
      continue;
    }
    completed += 1;
  }

  return { claimed: rawWork.length, completed, retried, exhausted };
}
