import "server-only";

import { z } from "zod";
import { CHAT_GATEWAY_PROVIDER, SPARK } from "@/lib/services/models";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  captureProjectActivityEvent,
  captureProjectActivityEventWithStatus,
} from "./server";
import type { ProjectActivityEventProperties } from "./project-activity";

export type ProjectAnalyticsTrigger =
  | "created"
  | "source_ready"
  | "search"
  | "message"
  | "artifact";

export type ProjectGenerationKind =
  | "grounded_answer"
  | "study_guide"
  | "creator_brief"
  | "project_brief";

export type ProjectTokenUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}>;

const TransitionResultSchema = z.object({
  outcome: z.enum(["activated", "already_activated", "recorded", "missing"]),
  activationKind: z.enum(["search", "message", "artifact"]).nullable().optional(),
  activationRevision: z.number().int().min(0).max(1_000_000).optional(),
  readyVideos: z.number().int().min(0).max(5).optional(),
}).strict();

const ActivationExportSchema = z
  .object({
    projectId: z.string().uuid(),
    ownerId: z.string().uuid(),
    activationRevision: z.number().int().min(1).max(1_000_000),
    activationKind: z.enum(["search", "message", "artifact"]),
    activatedAt: z.string().datetime({ offset: true }),
    readyVideos: z.number().int().min(2).max(5),
    leaseToken: z.string().uuid(),
  })
  .strict();

const ActivationClaimResultSchema = z
  .object({
    outcome: z.enum(["claimed", "empty"]),
    exports: z.array(ActivationExportSchema).max(100),
  })
  .strict();

const ActivationAckResultSchema = z
  .object({ outcome: z.enum(["acknowledged", "stale", "missing"]) })
  .strict();

const GenerationRecordResultSchema = z.object({
  outcome: z.enum(["inserted", "deduplicated", "inactive", "missing"]),
}).strict();

export type ProjectGenerationUsageRecordStatus =
  | z.infer<typeof GenerationRecordResultSchema>["outcome"]
  | "suppressed"
  | "unavailable";

const RateCardSchema = z.object({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
  source: z.literal("provider_contract"),
  modelId: z.literal(SPARK),
  gatewayProvider: z.literal(CHAT_GATEWAY_PROVIDER),
  effectiveDate: z.string().date(),
  inputUsdPerMillionTokens: z.number().finite().nonnegative(),
  cachedInputUsdPerMillionTokens: z.number().finite().nonnegative(),
  outputUsdPerMillionTokens: z.number().finite().nonnegative(),
}).strict();

