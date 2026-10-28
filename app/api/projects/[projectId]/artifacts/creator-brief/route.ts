import { createProjectArtifactRoute } from "@/lib/projects/project-artifact-route";
import {
  buildProjectCreatorBriefMessages,
  validateProjectCreatorBrief,
} from "@/lib/projects/project-creator-brief";

export const maxDuration = 120;

const route = createProjectArtifactRoute({
  kind: "creator_brief",
  title: "Creator Brief",
  responseKey: "creatorBrief",
  promptVersion: "creator-brief-v1",
  errorPrefix: "PROJECT_CREATOR_BRIEF",
  logScope: "project-creator-brief",
  evidenceNotReadyMessage:
    "A Creator Brief needs at least one ready Project Transcript. Try again when processing finishes.",
  evidenceInsufficientMessage:
    "We couldn't retrieve relevant passages for this Creator Brief. Try a more specific research goal or add another source.",
  buildMessages: buildProjectCreatorBriefMessages,
  validate: validateProjectCreatorBrief,
});

export const GET = route.GET;
export const POST = route.POST;
