"use client";

import {useTranslations} from "next-intl";
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

function getDefinition(t: ReturnType<typeof useTranslations<"project">>) {
  return {
    kind: "creator_brief",
    slug: "creator-brief",
    responseKey: "creatorBrief",
    title: t("creatorBrief"),
    shortName: t("brief"),
    icon: "creator",
    description:
      t("aGroundedCreativeCanvasThatKeepsSourceClaims"),
    emptyTitle: t("transformGroundedInspirationIntoAnOriginalVideoDirection"),
    emptyDescription:
      t("theBriefWillAttributeSourceClaimsThenIdentify"),
    filenameSuffix: "creator-brief",
    buildMarkdown: buildProjectCreatorBriefMarkdown,
  } satisfies ProjectArtifactPanelDefinition;
}

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
  const t = useTranslations("project");
  return (
    <ProjectArtifactPanel
      definition={getDefinition(t)}
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
