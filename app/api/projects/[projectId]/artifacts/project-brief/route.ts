import { createProjectArtifactRoute } from "@/lib/projects/project-artifact-route";
import { prepareProjectBriefGeneration } from "@/lib/projects/project-brief-generation";

// Two bounded synthesis calls plus retrieval and durable persistence.
export const maxDuration = 300;

const route = createProjectArtifactRoute({
  kind: "project_brief",
  title: "Project Brief",
  responseKey: "projectBrief",
  promptVersion: "project-brief-v7",
  synthesisTimeoutMs: 100_000,
  logScope: "project-brief",
  errorPrefix: "PROJECT_BRIEF",
  evidenceNotReadyMessage:
    "A Project Brief needs at least one ready Project Transcript. Try again when processing finishes.",
  evidenceInsufficientMessage:
    "We couldn't retrieve relevant passages for this Project Brief. Try a more specific research goal or add another source.",
  prepareGeneration: prepareProjectBriefGeneration,
});

export const GET = route.GET;
export const POST = route.POST;
