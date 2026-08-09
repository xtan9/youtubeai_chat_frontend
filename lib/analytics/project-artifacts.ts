import { z } from "zod";
import { ProjectArtifactKindSchema } from "@/lib/projects/project-artifact-contract";

const ProjectArtifactRequestedPropertiesSchema = z
  .object({
    kind: ProjectArtifactKindSchema,
    tier: z.enum(["free", "pro"]),
    is_regeneration: z.boolean(),
  })
  .strict();

const ProjectArtifactCompletedPropertiesSchema = z
  .object({
    kind: ProjectArtifactKindSchema,
    tier: z.enum(["free", "pro"]),
    source_set_revision: z.number().int().nonnegative(),
    evidence_videos: z.number().int().min(0).max(5),
    evidence_passages: z.number().int().min(1).max(10),
    generations_used: z.number().int().nonnegative().max(1_000_000),
  })
  .strict()
  .superRefine((properties, context) => {
    if (properties.evidence_videos > properties.evidence_passages) {
      context.addIssue({
        code: "custom",
        message: "Artifact evidence Video count cannot exceed passage count.",
      });
    }
  });

const ProjectArtifactBlockedPropertiesSchema = z
  .object({
    kind: ProjectArtifactKindSchema,
    tier: z.enum(["free", "pro"]),
    failure_category: z.enum([
      "quota",
      "evidence",
      "generation",
      "network",
    ]),
  })
  .strict();

const ProjectArtifactExportedPropertiesSchema = z
  .object({
    kind: ProjectArtifactKindSchema,
    format: z.enum(["clipboard", "markdown"]),
  })
  .strict();

export const ProjectArtifactEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("project_artifact_generation_requested"),
      properties: ProjectArtifactRequestedPropertiesSchema,
    })
    .strict(),
  z
    .object({
      event: z.literal("project_artifact_generation_completed"),
      properties: ProjectArtifactCompletedPropertiesSchema,
    })
    .strict(),
  z
    .object({
      event: z.literal("project_artifact_generation_blocked"),
      properties: ProjectArtifactBlockedPropertiesSchema,
    })
    .strict(),
  z
    .object({
      event: z.literal("project_artifact_exported"),
      properties: ProjectArtifactExportedPropertiesSchema,
    })
    .strict(),
]);

export type ProjectArtifactEvent = z.infer<typeof ProjectArtifactEventSchema>;
export type ProjectArtifactEventName = ProjectArtifactEvent["event"];
export type ProjectArtifactEventProperties = {
  [EventName in ProjectArtifactEventName]: Extract<
    ProjectArtifactEvent,
    { event: EventName }
  >["properties"];
};

const projectArtifactEventNames = new Set<string>([
  "project_artifact_generation_requested",
  "project_artifact_generation_completed",
  "project_artifact_generation_blocked",
  "project_artifact_exported",
]);

export function isProjectArtifactEventName(
  event: unknown,
): event is ProjectArtifactEventName {
  return typeof event === "string" && projectArtifactEventNames.has(event);
}

export function validateProjectArtifactEvent(
  event: unknown,
  properties: unknown,
) {
  const result = ProjectArtifactEventSchema.safeParse({ event, properties });
  return result.success
    ? { success: true as const, properties: result.data.properties }
    : { success: false as const, issueCount: result.error.issues.length };
}
