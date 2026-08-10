import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import { captureProjectVideoProcessingEvent } from "@/lib/analytics/server";
import { recordProjectAnalyticsTransition } from "@/lib/analytics/project-server";
import type { ProjectVideoProcessingEventProperties } from "@/lib/analytics/project-video-processing";
import type { RequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { createSummaryRunController } from "@/lib/summary-run/summary-run";
import { runServerSummaryRun } from "@/lib/summary-run/server-summary-run";
import { loadProjectSourceSet, type ProjectSourceSet } from "./project-source-set";
import type { ProjectSubject } from "./project-subject";

const ProjectVideoProcessingStartRpcSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("unauthenticated") }).passthrough(),
  z.object({ outcome: z.literal("invalid_video") }).passthrough(),
  z.object({ outcome: z.literal("missing") }).passthrough(),
  z
    .object({
      outcome: z.enum(["conflict", "limit_reached"]),
      revision: z.number().int().nonnegative(),
      ownsProcessing: z.literal(false),
    })
    .passthrough(),
  z
    .object({
      outcome: z.enum(["already_ready", "already_processing"]),
      revision: z.number().int().nonnegative(),
      videoId: z.uuid(),
      ordinal: z.number().int().min(1).max(5),
      ownsProcessing: z.literal(false),
    })
    .passthrough(),
  z
    .object({
      outcome: z.enum(["started", "retry_started"]),
      revision: z.number().int().nonnegative(),
      videoId: z.uuid(),
      ordinal: z.number().int().min(1).max(5),
      attemptId: z.uuid(),
      ownsProcessing: z.literal(true),
    })
    .passthrough(),
]);

const FinalizeRpcSchema = z
  .object({
    outcome: z.enum([
      "transitioned",
      "missing",
      "membership_missing",
      "stale_attempt",
      "invalid_status",
      "evidence_missing",
    ]),
    revision: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const ExpiredAttemptSchema = z.object({
  ordinal: z.number().int().min(1).max(5),
  processingSeconds: z.number().finite().nonnegative(),
});

const ExpireRpcSchema = z
  .object({
    outcome: z.enum(["missing", "unchanged", "expired"]),
    revision: z.number().int().nonnegative().optional(),
    expiredCount: z.number().int().nonnegative().optional(),
    expiredAttempts: z.array(ExpiredAttemptSchema).optional(),
  })
  .passthrough();

export type ProjectVideoProcessingStartKind =
  | "started"
  | "retry_started"
  | "already_ready"
  | "already_processing"
  | "limit_reached"
  | "conflict"
  | "invalid_video"
  | "missing"
  | "forbidden"
  | "unavailable";

export type ProjectVideoProcessingLease = Readonly<{
  projectId: string;
  videoId: string;
  youtubeUrl: string;
  attemptId: string;
  ordinal: number;
  sourceSetRevision: number;
  attemptKind: "new" | "retry";
}>;

export type PreparedProjectVideoProcessing = Readonly<{
  response: Response;
  abort: () => void;
}>;

export type ProjectVideoProcessingStartOutcome = Readonly<{
  kind: ProjectVideoProcessingStartKind;
  sourceSetRevision?: number;
  sourceSet?: ProjectSourceSet;
  lease?: ProjectVideoProcessingLease;
}>;

type SafeDatabaseError = { code?: string; message?: string } | null;

function logFailure(operation: string, subject: ProjectSubject, error: unknown) {
  const safeError = error as SafeDatabaseError;
  console.error(`[project-video-processing] ${operation} failed`, {
    projectId: subject.projectId,
    ownerId: subject.ownerId,
    code: safeError?.code,
    message: safeError?.message,
  });
}

async function refreshedOutcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  kind: ProjectVideoProcessingStartKind,
  sourceSetRevision: number,
  lease?: ProjectVideoProcessingLease,
): Promise<ProjectVideoProcessingStartOutcome> {
  const refreshed = await loadProjectSourceSet(supabase, subject);
  if (refreshed.kind !== "resolved") {
    // Once the database grants an attempt lease, the caller must retain it
    // even if the convenience reload fails. Otherwise the only processing
    // owner would disappear before scheduling work and the membership would
    // remain stranded until its stale lease expires.
    if (lease) return { kind, sourceSetRevision, lease };
    return {
      kind: refreshed.kind === "forbidden" ? "forbidden" : "unavailable",
    };
  }
  return { kind, sourceSetRevision, sourceSet: refreshed.value, lease };
}

export async function startProjectVideoProcessing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  youtubeVideoId: string,
  expectedRevision: number,
): Promise<ProjectVideoProcessingStartOutcome> {
  let data: unknown;
  try {
    const result = await supabase.rpc("start_project_video_processing", {
      p_project_id: subject.projectId,
      p_youtube_video_id: youtubeVideoId,
      p_expected_revision: expectedRevision,
    });
    if (result.error) {
      logFailure("start", subject, result.error);
      return {
        kind: result.error.code === "42501" ? "forbidden" : "unavailable",
      };
    }
    data = result.data;
  } catch (error) {
    logFailure("start", subject, error);
    return { kind: "unavailable" };
  }

  const parsed = ProjectVideoProcessingStartRpcSchema.safeParse(data);
  if (!parsed.success) {
    logFailure("start contract", subject, { message: "Unexpected RPC result" });
    return { kind: "unavailable" };
  }

  const rpc = parsed.data;
  if (rpc.outcome === "unauthenticated") return { kind: "forbidden" };
  if (rpc.outcome === "invalid_video") return { kind: "invalid_video" };
  if (rpc.outcome === "missing") return { kind: "missing" };

  if (rpc.outcome === "started" || rpc.outcome === "retry_started") {
    const lease: ProjectVideoProcessingLease = {
      projectId: subject.projectId,
      videoId: rpc.videoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      attemptId: rpc.attemptId,
      ordinal: rpc.ordinal,
      sourceSetRevision: rpc.revision,
      attemptKind: rpc.outcome === "started" ? "new" : "retry",
    };
    return refreshedOutcome(supabase, subject, rpc.outcome, rpc.revision, lease);
  }

  return refreshedOutcome(supabase, subject, rpc.outcome, rpc.revision);
}

