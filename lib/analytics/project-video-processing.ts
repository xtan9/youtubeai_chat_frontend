import { z } from "zod";

export const PROJECT_VIDEO_PROCESSING_ERROR_CLASSES = [
  "authentication",
  "quota",
  "rate_limit",
  "request",
  "network",
  "processing",
  "protocol",
  "persistence",
  "interrupted",
] as const;

const OrdinalSchema = z.number().int().min(1).max(5);
const SecondsSchema = z.number().finite().nonnegative();

export const ProjectVideoProcessingEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("project_video_processing_started"),
      properties: z
        .object({
          status: z.literal("processing"),
          ordinal: OrdinalSchema,
          attempt_kind: z.enum(["new", "retry"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal("project_video_processing_succeeded"),
      properties: z
        .object({
          status: z.literal("ready"),
          ordinal: OrdinalSchema,
          result_origin: z.enum(["cache", "generated"]),
          transcription_seconds: SecondsSchema,
          summary_seconds: SecondsSchema,
          total_seconds: SecondsSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal("project_video_processing_failed"),
      properties: z
        .object({
          status: z.literal("failed"),
          ordinal: OrdinalSchema,
          error_class: z.enum(PROJECT_VIDEO_PROCESSING_ERROR_CLASSES),
          processing_seconds: SecondsSchema,
        })
        .strict(),
    })
    .strict(),
]);

export const PROJECT_VIDEO_PROCESSING_EVENT_NAMES = [
  "project_video_processing_started",
  "project_video_processing_succeeded",
  "project_video_processing_failed",
] as const;

const projectVideoProcessingEventNames = new Set<string>(
  PROJECT_VIDEO_PROCESSING_EVENT_NAMES,
);

export function isProjectVideoProcessingEventName(
  event: unknown,
): event is ProjectVideoProcessingEventName {
  return (
    typeof event === "string" && projectVideoProcessingEventNames.has(event)
  );
}

export function validateProjectVideoProcessingEvent(
  event: unknown,
  properties: unknown,
) {
  const result = ProjectVideoProcessingEventSchema.safeParse({
    event,
    properties,
  });
  return result.success
    ? { success: true as const, properties: result.data.properties }
    : { success: false as const, issueCount: result.error.issues.length };
}

export type ProjectVideoProcessingEvent = z.infer<
  typeof ProjectVideoProcessingEventSchema
>;
export type ProjectVideoProcessingEventName =
  ProjectVideoProcessingEvent["event"];
export type ProjectVideoProcessingEventProperties = {
  [EventName in ProjectVideoProcessingEventName]: Extract<
    ProjectVideoProcessingEvent,
    { event: EventName }
  >["properties"];
};
