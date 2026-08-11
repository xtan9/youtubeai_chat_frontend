"use client";

import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { buildProjectBriefMarkdown } from "@/lib/projects/project-brief";
import {
  ProjectArtifactPanel,
  type ProjectArtifactPanelDefinition,
} from "./project-artifact-panel";

type ReadyProjectBrief = Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
>;

const PROJECT_BRIEF_DEFINITION = {
  kind: "project_brief",
  slug: "project-brief",
  responseKey: "projectBrief",
  title: "Project Brief",
  shortName: "brief",
  icon: "document",
  description:
    "A durable research brief that keeps findings, agreements, disagreements, and open questions tied to this Project’s Evidence Snapshot.",
  emptyTitle: "Turn your ready sources into a decision-ready brief.",
  emptyDescription:
    "The brief separates what sources support, where they materially disagree, and what remains unresolved, with every factual line linked to Transcript evidence.",
  filenameSuffix: "project-brief",
  buildMarkdown: buildProjectBriefMarkdown,
} satisfies ProjectArtifactPanelDefinition;

export function ProjectBrief({
  projectId,
  projectName,
  currentSourceSetRevision,
  initialProjectBrief,
  sharedGenerationsUsed,
  onGenerationsUsedChange,
  onCurrentChange,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly currentSourceSetRevision?: number;
  readonly initialProjectBrief: ReadyProjectBrief;
  readonly sharedGenerationsUsed?: number;
  readonly onGenerationsUsedChange?: (generationsUsed: number) => void;
  readonly onCurrentChange?: (hasCurrent: boolean) => void;
}) {
  return (
    <ProjectArtifactPanel
      definition={PROJECT_BRIEF_DEFINITION}
      projectId={projectId}
      projectName={projectName}
      currentSourceSetRevision={currentSourceSetRevision}
      initialArtifact={initialProjectBrief}
      sharedGenerationsUsed={sharedGenerationsUsed}
      onGenerationsUsedChange={onGenerationsUsedChange}
      onCurrentChange={onCurrentChange}
    />
  );
}
