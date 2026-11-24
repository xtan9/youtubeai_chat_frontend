"use client";

import {useTranslations} from "next-intl";
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

function getDefinition(t: ReturnType<typeof useTranslations<"project">>) {
  return {
    kind: "project_brief",
    slug: "project-brief",
    responseKey: "projectBrief",
    title: t("projectBrief"),
    shortName: t("brief"),
    icon: "document",
    description:
      t("aDurableResearchBriefThatKeepsFindingsAgreements"),
    emptyTitle: t("turnYourReadySourcesIntoADecisionReady"),
    emptyDescription:
      t("theBriefSeparatesWhatSourcesSupportWhereThey"),
    filenameSuffix: "project-brief",
    buildMarkdown: buildProjectBriefMarkdown,
  } satisfies ProjectArtifactPanelDefinition;
}

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
  const t = useTranslations("project");
  return (
    <ProjectArtifactPanel
      definition={getDefinition(t)}
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
