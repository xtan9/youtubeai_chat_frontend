import "server-only";

import { z } from "zod";
import { logAppEvent } from "@/lib/observability";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

const AvailableSchema = z.object({
  outcome: z.literal("available"),
  remainingMessages: z.number().int().min(0).max(5),
});

const AdmissionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("admitted"),
    remainingMessages: z.number().int().min(0).max(4),
  }),
  z.object({
    outcome: z.literal("exhausted"),
    remainingMessages: z.literal(0),
  }),
]);

export type RegisteredFreeHeroDemoAllowanceResult =
  | z.infer<typeof AvailableSchema>
  | { readonly outcome: "unavailable" };

export type RegisteredFreeHeroDemoAdmissionResult =
  | z.infer<typeof AdmissionSchema>
  | { readonly outcome: "unavailable" };

type AllowanceInput = Readonly<{
  userId: string;
  youtubeVideoId: string;
}>;

async function callAllowanceRpc<T>(input: {
  readonly functionName:
    | "get_registered_free_hero_demo_chat_allowance"
    | "admit_registered_free_hero_demo_chat_message";
  readonly args: AllowanceInput;
  readonly schema: z.ZodType<T>;
}): Promise<T | { readonly outcome: "unavailable" }> {
  const serviceRole = getServiceRoleClient();
  if (!serviceRole) {
    logAppEvent("error", "[registered-free-hero-demo] service role unavailable", {
      errorId: "REGISTERED_FREE_HERO_DEMO_ALLOWANCE_NO_CLIENT",
    });
    return { outcome: "unavailable" };
  }

  try {
    const { data, error } = await serviceRole.rpc(input.functionName, {
      p_user_id: input.args.userId,
      p_youtube_video_id: input.args.youtubeVideoId,
    });
    if (error) {
      logAppEvent("error", "[registered-free-hero-demo] allowance RPC failed", {
        errorId: "REGISTERED_FREE_HERO_DEMO_ALLOWANCE_RPC_FAILED",
        functionName: input.functionName,
        code: (error as { code?: string }).code ?? null,
      });
      return { outcome: "unavailable" };
    }

    const parsed = input.schema.safeParse(data);
    if (!parsed.success) {
      logAppEvent("error", "[registered-free-hero-demo] invalid allowance result", {
        errorId: "REGISTERED_FREE_HERO_DEMO_ALLOWANCE_INVALID_RESULT",
        functionName: input.functionName,
        errorClass: "SchemaMismatch",
      });
      return { outcome: "unavailable" };
    }
    return parsed.data;
  } catch (error) {
    logAppEvent("error", "[registered-free-hero-demo] allowance RPC threw", {
      errorId: "REGISTERED_FREE_HERO_DEMO_ALLOWANCE_RPC_THREW",
      functionName: input.functionName,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return { outcome: "unavailable" };
  }
}

export function getRegisteredFreeHeroDemoChatAllowance(
  input: AllowanceInput,
): Promise<RegisteredFreeHeroDemoAllowanceResult> {
  return callAllowanceRpc({
    functionName: "get_registered_free_hero_demo_chat_allowance",
    args: input,
    schema: AvailableSchema,
  });
}

export function admitRegisteredFreeHeroDemoChatMessage(
  input: AllowanceInput,
): Promise<RegisteredFreeHeroDemoAdmissionResult> {
  return callAllowanceRpc({
    functionName: "admit_registered_free_hero_demo_chat_message",
    args: input,
    schema: AdmissionSchema,
  });
}
