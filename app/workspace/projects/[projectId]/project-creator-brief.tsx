"use client";

import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { buildProjectCreatorBriefMarkdown } from "@/lib/projects/project-creator-brief";
import {
  ProjectArtifactPanel,
  type ProjectArtifactPanelDefinition,
} from "./project-artifact-panel";

type ReadyCreatorBrief = Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
>;

const CREATOR_BRIEF_DEFINITION = {
  kind: "creator_brief",
  slug: "creator-brief",
  responseKey: "creatorBrief",
  title: "Creator Brief",
  shortName: "brief",
  icon: "creator",
  description:
    "A grounded creative canvas that keeps source claims separate from original directions and never imitates creator expression.",
  emptyTitle: "Transform grounded inspiration into an original Video direction.",
  emptyDescription:
    "The brief will attribute source claims, then identify gaps, combinations, counterarguments, and original angles for your Project Goal.",
  filenameSuffix: "creator-brief",
  buildMarkdown: buildProjectCreatorBriefMarkdown,
} satisfies ProjectArtifactPanelDefinition;

export function ProjectCreatorBrief({
  projectId,
  projectName,
  currentSourceSetRevision,
  initialCreatorBrief,
  sharedGenerationsUsed,
  onGenerationsUsedChange,
  onCurrentChange,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly currentSourceSetRevision?: number;
  readonly initialCreatorBrief: ReadyCreatorBrief;
  readonly sharedGenerationsUsed?: number;
  readonly onGenerationsUsedChange?: (generationsUsed: number) => void;
  readonly onCurrentChange?: (hasCurrent: boolean) => void;
}) {
  return (
    <ProjectArtifactPanel
      definition={CREATOR_BRIEF_DEFINITION}
      projectId={projectId}
      projectName={projectName}
      currentSourceSetRevision={currentSourceSetRevision}
      initialArtifact={initialCreatorBrief}
      sharedGenerationsUsed={sharedGenerationsUsed}
      onGenerationsUsedChange={onGenerationsUsedChange}
      onCurrentChange={onCurrentChange}
    />
  );
}
