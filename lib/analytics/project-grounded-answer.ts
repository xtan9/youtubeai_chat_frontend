import { z } from "zod";
import { ProjectConversationModeSchema } from "@/lib/projects/project-grounded-synthesis";

const ProjectGroundedAnswerCompletedPropertiesSchema = z
  .object({
    project_id: z.string().uuid(),
    classification: z.enum(["supported", "abstained", "unsupported"]),
    mode: ProjectConversationModeSchema.optional(),
    source_set_revision: z.number().int().nonnegative(),
    total_videos: z.number().int().min(0).max(5),
    ready_videos: z.number().int().min(0).max(5),
    used_videos: z.number().int().min(0).max(5),
    unavailable_videos: z.number().int().min(0).max(5),
    passages_examined: z.number().int().min(0).max(1_000_000),
    passages_used: z.number().int().min(0).max(10),
    citation_diagnostics: z.number().int().min(0).max(20),
    citation_candidates: z.number().int().min(0).max(100),
    resolved_citations: z.number().int().min(0).max(100),
    citation_measurement_status: z.literal("measured"),
  })
  .strict()
  .superRefine((properties, context) => {
    if (
      properties.ready_videos + properties.unavailable_videos !==
      properties.total_videos
    ) {
      context.addIssue({
        code: "custom",
        message: "Grounded Answer coverage totals must be coherent.",
      });
    }
    if (
      properties.used_videos > properties.ready_videos ||
      properties.passages_used > properties.passages_examined
    ) {
      context.addIssue({
        code: "custom",
        message: "Grounded Answer selected evidence must fit its coverage.",
      });
    }
    if (
      properties.resolved_citations + properties.citation_diagnostics !==
      properties.citation_candidates
    ) {
      context.addIssue({
        code: "custom",
        message: "Citation candidates must reconcile to resolved citations and diagnostics.",
      });
    }
  });

export const ProjectGroundedAnswerEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("project_grounded_answer_completed"),
      properties: ProjectGroundedAnswerCompletedPropertiesSchema,
    })
    .strict(),
]);

export type ProjectGroundedAnswerEvent = z.infer<
  typeof ProjectGroundedAnswerEventSchema
>;
export type ProjectGroundedAnswerEventName = ProjectGroundedAnswerEvent["event"];
export type ProjectGroundedAnswerEventProperties = {
  [EventName in ProjectGroundedAnswerEventName]: Extract<
    ProjectGroundedAnswerEvent,
    { event: EventName }
  >["properties"];
};

export function isProjectGroundedAnswerEventName(
  event: unknown,
): event is ProjectGroundedAnswerEventName {
  return event === "project_grounded_answer_completed";
}

export function validateProjectGroundedAnswerEvent(
  event: unknown,
  properties: unknown,
) {
  const result = ProjectGroundedAnswerEventSchema.safeParse({
    event,
    properties,
  });
  return result.success
    ? { success: true as const, properties: result.data.properties }
    : { success: false as const, issueCount: result.error.issues.length };
}