async function finalizeProcessingLease(
  subject: ProjectSubject,
  lease: ProjectVideoProcessingLease,
  status: "ready" | "failed",
  failureCode: string | null,
): Promise<z.infer<typeof FinalizeRpcSchema> | null> {
  const service = getServiceRoleClient();
  if (!service) {
    logFailure("finalize: no service client", subject, null);
    return null;
  }

  try {
    const result = await service.rpc("finalize_project_video_processing", {
      p_project_id: lease.projectId,
      p_video_id: lease.videoId,
      p_attempt_id: lease.attemptId,
      p_status: status,
      p_failure_code: failureCode,
    });
    if (result.error) {
      logFailure("finalize", subject, result.error);
      return null;
    }
    const parsed = FinalizeRpcSchema.safeParse(result.data);
    if (!parsed.success) {
      logFailure("finalize contract", subject, {
        message: "Unexpected RPC result",
      });
      return null;
    }
    return parsed.data;
  } catch (error) {
    logFailure("finalize", subject, error);
    return null;
  }
}

const FAILURE_CODE_BY_CLASS = {
  authentication: "summary_authentication",
  quota: "summary_quota",
  rate_limit: "summary_rate_limit",
  request: "summary_request",
  network: "summary_network",
  processing: "summary_processing",
  protocol: "summary_protocol",
} as const;

type ProcessingFailureClass =
  ProjectVideoProcessingEventProperties["project_video_processing_failed"]["error_class"];

async function recordFailure(
  subject: ProjectSubject,
  lease: ProjectVideoProcessingLease,
  principal: RequestPrincipal,
  errorClass: ProcessingFailureClass,
  failureCode: string,
  startedAt: number,
): Promise<void> {
  const finalized = await finalizeProcessingLease(
    subject,
    lease,
    "failed",
    failureCode,
  );
  if (finalized?.outcome !== "transitioned") return;

  scheduleAnalyticsAfterResponse(() =>
    captureProjectVideoProcessingEvent(
      principal.userId,
      "project_video_processing_failed",
      {
        project_id: subject.projectId,
        status: "failed",
        ordinal: lease.ordinal,
        error_class: errorClass,
        processing_seconds: Math.max(0, (Date.now() - startedAt) / 1000),
      },
      principal.businessAnalyticsSuppressed,
    ),
  );
}

async function recordStarted(
  lease: ProjectVideoProcessingLease,
  principal: RequestPrincipal,
): Promise<void> {
  scheduleAnalyticsAfterResponse(() =>
    captureProjectVideoProcessingEvent(
      principal.userId,
      "project_video_processing_started",
      {
        project_id: lease.projectId,
        status: "processing",
        ordinal: lease.ordinal,
        attempt_kind: lease.attemptKind,
      },
      principal.businessAnalyticsSuppressed,
    ),
  );
}

export async function failProjectVideoProcessingSchedule(args: {
  subject: ProjectSubject;
  lease: ProjectVideoProcessingLease;
  principal: RequestPrincipal;
}): Promise<void> {
  const startedAt = Date.now();
  await recordStarted(args.lease, args.principal);
  await recordFailure(
    args.subject,
    args.lease,
    args.principal,
    "processing",
    "summary_processing",
    startedAt,
  );
}

