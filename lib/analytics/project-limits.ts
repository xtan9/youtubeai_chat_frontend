import { z } from "zod";

export const PROJECT_LIMIT_SOURCE_SURFACES = [
  "workspace_header",
  "workspace_create_dialog",
] as const;

export const PROJECT_LIMIT_CTA_ACTIONS = ["upgrade_to_pro"] as const;

const ProjectLimitPropertiesSchema = z
  .object({
    source_surface: z.enum(PROJECT_LIMIT_SOURCE_SURFACES),
    tier: z.literal("free"),
    projects_used: z.number().int().min(1).max(10_000),
    projects_limit: z.literal(1),
  })
  .strict();

export const ProjectLimitEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("project_limit_reached"),
      properties: ProjectLimitPropertiesSchema,
    })
    .strict(),
  z
    .object({
      event: z.literal("project_limit_cta_clicked"),
      properties: ProjectLimitPropertiesSchema.extend({
        cta: z.enum(PROJECT_LIMIT_CTA_ACTIONS),
      }).strict(),
    })
    .strict(),
]);

export const PROJECT_LIMIT_EVENT_NAMES = [
  "project_limit_reached",
  "project_limit_cta_clicked",
] as const;

const projectLimitEventNames = new Set<string>(PROJECT_LIMIT_EVENT_NAMES);

export function isProjectLimitEventName(
  event: unknown,
): event is ProjectLimitEventName {
  return typeof event === "string" && projectLimitEventNames.has(event);
}

export function validateProjectLimitEvent(event: unknown, properties: unknown) {
  const result = ProjectLimitEventSchema.safeParse({ event, properties });
  return result.success
    ? { success: true as const, properties: result.data.properties }
    : { success: false as const, issueCount: result.error.issues.length };
}

export type ProjectLimitEvent = z.infer<typeof ProjectLimitEventSchema>;
export type ProjectLimitEventName = ProjectLimitEvent["event"];
export type ProjectLimitEventProperties = {
  [EventName in ProjectLimitEventName]: Extract<
    ProjectLimitEvent,
    { event: EventName }
  >["properties"];
};
