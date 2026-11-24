"use client";

import {useTranslations} from "next-intl";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { buildProjectStudyGuideMarkdown } from "@/lib/projects/project-study-guide";
import {
  ProjectArtifactPanel,
  type ProjectArtifactPanelDefinition,
} from "./project-artifact-panel";

type ReadyStudyGuide = Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
>;

function getDefinition(t: ReturnType<typeof useTranslations<"project">>) {
  return {
    kind: "study_guide",
    slug: "study-guide",
    responseKey: "studyGuide",
    title: t("studyGuide"),
    shortName: t("guide"),
    icon: "book",
    description:
      t("aDurableGuideBuiltOnlyFromReadyTranscript"),
    emptyTitle: t("turnYourReadySourcesIntoAReviewableGuide"),
    emptyDescription:
      t("theGuideWillOrganizeKeyIdeasAndReview"),
    filenameSuffix: "study-guide",
    buildMarkdown: buildProjectStudyGuideMarkdown,
  } satisfies ProjectArtifactPanelDefinition;
}

export function ProjectStudyGuide({
  projectId,
  projectName,
  currentSourceSetRevision,
  initialStudyGuide,
  sharedGenerationsUsed,
  onGenerationsUsedChange,
  onCurrentChange,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly currentSourceSetRevision?: number;
  readonly initialStudyGuide: ReadyStudyGuide;
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
      initialArtifact={initialStudyGuide}
      sharedGenerationsUsed={sharedGenerationsUsed}
      onGenerationsUsedChange={onGenerationsUsedChange}
      onCurrentChange={onCurrentChange}
    />
  );
}
