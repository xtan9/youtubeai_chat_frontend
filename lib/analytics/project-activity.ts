import { z } from "zod";

const ProjectIdSchema = z.string().uuid();
const BoundedCountSchema = z.number().int().min(0).max(1_000_000);
const BoundedOrdinalSchema = z.number().int().min(1).max(1_000_000);
const DurationMsSchema = z.number().int().min(0).max(86_400_000);
const CitationBasePropertiesSchema = z.object({
  project_id: ProjectIdSchema,
  citation_ordinal: z.number().int().min(1).max(100),
  source_ordinal: z.number().int().min(1).max(5),
  timestamp_seconds: z.number().finite().nonnegative().max(86_400),
});

const ProjectCitationPropertiesSchema = z.discriminatedUnion(
  "citation_context",
  [
    CitationBasePropertiesSchema.extend({
      citation_context: z.literal("grounded_answer"),
      answer_id: z.string().uuid(),
      message_ordinal: BoundedOrdinalSchema,
    }).strict(),
    CitationBasePropertiesSchema.extend({
      citation_context: z.literal("artifact"),
      artifact_id: z.string().uuid(),
      artifact_kind: z.enum(["study_guide", "creator_brief", "project_brief"]),
    }).strict(),
  ],
);

const ProjectMessagePropertiesSchema = z
  .object({
    project_id: ProjectIdSchema,
    message_ordinal: BoundedOrdinalSchema,
    message_kind: z.enum(["first", "subsequent"]),
    tier: z.enum(["free", "pro"]),
    mode: z.enum([
      "question",
      "common_themes",
      "compare_viewpoints",
      "find_gaps",
      "project_assessment",
    ]),
  })
  .strict()
  .superRefine((properties, context) => {
    const expected = properties.message_ordinal === 1 ? "first" : "subsequent";
    if (properties.message_kind !== expected) {
      context.addIssue({
        code: "custom",
        message: "Project message kind must match the bounded ordinal.",
      });
    }
  });

const MeasuredGenerationCostPropertiesSchema = z
  .object({
    project_id: ProjectIdSchema,
    generation_kind: z.enum([
      "grounded_answer",
      "study_guide",
      "creator_brief",
      "project_brief",
    ]),
    model_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    provider_kind: z.literal("cliproxyapi"),
    cost_status: z.literal("measured"),
    input_tokens: BoundedCountSchema,
    cached_input_tokens: BoundedCountSchema,
    output_tokens: BoundedCountSchema,
    cost_usd_micros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    duration_ms: DurationMsSchema,
    rate_card_version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
    rate_card_source: z.literal("provider_contract"),
    rate_card_effective_date: z.string().date(),
  })
  .strict()
  .superRefine((properties, context) => {
    if (properties.cached_input_tokens > properties.input_tokens) {
      context.addIssue({
        code: "custom",
        message: "Cached input tokens cannot exceed input tokens.",
      });
    }
  });

const UnavailableGenerationCostPropertiesSchema = z
  .object({
    project_id: ProjectIdSchema,
    generation_kind: z.enum([
      "grounded_answer",
      "study_guide",
      "creator_brief",
      "project_brief",
    ]),
    model_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    provider_kind: z.literal("cliproxyapi"),
    cost_status: z.literal("unavailable"),
    error_class: z.enum(["usage_unavailable", "rate_card_unavailable"]),
    duration_ms: DurationMsSchema,
    input_tokens: BoundedCountSchema.optional(),
    cached_input_tokens: BoundedCountSchema.optional(),
    output_tokens: BoundedCountSchema.optional(),
  })
  .strict()
  .superRefine((properties, context) => {
    const tokenFields = [
      properties.input_tokens,
      properties.cached_input_tokens,
      properties.output_tokens,
    ];
    const provided = tokenFields.filter((value) => value !== undefined).length;
    if (properties.error_class === "usage_unavailable" && provided !== 0) {
      context.addIssue({
        code: "custom",
        message: "Unavailable usage must not contain estimated token counts.",
      });
    }
    if (properties.error_class === "rate_card_unavailable" && provided !== 3) {
      context.addIssue({
        code: "custom",
        message: "Rate-card-unavailable usage must contain all observed token counts.",
      });
    }
    if (
      properties.input_tokens !== undefined &&
      properties.cached_input_tokens !== undefined &&
      properties.cached_input_tokens > properties.input_tokens
    ) {
      context.addIssue({
        code: "custom",
        message: "Cached input tokens cannot exceed input tokens.",
      });
    }
  });

