import { z } from "zod";

export const SUBSCRIPTION_DISCOVERY_SOURCE_SURFACES = [
  "global_header",
  "public_footer",
  "plan_and_billing",
  "account",
  "summary_limit",
  "video_chat_limit",
  "history_limit",
  "project_limit",
  "project_chat_limit",
  "direct_pricing",
] as const;

export const SUBSCRIPTION_DISCOVERY_PRESENTATION_STATES = [
  "pricing",
  "upgrade_to_pro",
  "pro_plan",
  "billing_issue",
  "plans",
  "activating_pro",
] as const;

export const SUBSCRIPTION_DISCOVERY_AUTHENTICATION_STATES = [
  "logged_out",
  "anonymous_session",
  "registered",
] as const;

export const SUBSCRIPTION_DISCOVERY_DEVICE_CLASSES = [
  "mobile",
  "desktop",
] as const;

// Tailwind's governed `md` breakpoint begins at 768px. Measuring against the
// same boundary keeps analytics aligned with the control the Learner saw.
export const SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY =
  "(max-width: 767px)" as const;

export const SUBSCRIPTION_DISCOVERY_EVENT_NAMES = [
  "subscription_discovery_viewed",
  "subscription_discovery_clicked",
  "pricing_viewed",
  "plan_choice_attempted",
  "checkout_started",
  "checkout_failed",
  "subscription_activated",
] as const;

export const SUBSCRIPTION_CHECKOUT_FAILURE_CATEGORIES = [
  "authentication_required",
  "subscription_ineligible",
  "plan_unavailable",
  "service_unavailable",
  "invalid_response",
  "network_error",
  "unknown",
] as const;

export const SubscriptionDiscoverySourceSurfaceSchema = z.enum(
  SUBSCRIPTION_DISCOVERY_SOURCE_SURFACES,
);
export const SubscriptionDiscoveryPresentationStateSchema = z.enum(
  SUBSCRIPTION_DISCOVERY_PRESENTATION_STATES,
);
export const SubscriptionDiscoveryAuthenticationStateSchema = z.enum(
  SUBSCRIPTION_DISCOVERY_AUTHENTICATION_STATES,
);
export const SubscriptionDiscoveryDeviceClassSchema = z.enum(
  SUBSCRIPTION_DISCOVERY_DEVICE_CLASSES,
);
export const SubscriptionCheckoutFailureCategorySchema = z.enum(
  SUBSCRIPTION_CHECKOUT_FAILURE_CATEGORIES,
);

export type SubscriptionDiscoverySourceSurface = z.infer<
  typeof SubscriptionDiscoverySourceSurfaceSchema
>;
export type SubscriptionDiscoveryPresentationState = z.infer<
  typeof SubscriptionDiscoveryPresentationStateSchema
>;
export type SubscriptionDiscoveryAuthenticationState = z.infer<
  typeof SubscriptionDiscoveryAuthenticationStateSchema
>;
export type SubscriptionDiscoveryDeviceClass = z.infer<
  typeof SubscriptionDiscoveryDeviceClassSchema
>;
export type SubscriptionCheckoutFailureCategory = z.infer<
  typeof SubscriptionCheckoutFailureCategorySchema
>;

const subscriptionDiscoveryEventNames = new Set<string>(
  SUBSCRIPTION_DISCOVERY_EVENT_NAMES,
);

export function isSubscriptionDiscoveryEventName(
  event: unknown,
): event is SubscriptionDiscoveryEventName {
  return (
    typeof event === "string" && subscriptionDiscoveryEventNames.has(event)
  );
}

const attributionShape = {
  source_surface: SubscriptionDiscoverySourceSurfaceSchema,
  presentation_state: SubscriptionDiscoveryPresentationStateSchema,
  authentication_state: SubscriptionDiscoveryAuthenticationStateSchema,
  device_class: SubscriptionDiscoveryDeviceClassSchema,
} as const;

export const SubscriptionDiscoveryAttributionSchema = z
  .object(attributionShape)
  .strict();

export type SubscriptionDiscoveryAttribution = z.infer<
  typeof SubscriptionDiscoveryAttributionSchema
>;

const selectablePlanShape = {
  plan: z.enum(["monthly", "yearly"]),
  billing_interval: z.enum(["monthly", "yearly"]),
} as const;

const activatedPlanShape = {
  plan: z.enum(["monthly", "yearly", "unknown"]),
  billing_interval: z.enum(["monthly", "yearly", "unknown"]),
} as const;

function hasMatchingBillingInterval(value: {
  plan: string;
  billing_interval: string;
}): boolean {
  return value.plan === value.billing_interval;
}

const matchingBillingIntervalIssue = {
  message: "billing_interval must match plan",
  path: ["billing_interval"],
};

const discoveryInteractionSchema = <const EventName extends string>(
  event: EventName,
) =>
  z
    .object({
      event: z.literal(event),
      properties: z.object(attributionShape).strict(),
    })
    .strict();