function configuredRateCard(): z.infer<typeof RateCardSchema> | null {
  const input = {
    version: process.env.PROJECT_MODEL_RATE_CARD_VERSION?.trim(),
    source: process.env.PROJECT_MODEL_RATE_CARD_SOURCE?.trim(),
    modelId: process.env.PROJECT_MODEL_RATE_CARD_MODEL_ID?.trim(),
    gatewayProvider:
      process.env.PROJECT_MODEL_RATE_CARD_GATEWAY_PROVIDER?.trim(),
    effectiveDate: process.env.PROJECT_MODEL_RATE_CARD_EFFECTIVE_DATE?.trim(),
    inputUsdPerMillionTokens: Number(
      process.env.PROJECT_MODEL_INPUT_USD_PER_MILLION_TOKENS,
    ),
    cachedInputUsdPerMillionTokens: Number(
      process.env.PROJECT_MODEL_CACHED_INPUT_USD_PER_MILLION_TOKENS,
    ),
    outputUsdPerMillionTokens: Number(
      process.env.PROJECT_MODEL_OUTPUT_USD_PER_MILLION_TOKENS,
    ),
  };
  if (
    !input.version ||
    !input.source ||
    !input.modelId ||
    !input.gatewayProvider ||
    !input.effectiveDate ||
    !process.env.PROJECT_MODEL_INPUT_USD_PER_MILLION_TOKENS?.trim() ||
    !process.env.PROJECT_MODEL_CACHED_INPUT_USD_PER_MILLION_TOKENS?.trim() ||
    !process.env.PROJECT_MODEL_OUTPUT_USD_PER_MILLION_TOKENS?.trim()
  ) {
    return null;
  }
  const parsed = RateCardSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function boundedDuration(durationMs: number): number {
  return Math.min(86_400_000, Math.max(0, Math.round(durationMs)));
}

type ServiceRoleClient = NonNullable<ReturnType<typeof getServiceRoleClient>>;

export type ProjectActivationDrainResult = Readonly<{
  claimed: number;
  sent: number;
  pending: number;
  unavailable: boolean;
}>;

async function drainProjectActivationOutboxWithClient(
  service: ServiceRoleClient,
  limit: number,
): Promise<ProjectActivationDrainResult> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const claim = await service.rpc("claim_project_activation_exports", {
    p_limit: boundedLimit,
  });
  if (claim.error) throw claim.error;
  const parsedClaim = ActivationClaimResultSchema.safeParse(claim.data);
  if (!parsedClaim.success) throw new Error("Unexpected activation claim result");

  let sent = 0;
  for (const activation of parsedClaim.data.exports) {
    const status = await captureProjectActivityEventWithStatus(
      activation.ownerId,
      "project_activated",
      {
        project_id: activation.projectId,
        activation_kind: activation.activationKind,
        activation_revision: activation.activationRevision,
        activation_occurred_at: activation.activatedAt,
        ready_videos: activation.readyVideos,
      },
      false,
      `project-activation:${activation.projectId}:${activation.activationRevision}`,
      activation.activatedAt,
    );
    if (status !== "sent") continue;

    const ack = await service.rpc("ack_project_activation_export", {
      p_project_id: activation.projectId,
      p_activation_revision: activation.activationRevision,
      p_lease_token: activation.leaseToken,
    });
    if (ack.error) throw ack.error;
    const parsedAck = ActivationAckResultSchema.safeParse(ack.data);
    if (!parsedAck.success) throw new Error("Unexpected activation ack result");
    if (parsedAck.data.outcome === "acknowledged") sent += 1;
  }

  return {
    claimed: parsedClaim.data.exports.length,
    sent,
    pending: parsedClaim.data.exports.length - sent,
    unavailable: false,
  };
}

export async function drainProjectActivationOutbox(
  limit = 25,
): Promise<ProjectActivationDrainResult> {
  try {
    const service = getServiceRoleClient();
    if (!service) {
      return { claimed: 0, sent: 0, pending: 0, unavailable: true };
    }
    return await drainProjectActivationOutboxWithClient(service, limit);
  } catch (error) {
    console.error("[analytics] Project activation outbox drain failed", {
      errorId: "PROJECT_ACTIVATION_OUTBOX_DRAIN_FAILED",
      error,
    });
    return { claimed: 0, sent: 0, pending: 0, unavailable: true };
  }
}

function generationProperties(args: {
  projectId: string;
  generationKind: ProjectGenerationKind;
  usage?: ProjectTokenUsage;
  durationMs: number;
}): ProjectActivityEventProperties["project_generation_cost_recorded"] {
  const base = {
    project_id: args.projectId,
    generation_kind: args.generationKind,
    model_id: SPARK,
    provider_kind: CHAT_GATEWAY_PROVIDER,
    duration_ms: boundedDuration(args.durationMs),
  } as const;
  if (!args.usage) {
    return {
      ...base,
      cost_status: "unavailable",
      error_class: "usage_unavailable",
    };
  }

  const rateCard = configuredRateCard();
  if (!rateCard) {
    return {
      ...base,
      cost_status: "unavailable",
      error_class: "rate_card_unavailable",
      input_tokens: args.usage.inputTokens,
      cached_input_tokens: args.usage.cachedInputTokens,
      output_tokens: args.usage.outputTokens,
    };
  }

  const uncachedInputTokens = args.usage.inputTokens - args.usage.cachedInputTokens;
  const costUsdMicros = Math.round(
    uncachedInputTokens * rateCard.inputUsdPerMillionTokens +
      args.usage.cachedInputTokens * rateCard.cachedInputUsdPerMillionTokens +
      args.usage.outputTokens * rateCard.outputUsdPerMillionTokens,
  );
  return {
    ...base,
    cost_status: "measured",
    input_tokens: args.usage.inputTokens,
    cached_input_tokens: args.usage.cachedInputTokens,
    output_tokens: args.usage.outputTokens,
    cost_usd_micros: costUsdMicros,
    rate_card_version: rateCard.version,
    rate_card_source: rateCard.source,
    rate_card_effective_date: rateCard.effectiveDate,
  };
}

