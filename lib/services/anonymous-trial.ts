import "server-only";

import { z } from "zod";
import { logAppEvent } from "@/lib/observability";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveAnonymousTrialAdmissionContext } from "@/lib/services/anonymous-trial-network";

const RemainingMessagesSchema = z.number().int().min(0).max(5);
const ReservationIdSchema = z.string().uuid();
const AllowanceResultSchema = z.object({
  outcome: z.literal("available"),
  remainingMessages: RemainingMessagesSchema,
}).strict();

const ReservationResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("admitted"),
    reservationId: ReservationIdSchema,
    remainingMessages: RemainingMessagesSchema,
  }),
  z.object({
    outcome: z.literal("exhausted"),
    remainingMessages: z.literal(0),
  }),
  z.object({
    outcome: z.enum(["network_limited", "concurrent", "global_shutdown"]),
    remainingMessages: RemainingMessagesSchema,
  }),
]);

const StartResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("started"),
    remainingMessages: RemainingMessagesSchema,
  }),
  z.object({
    outcome: z.enum(["already_started", "invalid"]),
    remainingMessages: RemainingMessagesSchema,
  }),
]);

const RefundResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("refunded"),
    remainingMessages: RemainingMessagesSchema,
  }),
  z.object({
    outcome: z.enum(["already_refunded", "expired", "started", "invalid"]),
    remainingMessages: RemainingMessagesSchema,
  }),
]);

export type AnonymousTrialReservationResult =
  | z.infer<typeof ReservationResultSchema>
  | { readonly outcome: "unavailable" };
export type AnonymousTrialStartResult =
  | z.infer<typeof StartResultSchema>
  | { readonly outcome: "unavailable" };
export type AnonymousTrialRefundResult =
  | z.infer<typeof RefundResultSchema>
  | { readonly outcome: "unavailable" };
export type AnonymousTrialAllowanceResult =
  | z.infer<typeof AllowanceResultSchema>
  | { readonly outcome: "unavailable" };

function logUnavailable(operation: "read" | "reserve" | "start" | "refund", detail: string) {
  logAppEvent("error", "[anonymous-trial] quota boundary unavailable", {
    errorId: "ANONYMOUS_TRIAL_QUOTA_UNAVAILABLE",
    operation,
    errorClass: detail,
  });
}

async function callAnonymousTrialRpc<T>(input: {
  readonly operation: "reserve" | "start" | "refund";
  readonly functionName:
    | "reserve_anonymous_trial_chat_message"
    | "mark_anonymous_trial_chat_message_started"
    | "refund_anonymous_trial_chat_message";
  readonly args: Record<string, string>;
  readonly schema: z.ZodType<T>;
}): Promise<T | { readonly outcome: "unavailable" }> {
  const serviceRole = getServiceRoleClient();
  if (!serviceRole) {
    logUnavailable(input.operation, "ServiceRoleUnavailable");
    return { outcome: "unavailable" };
  }

  try {
    const result = await serviceRole.rpc(input.functionName, input.args);
    if (result.error) {
      logUnavailable(input.operation, result.error.code ?? "DatabaseError");
      return { outcome: "unavailable" };
    }
    const parsed = input.schema.safeParse(result.data);
    if (!parsed.success) {
      logUnavailable(input.operation, "SchemaMismatch");
      return { outcome: "unavailable" };
    }
    return parsed.data;
  } catch (error) {
    logUnavailable(
      input.operation,
      error instanceof Error ? error.name : "AdapterError",
    );
    return { outcome: "unavailable" };
  }
}

export async function getAnonymousTrialChatAllowance(input: {
  readonly userId: string;
}): Promise<AnonymousTrialAllowanceResult> {
  const serviceRole = getServiceRoleClient();
  if (!serviceRole) {
    logUnavailable("read", "ServiceRoleUnavailable");
    return { outcome: "unavailable" };
  }
  try {
    const result = await serviceRole.rpc("get_anonymous_trial_chat_allowance", {
      p_user_id: input.userId,
    });
    if (result.error) {
      logUnavailable("read", result.error.code ?? "DatabaseError");
      return { outcome: "unavailable" };
    }
    const parsed = AllowanceResultSchema.safeParse(result.data);
    if (!parsed.success) {
      logUnavailable("read", "SchemaMismatch");
      return { outcome: "unavailable" };
    }
    return parsed.data;
  } catch (error) {
    logUnavailable("read", error instanceof Error ? error.name : "AdapterError");
    return { outcome: "unavailable" };
  }
}

export function reserveAnonymousTrialChatMessage(input: {
  readonly userId: string;
  readonly request: Request;
}): Promise<AnonymousTrialReservationResult> {
  const context = resolveAnonymousTrialAdmissionContext(input.request);
  if (!context) {
    logUnavailable("reserve", "AdmissionConfigurationUnavailable");
    return Promise.resolve({ outcome: "unavailable" });
  }
  return callAnonymousTrialRpc({
    operation: "reserve",
    functionName: "reserve_anonymous_trial_chat_message",
    args: {
      p_user_id: input.userId,
      p_network_key_hash: context.networkKeyHash,
      p_global_spend_limit_micros: String(context.globalSpendLimitMicros),
      p_reservation_cost_micros: String(context.reservationCostMicros),
      p_admission_enabled: "true",
    },
    schema: ReservationResultSchema,
  });
}

export function markAnonymousTrialChatMessageStarted(input: {
  readonly userId: string;
  readonly reservationId: string;
}): Promise<AnonymousTrialStartResult> {
  return callAnonymousTrialRpc({
    operation: "start",
    functionName: "mark_anonymous_trial_chat_message_started",
    args: {
      p_user_id: input.userId,
      p_reservation_id: input.reservationId,
    },
    schema: StartResultSchema,
  });
}

export function refundAnonymousTrialChatMessage(input: {
  readonly userId: string;
  readonly reservationId: string;
}): Promise<AnonymousTrialRefundResult> {
  return callAnonymousTrialRpc({
    operation: "refund",
    functionName: "refund_anonymous_trial_chat_message",
    args: {
      p_user_id: input.userId,
      p_reservation_id: input.reservationId,
    },
    schema: RefundResultSchema,
  });
}