const ProjectActionFailedPropertiesSchema = z
  .object({
    project_id: ProjectIdSchema.optional(),
    action_kind: z.enum([
      "create",
      "source_add",
      "search",
      "message",
      "artifact",
      "citation",
      "feedback",
    ]),
    error_class: z.enum([
      "authentication",
      "authorization",
      "quota",
      "rate_limit",
      "request",
      "network",
      "processing",
      "protocol",
      "persistence",
      "interrupted",
    ]),
    http_status: z.number().int().min(400).max(599).optional(),
  })
  .strict()
  .superRefine((properties, context) => {
    if (properties.action_kind !== "create" && !properties.project_id) {
      context.addIssue({
        code: "custom",
        message: "Only creation failures may omit a Project identifier.",
      });
    }
  });

export const ProjectActivityEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("project_created"), properties: z.object({ project_id: ProjectIdSchema }).strict() }).strict(),
  z.object({ event: z.literal("project_opened"), properties: z.object({ project_id: ProjectIdSchema }).strict() }).strict(),
  z.object({
    event: z.literal("project_source_added"),
    properties: z.object({
      project_id: ProjectIdSchema,
      source_kind: z.enum(["history", "youtube_url"]),
      readiness: z.enum(["ready", "processing"]),
      source_ordinal: z.number().int().min(1).max(5),
      source_set_revision: BoundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    event: z.literal("project_activated"),
    properties: z.object({
      project_id: ProjectIdSchema,
      activation_kind: z.enum(["search", "message", "artifact"]),
      activation_revision: BoundedOrdinalSchema,
      activation_occurred_at: z.string().datetime({ offset: true }),
      ready_videos: z.number().int().min(2).max(5),
    }).strict(),
  }).strict(),
  z.object({ event: z.literal("project_message_sent"), properties: ProjectMessagePropertiesSchema }).strict(),
  z.object({
    event: z.literal("project_citation_clicked"),
    properties: ProjectCitationPropertiesSchema,
  }).strict(),
  z.object({
    event: z.literal("project_answer_feedback_submitted"),
    properties: z.object({
      project_id: ProjectIdSchema,
      answer_id: z.string().uuid(),
      message_ordinal: BoundedOrdinalSchema,
      rating: z.enum(["helpful", "not_helpful"]),
    }).strict(),
  }).strict(),
  z.object({
    event: z.literal("project_paywall_viewed"),
    properties: z.object({
      project_id: ProjectIdSchema,
      paywall_kind: z.enum(["conversation", "artifact"]),
      tier: z.literal("free"),
      used: BoundedCountSchema,
      limit: z.number().int().min(1).max(1_000_000),
    }).strict().superRefine((properties, context) => {
      if (properties.used < properties.limit) {
        context.addIssue({ code: "custom", message: "Paywall usage must meet its limit." });
      }
    }),
  }).strict(),
  z.object({ event: z.literal("project_action_failed"), properties: ProjectActionFailedPropertiesSchema }).strict(),
  z.object({
    event: z.literal("project_generation_cost_recorded"),
    properties: z.union([
      MeasuredGenerationCostPropertiesSchema,
      UnavailableGenerationCostPropertiesSchema,
    ]),
  }).strict(),
]);

export type ProjectActivityEvent = z.infer<typeof ProjectActivityEventSchema>;
export type ProjectActivityEventName = ProjectActivityEvent["event"];
export type ProjectActivityEventProperties = {
  [EventName in ProjectActivityEventName]: Extract<
    ProjectActivityEvent,
    { event: EventName }
  >["properties"];
};

export const PROJECT_ACTIVITY_EVENT_NAMES = [
  "project_created",
  "project_opened",
  "project_source_added",
  "project_activated",
  "project_message_sent",
  "project_citation_clicked",
  "project_answer_feedback_submitted",
  "project_paywall_viewed",
  "project_action_failed",
  "project_generation_cost_recorded",
] as const satisfies readonly ProjectActivityEventName[];

const projectActivityEventNames = new Set<string>(PROJECT_ACTIVITY_EVENT_NAMES);

export function isProjectActivityEventName(event: unknown): event is ProjectActivityEventName {
  return typeof event === "string" && projectActivityEventNames.has(event);
}

export function validateProjectActivityEvent(event: unknown, properties: unknown) {
  const result = ProjectActivityEventSchema.safeParse({ event, properties });
  return result.success
    ? { success: true as const, properties: result.data.properties }
    : { success: false as const, issueCount: result.error.issues.length };
}

export function classifyProjectActionHttpFailure(
  status: number,
): Extract<
  ProjectActivityEventProperties["project_action_failed"]["error_class"],
  "authentication" | "authorization" | "quota" | "rate_limit" | "request" | "processing"
> {
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "processing";
  return "request";
}