export async function failProjectVideoProcessingCompletion(args: {
  subject: ProjectSubject;
  lease: ProjectVideoProcessingLease;
  principal: RequestPrincipal;
}): Promise<void> {
  // completeProjectVideoProcessing records the one started event before it
  // consumes the prepared stream. If an unexpected exception escapes that
  // boundary, finalize the same lease without duplicating the start event.
  await recordFailure(
    args.subject,
    args.lease,
    args.principal,
    "processing",
    "summary_processing",
    Date.now(),
  );
}

export async function prepareProjectVideoProcessing(
  lease: ProjectVideoProcessingLease,
  principal: RequestPrincipal,
): Promise<PreparedProjectVideoProcessing> {
  // This controller belongs to the server capability, not the browser
  // request. A refresh or disconnected client therefore cannot cancel the
  // accepted Summary Run; only an explicit scheduling failure aborts it.
  const controller = new AbortController();
  const request = new Request(
    "https://project-processing.internal/api/summarize/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        youtube_url: lease.youtubeUrl,
        include_transcript: true,
      }),
      signal: controller.signal,
    },
  );
  const response = await runServerSummaryRun(request, {
    persistence: "required",
    principal,
  });
  return { response, abort: () => controller.abort() };
}

export async function completeProjectVideoProcessing(args: {
  subject: ProjectSubject;
  lease: ProjectVideoProcessingLease;
  principal: RequestPrincipal;
  response: Response;
}): Promise<void> {
  const { subject, lease, principal, response } = args;
  const startedAt = Date.now();

  await recordStarted(lease, principal);

  const controller = createSummaryRunController({
    // Authentication is already resolved by the owned Project route. The
    // injected server capability receives that trusted principal directly;
    // this token only satisfies the controller's transport precondition.
    getAccessToken: () => "owned-project-server-run",
    elapsedTickMs: 1_000,
    // The deep server Summary Run capability already applied auth, quota,
    // cache, and processing exactly once. The controller consumes that one
    // prepared response and provides the familiar classified lifecycle.
    fetch: async () => response,
  });

  await controller.start({
    video: { youtubeUrl: lease.youtubeUrl },
    outputLanguage: null,
    includeTranscript: true,
  });

  const snapshot = controller.getSnapshot();
  if (snapshot.status === "failed") {
    await recordFailure(
      subject,
      lease,
      principal,
      snapshot.error.kind,
      FAILURE_CODE_BY_CLASS[snapshot.error.kind],
      startedAt,
    );
    return;
  }

  if (snapshot.status !== "succeeded") {
    await recordFailure(
      subject,
      lease,
      principal,
      "processing",
      "summary_processing",
      startedAt,
    );
    return;
  }

  const finalized = await finalizeProcessingLease(
    subject,
    lease,
    "ready",
    null,
  );
  if (finalized?.outcome === "evidence_missing") {
    await recordFailure(
      subject,
      lease,
      principal,
      "persistence",
      "summary_persistence",
      startedAt,
    );
    return;
  }
  if (finalized?.outcome !== "transitioned") return;

  await captureProjectVideoProcessingEvent(
    principal.userId,
    "project_video_processing_succeeded",
    {
      project_id: subject.projectId,
      status: "ready",
      ordinal: lease.ordinal,
      result_origin: snapshot.origin,
      transcription_seconds: snapshot.summary.transcriptionTime,
      summary_seconds: snapshot.summary.summaryTime,
      total_seconds:
        snapshot.summary.transcriptionTime + snapshot.summary.summaryTime,
    },
    principal.businessAnalyticsSuppressed,
  );
  await recordProjectAnalyticsTransition({
    projectId: subject.projectId,
    ownerId: principal.userId,
    trigger: "source_ready",
    occurredAt: new Date().toISOString(),
    businessAnalyticsSuppressed: principal.businessAnalyticsSuppressed,
  });
}

export async function reconcileStaleProjectVideoProcessing(
  subject: ProjectSubject,
  businessAnalyticsSuppressed = false,
): Promise<void> {
  const service = getServiceRoleClient();
  if (!service) return;

  try {
    const result = await service.rpc("expire_stale_project_video_processing", {
      p_project_id: subject.projectId,
    });
    if (result.error) {
      logFailure("expire stale", subject, result.error);
      return;
    }
    const parsed = ExpireRpcSchema.safeParse(result.data);
    if (!parsed.success) {
      logFailure("expire stale contract", subject, {
        message: "Unexpected RPC result",
      });
      return;
    }
    if (parsed.data.outcome !== "expired") return;

    for (const attempt of parsed.data.expiredAttempts ?? []) {
      await captureProjectVideoProcessingEvent(
        subject.ownerId,
        "project_video_processing_failed",
        {
          project_id: subject.projectId,
          status: "failed",
          ordinal: attempt.ordinal,
          error_class: "interrupted",
          processing_seconds: attempt.processingSeconds,
        },
        businessAnalyticsSuppressed,
      );
    }
  } catch (error) {
    logFailure("expire stale", subject, error);
  }
}
