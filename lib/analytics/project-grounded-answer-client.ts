"use client";
import {
  type ProjectAnswerClassification,
  type ProjectAnswerCoverage,
  type ProjectAnswerSourceManifest,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { inspectProjectCitations } from "@/lib/projects/project-grounded-citations";

export function captureCompletion(input: {
  readonly projectId: string;
  readonly classification: ProjectAnswerClassification;
  readonly mode?: ProjectConversationMode;
  readonly manifest: ProjectAnswerSourceManifest;
  readonly coverage: ProjectAnswerCoverage;
  readonly diagnosticCount: number;
  readonly content: string;
}) {
  const citationInspection = inspectProjectCitations(input.content, input.manifest);
  captureAnalyticsEvent("project_grounded_answer_completed", {
    project_id: input.projectId,
    classification: input.classification,
    ...(input.mode === undefined || input.mode === PROJECT_DEFAULT_CONVERSATION_MODE
      ? {}
      : { mode: input.mode }),
    source_set_revision: input.manifest.sourceSetRevision,
    total_videos: input.coverage.totalVideos,
    ready_videos: input.coverage.readyVideos,
    used_videos: input.coverage.usedVideos,
    unavailable_videos: input.coverage.unavailableVideos.length,
    passages_examined: input.coverage.passagesExamined,
    passages_used: input.coverage.passagesUsed,
    citation_diagnostics: input.diagnosticCount,
    citation_candidates:
      citationInspection.validCitationCount + input.diagnosticCount,
    resolved_citations: citationInspection.validCitationCount,
    citation_measurement_status: "measured",
  });
}
