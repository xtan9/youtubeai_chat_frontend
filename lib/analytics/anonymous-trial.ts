import { z } from "zod";

export const ANONYMOUS_TRIAL_EVENT_NAMES = [
  "anonymous_trial_message_admitted",
  "anonymous_trial_exhausted",
  "anonymous_trial_registration_selected",
  "anonymous_trial_converted",
] as const;

export type AnonymousTrialEventName =
  (typeof ANONYMOUS_TRIAL_EVENT_NAMES)[number];

const SourceSurfaceSchema = z.literal("hero_demo");
const RemainingAllowanceSchema = z.enum(["zero", "one", "two_to_four"]);

export interface AnonymousTrialEventProperties {
  anonymous_trial_message_admitted: {
    readonly source_surface: "hero_demo";
    readonly remaining_allowance: z.infer<typeof RemainingAllowanceSchema>;
  };
  anonymous_trial_exhausted: {
    readonly source_surface: "hero_demo";
  };
  anonymous_trial_registration_selected: {
    readonly source_surface: "hero_demo";
  };
  anonymous_trial_converted: {
    readonly source_surface: "hero_demo";
    readonly registration_method: "email";
  };
}

const schemas = {
  anonymous_trial_message_admitted: z
    .object({
      source_surface: SourceSurfaceSchema,
      remaining_allowance: RemainingAllowanceSchema,
    })
    .strict(),
  anonymous_trial_exhausted: z
    .object({ source_surface: SourceSurfaceSchema })
    .strict(),
  anonymous_trial_registration_selected: z
    .object({ source_surface: SourceSurfaceSchema })
    .strict(),
  anonymous_trial_converted: z
    .object({
      source_surface: SourceSurfaceSchema,
      registration_method: z.literal("email"),
    })
    .strict(),
} satisfies {
  readonly [EventName in AnonymousTrialEventName]: z.ZodType<
    AnonymousTrialEventProperties[EventName]
  >;
};

const eventNames = new Set<string>(ANONYMOUS_TRIAL_EVENT_NAMES);

export function isAnonymousTrialEventName(
  event: unknown,
): event is AnonymousTrialEventName {
  return typeof event === "string" && eventNames.has(event);
}

export function validateAnonymousTrialEvent<EventName extends AnonymousTrialEventName>(
  event: EventName,
  properties: unknown,
) {
  return schemas[event].safeParse(properties);
}

export function anonymousTrialRemainingAllowance(
  remainingMessages: number,
): "zero" | "one" | "two_to_four" {
  if (remainingMessages <= 0) return "zero";
  return remainingMessages === 1 ? "one" : "two_to_four";
}