export const SubscriptionDiscoveryEventSchema = z.discriminatedUnion("event", [
  discoveryInteractionSchema("subscription_discovery_viewed"),
  discoveryInteractionSchema("subscription_discovery_clicked"),
  discoveryInteractionSchema("pricing_viewed"),
  z
    .object({
      event: z.literal("plan_choice_attempted"),
      properties: z
        .object({
          ...attributionShape,
          ...selectablePlanShape,
        })
        .strict()
        .refine(hasMatchingBillingInterval, matchingBillingIntervalIssue),
    })
    .strict(),
  z
    .object({
      event: z.literal("checkout_started"),
      properties: z
        .object({
          ...attributionShape,
          account_type: z.literal("free"),
          ...selectablePlanShape,
        })
        .strict()
        .refine(hasMatchingBillingInterval, matchingBillingIntervalIssue),
    })
    .strict(),
  z
    .object({
      event: z.literal("checkout_failed"),
      properties: z
        .object({
          ...attributionShape,
          account_type: z.literal("free"),
          ...selectablePlanShape,
          failure_category: SubscriptionCheckoutFailureCategorySchema,
          http_status: z.number().int().min(400).max(599).optional(),
        })
        .strict()
        .refine(hasMatchingBillingInterval, matchingBillingIntervalIssue),
    })
    .strict(),
  z
    .object({
      event: z.literal("subscription_activated"),
      properties: z
        .object({
          ...attributionShape,
          ...activatedPlanShape,
          subscription_status: z.enum(["active", "trialing"]),
        })
        .strict()
        .refine(hasMatchingBillingInterval, matchingBillingIntervalIssue),
    })
    .strict(),
]);

export const LegacyCheckoutStartedPropertiesSchema = z
  .object({
    account_type: z.literal("free"),
    source_surface: z.literal("pricing"),
    plan: z.enum(["monthly", "yearly"]),
    billing_interval: z.enum(["monthly", "yearly"]),
  })
  .strict();

export const LegacySubscriptionActivatedPropertiesSchema = z
  .object({
    source_surface: z.literal("stripe_webhook"),
    plan: z.enum(["monthly", "yearly", "unknown"]),
    billing_interval: z.enum(["monthly", "yearly", "unknown"]),
    subscription_status: z.enum(["active", "trialing"]),
  })
  .strict();

const LegacyCheckoutStartedEventSchema = z
  .object({
    event: z.literal("checkout_started"),
    properties: LegacyCheckoutStartedPropertiesSchema,
  })
  .strict();

const LegacySubscriptionActivatedEventSchema = z
  .object({
    event: z.literal("subscription_activated"),
    properties: LegacySubscriptionActivatedPropertiesSchema,
  })
  .strict();

/**
 * Runtime boundary for both the governed contract and the two pre-existing
 * conversion payloads. New emitters should use SubscriptionDiscoveryEventSchema;
 * the legacy branches exist only so current checkout and webhook producers can
 * migrate without renaming events or breaking their established properties.
 */
export const CompatibleSubscriptionDiscoveryEventSchema = z.union([
  SubscriptionDiscoveryEventSchema,
  LegacyCheckoutStartedEventSchema,
  LegacySubscriptionActivatedEventSchema,
]);

export type CompatibleSubscriptionDiscoveryProperties = z.infer<
  typeof CompatibleSubscriptionDiscoveryEventSchema
>["properties"];

export type CompatibleSubscriptionDiscoveryValidation =
  | {
      success: true;
      properties: CompatibleSubscriptionDiscoveryProperties;
    }
  | {
      success: false;
      issueCount: number;
    };

/**
 * Validates a payload at the public analytics boundary and returns only the
 * transport-neutral result that client and server adapters need.
 */
export function validateCompatibleSubscriptionDiscoveryEvent(
  event: unknown,
  properties: unknown,
): CompatibleSubscriptionDiscoveryValidation {
  const parsed = CompatibleSubscriptionDiscoveryEventSchema.safeParse({
    event,
    properties,
  });
  if (!parsed.success) {
    return { success: false, issueCount: parsed.error.issues.length };
  }
  return { success: true, properties: parsed.data.properties };
}

export type SubscriptionDiscoveryEventSink = (
  event: SubscriptionDiscoveryEvent,
) => void;

export type SubscriptionDiscoveryEvent = z.infer<
  typeof SubscriptionDiscoveryEventSchema
>;
export type SubscriptionDiscoveryEventName =
  SubscriptionDiscoveryEvent["event"];
export type SubscriptionDiscoveryEventProperties = {
  [EventName in SubscriptionDiscoveryEventName]: Extract<
    SubscriptionDiscoveryEvent,
    { event: EventName }
  >["properties"];
};
export type LegacyCheckoutStartedProperties = z.infer<
  typeof LegacyCheckoutStartedPropertiesSchema
>;
export type LegacySubscriptionActivatedProperties = z.infer<
  typeof LegacySubscriptionActivatedPropertiesSchema
>;

export function emitSubscriptionDiscoveryEvent<
  EventName extends SubscriptionDiscoveryEventName,
>(
  sink: SubscriptionDiscoveryEventSink,
  event: EventName,
  properties: SubscriptionDiscoveryEventProperties[EventName],
): void {
  sink(createSubscriptionDiscoveryEvent(event, properties));
}

export function createSubscriptionDiscoveryEvent<
  EventName extends SubscriptionDiscoveryEventName,
>(
  event: EventName,
  properties: SubscriptionDiscoveryEventProperties[EventName],
): Extract<SubscriptionDiscoveryEvent, { event: EventName }> {
  return SubscriptionDiscoveryEventSchema.parse({
    event,
    properties,
  }) as Extract<SubscriptionDiscoveryEvent, { event: EventName }>;
}
