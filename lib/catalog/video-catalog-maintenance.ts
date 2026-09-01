import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  runCatalogAdmissionMaintenance,
  type MaintenanceResult as CatalogAdmissionMaintenanceResult,
} from "./catalog-admission-worker";
import {
  runCatalogBackfillWorker,
  type CatalogBackfillWorkerOptions,
  type CatalogBackfillWorkerResult,
} from "./catalog-backfill";

const DEFAULT_BACKFILL_CONFIGURATION = {
  workType: "catalog_backfill",
  policyVersion: "catalog-backfill-v1",
  batchSize: 4,
  concurrency: 1,
  maxAttempts: 4,
  baseBackoffSeconds: 30,
  visibilityTimeoutSeconds: 120,
} as const;

const DEFAULT_BACKFILL_POLICY: CatalogBackfillWorkerOptions = {
  batchSize: DEFAULT_BACKFILL_CONFIGURATION.batchSize,
  concurrency: DEFAULT_BACKFILL_CONFIGURATION.concurrency,
  maxAttempts: DEFAULT_BACKFILL_CONFIGURATION.maxAttempts,
  baseRetryDelaySeconds: DEFAULT_BACKFILL_CONFIGURATION.baseBackoffSeconds,
  visibilityTimeoutSeconds:
    DEFAULT_BACKFILL_CONFIGURATION.visibilityTimeoutSeconds,
};

const ProcessingPolicySchema = z
  .object({
    workType: z.string(),
    policyVersion: z.string().min(1),
    batchSize: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    baseBackoffSeconds: z.number().int().positive(),
    visibilityTimeoutSeconds: z.number().int().positive(),
  })
  .passthrough();

const ProcessingConfigurationSchema = z.array(ProcessingPolicySchema);

const BackfillScheduleSchema = z.object({
  outcome: z.literal("scheduled"),
  scheduled: z.number().int().nonnegative(),
});

export type VideoCatalogMaintenanceResult = Readonly<{
  processing: z.infer<typeof ProcessingPolicySchema>;
  backfill: CatalogBackfillWorkerResult & { scheduled: number };
  catalogAdmission: CatalogAdmissionMaintenanceResult;
  purge: unknown;
  metrics: unknown;
}>;

function policyFromConfiguration(data: unknown): CatalogBackfillWorkerOptions {
  const parsed = ProcessingConfigurationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Catalog processing configuration returned invalid data");
  }

  const backfill = parsed.data.find(
    (policy) => policy.workType === "catalog_backfill",
  );
  if (!backfill) {
    throw new Error("Catalog backfill processing policy is not configured");
  }

  return {
    batchSize: backfill.batchSize,
    concurrency: backfill.concurrency,
    maxAttempts: backfill.maxAttempts,
    baseRetryDelaySeconds: backfill.baseBackoffSeconds,
    visibilityTimeoutSeconds: backfill.visibilityTimeoutSeconds,
  };
}

async function recordWorkerOutcome(
  supabase: NonNullable<ReturnType<typeof getServiceRoleClient>>,
  workerKind: string,
  result: {
    claimed: number;
    completed?: number;
    nominated?: number;
    alreadyEnqueued?: number;
    skipped?: number;
    deferred?: number;
    obsolete?: number;
    retried: number;
    exhausted: number;
  },
): Promise<void> {
  const recorded = await supabase.rpc("record_catalog_worker_outcome", {
    p_worker_kind: workerKind,
    p_claimed: result.claimed,
    p_completed: result.completed ?? 0,
    p_nominated: result.nominated ?? 0,
    p_already_enqueued: result.alreadyEnqueued ?? 0,
    p_skipped: result.skipped ?? 0,
    p_deferred: result.deferred ?? 0,
    p_obsolete: result.obsolete ?? 0,
    p_retried: result.retried,
    p_exhausted: result.exhausted,
  });
  if (recorded.error) {
    throw new Error("Catalog worker outcome recording failed", {
      cause: recorded.error,
    });
  }
}

export async function runVideoCatalogMaintenance(): Promise<VideoCatalogMaintenanceResult> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new Error("Video Catalog maintenance is not configured");

  const configuration = await supabase.rpc(
    "read_catalog_processing_configuration",
    {},
  );
  if (configuration.error) {
    throw new Error("Catalog processing configuration read failed", {
      cause: configuration.error,
    });
  }
  const parsedConfiguration = ProcessingConfigurationSchema.safeParse(
    configuration.data,
  );
  if (!parsedConfiguration.success) {
    throw new Error("Catalog processing configuration returned invalid data");
  }
  const backfillPolicy = parsedConfiguration.data.find(
    (policy) => policy.workType === "catalog_backfill",
  );
  const backfillOptions = backfillPolicy
    ? policyFromConfiguration(parsedConfiguration.data)
    : DEFAULT_BACKFILL_POLICY;

  // Invalidate expired admissions before any backfill re-verification starts.
  // This keeps a stale Video out of composition during the whole maintenance
  // cycle, even when both queues contain work for the same Video.
  const catalogAdmission = await runCatalogAdmissionMaintenance();
  await recordWorkerOutcome(supabase, "catalog_admission", catalogAdmission);

  const scheduled = await supabase.rpc("schedule_catalog_backfill", {
    p_batch_size: backfillOptions.batchSize,
  });
  if (scheduled.error) {
    throw new Error("Catalog backfill schedule failed", {
      cause: scheduled.error,
    });
  }
  const parsedSchedule = BackfillScheduleSchema.safeParse(scheduled.data);
  if (!parsedSchedule.success) {
    throw new Error("Catalog backfill schedule returned invalid data");
  }

  const backfillWorker = await runCatalogBackfillWorker(backfillOptions);
  await recordWorkerOutcome(supabase, "catalog_backfill", {
    ...backfillWorker,
    completed:
      backfillWorker.nominated
      + backfillWorker.alreadyEnqueued
      + backfillWorker.skipped,
  });

  const purge = await supabase.rpc("purge_catalog_audit", {
    p_batch_size: 100,
  });
  if (purge.error) {
    throw new Error("Catalog audit purge failed", { cause: purge.error });
  }

  const metrics = await supabase.rpc("read_catalog_operational_metrics", {});
  if (metrics.error) {
    throw new Error("Catalog operational metrics read failed", {
      cause: metrics.error,
    });
  }

  return {
    processing: backfillPolicy ?? DEFAULT_BACKFILL_CONFIGURATION,
    backfill: { ...backfillWorker, scheduled: parsedSchedule.data.scheduled },
    catalogAdmission,
    purge: purge.data,
    metrics: metrics.data,
  };
}
