import { z } from "zod";

export const ProjectSourceSetEventKindSchema = z.enum([
  "added",
  "removed",
  "reordered",
  "status_changed",
]);

export type ProjectSourceSetEventKind = z.infer<
  typeof ProjectSourceSetEventKindSchema
>;

export const ProjectVideoReadinessStatusSchema = z.enum([
  "processing",
  "ready",
  "failed",
]);

export type ProjectVideoReadinessStatus = z.infer<
  typeof ProjectVideoReadinessStatusSchema
>;

/**
 * A private, content-free boundary describing one committed Source Set
 * transition. Video titles are a presentation snapshot for the owner-facing
 * conversation UI; URLs, prompts, transcript text, and answers never belong
 * in this contract (or in analytics properties).
 */
export const ProjectSourceSetEventSchema = z
  .object({
    eventId: z.uuid(),
    projectId: z.uuid(),
    revision: z.number().int().positive(),
    kind: ProjectSourceSetEventKindSchema,
    videoId: z.uuid(),
    videoTitle: z.string().nullable(),
    fromPosition: z.number().int().min(1).max(5).nullable(),
    toPosition: z.number().int().min(1).max(5).nullable(),
    fromStatus: ProjectVideoReadinessStatusSchema.nullable(),
    toStatus: ProjectVideoReadinessStatusSchema.nullable(),
    createdAt: z.string(),
  })
  .strict();

export type ProjectSourceSetEvent = z.infer<typeof ProjectSourceSetEventSchema>;

export const ProjectSourceSetEventListSchema = z
  .array(ProjectSourceSetEventSchema)
  .max(500);

export function projectSourceSetEventLabel(
  event: Pick<
    ProjectSourceSetEvent,
    "kind" | "videoTitle" | "fromStatus" | "toStatus"
  >,
): string {
  const title = event.videoTitle ?? "Untitled Video";
  switch (event.kind) {
    case "added":
      return `Added ${title} to the Source Set`;
    case "removed":
      return `Removed ${title} from the Source Set`;
    case "reordered":
      return "Reordered the Project Source Set";
    case "status_changed":
      return `${title} readiness changed from ${event.fromStatus ?? "unknown"} to ${event.toStatus ?? "unknown"}`;
  }
}
