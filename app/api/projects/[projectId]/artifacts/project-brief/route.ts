import { createProjectArtifactRoute } from "@/lib/projects/project-artifact-route";
import {
  buildProjectBriefMessages,
  validateProjectBrief,
} from "@/lib/projects/project-brief";

export const maxDuration = 120;

const route = createProjectArtifactRoute({
  kind: "project_brief",
  title: "Project Brief",
  responseKey: "projectBrief",
  promptVersion: "project-brief-v1",
  logScope: "project-brief",
  errorPrefix: "PROJECT_BRIEF",
  balanceSources: true,
  evidenceNotReadyMessage:
    "A Project Brief needs at least one ready Project Transcript. Try again when processing finishes.",
  evidenceInsufficientMessage:
    "The ready Project Transcripts do not contain enough evidence for a Project Brief.",
  buildMessages: buildProjectBriefMessages,
  validate: validateProjectBrief,
});

export const GET = route.GET;
export const POST = route.POST;