export async function recordProjectAnalyticsTransition(args: {
  projectId: string;
  ownerId: string;
  trigger: ProjectAnalyticsTrigger;
  occurredAt: string;
  businessAnalyticsSuppressed: boolean;
}): Promise<void> {
  if (args.businessAnalyticsSuppressed) return;
  try {
    const service = getServiceRoleClient();
    if (!service) return;
    const { data, error } = await service.rpc(
      "record_project_analytics_transition",
      {
        p_project_id: args.projectId,
        p_owner_id: args.ownerId,
        p_trigger_kind: args.trigger,
        p_occurred_at: args.occurredAt,
      },
    );
    if (error) throw error;
    const parsed = TransitionResultSchema.safeParse(data);
    if (!parsed.success) return;
    await drainProjectActivationOutboxWithClient(service, 25);
  } catch (error) {
    console.error("[analytics] Project activation write failed", {
      errorId: "PROJECT_ANALYTICS_TRANSITION_FAILED",
      trigger: args.trigger,
      error,
    });
  }
}

export async function recordProjectGenerationUsage(args: {
  projectId: string;
  ownerId: string;
  operationId: string;
  generationKind: ProjectGenerationKind;
  usage?: ProjectTokenUsage;
  durationMs: number;
  businessAnalyticsSuppressed: boolean;
}): Promise<ProjectGenerationUsageRecordStatus> {
  if (args.businessAnalyticsSuppressed) return "suppressed";
  try {
    const service = getServiceRoleClient();
    if (!service) return "unavailable";
    const properties = generationProperties(args);
    const measured = properties.cost_status === "measured";
    const { data, error } = await service.rpc("record_project_generation_usage", {
      p_project_id: args.projectId,
      p_owner_id: args.ownerId,
      p_operation_id: args.operationId,
      p_generation_kind: args.generationKind,
      p_model_id: properties.model_id,
      p_provider_kind: properties.provider_kind,
      p_cost_status: properties.cost_status,
      p_input_tokens: "input_tokens" in properties ? properties.input_tokens ?? null : null,
      p_cached_input_tokens:
        "cached_input_tokens" in properties ? properties.cached_input_tokens ?? null : null,
      p_output_tokens: "output_tokens" in properties ? properties.output_tokens ?? null : null,
      p_cost_usd_micros: measured ? properties.cost_usd_micros : null,
      p_duration_ms: properties.duration_ms,
      p_rate_card_version: measured ? properties.rate_card_version : null,
      p_rate_card_source: measured ? properties.rate_card_source : null,
      p_rate_card_effective_date: measured ? properties.rate_card_effective_date : null,
      p_error_class: measured ? null : properties.error_class,
    });
    if (error) throw error;
    const parsed = GenerationRecordResultSchema.safeParse(data);
    if (!parsed.success) return "unavailable";
    if (parsed.data.outcome !== "inserted") return parsed.data.outcome;
    await captureProjectActivityEvent(
      args.ownerId,
      "project_generation_cost_recorded",
      properties,
      false,
      `project-generation:${args.projectId}:${args.operationId}:${args.generationKind}`,
    );
    return "inserted";
  } catch (error) {
    console.error("[analytics] Project generation usage write failed", {
      errorId: "PROJECT_GENERATION_USAGE_WRITE_FAILED",
      generationKind: args.generationKind,
      error,
    });
    return "unavailable";
  }
}
