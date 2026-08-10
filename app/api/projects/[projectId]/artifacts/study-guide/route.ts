import { createProjectArtifactRoute } from "@/lib/projects/project-artifact-route";
import {
  buildProjectStudyGuideMessages,
  validateProjectStudyGuide,
} from "@/lib/projects/project-study-guide";

export const maxDuration = 120;

const route = createProjectArtifactRoute({
  kind: "study_guide",
  title: "Study Guide",
  responseKey: "studyGuide",
  promptVersion: "study-guide-v1",
  errorPrefix: "PROJECT_STUDY_GUIDE",
  logScope: "project-study-guide",
  evidenceNotReadyMessage:
    "A Study Guide needs at least one ready Project Transcript. Try again when processing finishes.",
  evidenceInsufficientMessage:
    "The ready Project Transcripts do not contain enough evidence for a Study Guide.",
  buildMessages: buildProjectStudyGuideMessages,
  validate: (content, sourceManifest) =>
    validateProjectStudyGuide(content, sourceManifest),
});

export const GET = route.GET;
export const POST = route.POST;
