import { z } from "zod";

export const PROJECT_SEARCH_OUTCOMES = [
  "ready",
  "no_results",
  "not_ready",
] as const;

const ProjectSearchCompletedPropertiesSchema = z
  .object({
    project_id: z.string().uuid(),
    source_set_revision: z.number().int().nonnegative(),
    outcome: z.enum(PROJECT_SEARCH_OUTCOMES),
    result_count: z.number().int().min(0).max(10),
    total_videos: z.number().int().min(0).max(5),
    ready_videos: z.number().int().min(0).max(5),
    unavailable_videos: z.number().int().min(0).max(5),
    passages_examined: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .superRefine((properties, context) => {
    if (
      properties.ready_videos + properties.unavailable_videos !==
      properties.total_videos
    ) {
      context.addIssue({
        code: "custom",
        message: "Project Search coverage totals must be coherent.",
      });
    }
    if (
      (properties.outcome === "ready") !==
      (properties.result_count > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Project Search outcome must match its result count.",
      });
    }
    if (
      (properties.outcome === "not_ready") !==
      (properties.ready_videos === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Project Search outcome must match ready coverage.",
      });
    }
    if (properties.passages_examined < properties.result_count) {
      context.addIssue({
        code: "custom",
        message: "Project Search result count cannot exceed examined passages.",
      });
    }
  });

export const ProjectSearchEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("project_search_completed"),
      properties: ProjectSearchCompletedPropertiesSchema,
    })
    .strict(),
]);

export type ProjectSearchEvent = z.infer<typeof ProjectSearchEventSchema>;
export type ProjectSearchEventName = ProjectSearchEvent["event"];
export type ProjectSearchEventProperties = {
  [EventName in ProjectSearchEventName]: Extract<
    ProjectSearchEvent,
    { event: EventName }
  >["properties"];
};

export function isProjectSearchEventName(
  event: unknown,
): event is ProjectSearchEventName {
  return event === "project_search_completed";
}

export function validateProjectSearchEvent(event: unknown, properties: unknown) {
  const result = ProjectSearchEventSchema.safeParse({ event, properties });
  return result.success
    ? { success: true as const, properties: result.data.properties }
    : { success: false as const, issueCount: result.error.issues.length };
}
