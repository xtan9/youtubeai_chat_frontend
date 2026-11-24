"use client";

import {useTranslations} from "next-intl";
import { useCallback, useState } from "react";
import { BookOpen, Clapperboard, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { ProjectBrief } from "./project-brief";
import { ProjectCreatorBrief } from "./project-creator-brief";
import { ProjectStudyGuide } from "./project-study-guide";

type ReadyArtifact = Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
>;

type ArtifactChoice = "study_guide" | "creator_brief" | "project_brief";

export function ProjectArtifacts({
  projectId,
  projectName,
  currentSourceSetRevision,
  initialStudyGuide,
  initialCreatorBrief,
  initialProjectBrief,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly currentSourceSetRevision: number;
  readonly initialStudyGuide: ReadyArtifact;
  readonly initialCreatorBrief: ReadyArtifact;
  readonly initialProjectBrief: ReadyArtifact;
}) {
  const t = useTranslations("project");
  const [selected, setSelected] = useState<ArtifactChoice>(() => {
    if (initialStudyGuide.current) return "study_guide";
    if (initialCreatorBrief.current) return "creator_brief";
    if (initialProjectBrief.current) return "project_brief";
    return "study_guide";
  });
  const [generationsUsed, setGenerationsUsed] = useState(() =>
    Math.max(
      initialStudyGuide.generationsUsed,
      initialCreatorBrief.generationsUsed,
      initialProjectBrief.generationsUsed,
    ),
  );
  const [hasStudyGuide, setHasStudyGuide] = useState(
    initialStudyGuide.current !== null,
  );
  const [hasCreatorBrief, setHasCreatorBrief] = useState(
    initialCreatorBrief.current !== null,
  );
  const [hasProjectBrief, setHasProjectBrief] = useState(
    initialProjectBrief.current !== null,
  );
  const handleGenerationsUsedChange = useCallback((next: number) => {
    setGenerationsUsed((current) => Math.max(current, next));
  }, []);

  return (
    <section
      aria-labelledby="project-artifacts-title"
      className="flex flex-col gap-4"
    >
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex flex-col gap-2">
            <h2
              id="project-artifacts-title"
              className="text-h4 font-semibold text-text-primary"
            >{t("artifacts")}</h2>
            <p className="max-w-prose text-body-sm text-text-secondary">{t("turnYourResearchIntoAReusableGuideOr")}{initialStudyGuide.tier === "free" ? t("freeIncludesOneGenerationAcrossAllOutputTypes") : t("eachOutputIncludesItsSourcesSoYouCan")}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div
            role="group"
            aria-label={t("chooseArtifactType")}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <Button
              type="button"
              variant={selected === "study_guide" ? "default" : "outline"}
              className="h-auto min-h-12 justify-start gap-3 py-3 text-left"
              aria-pressed={selected === "study_guide"}
              aria-label={t("chooseStudyGuide")}
              onClick={() => setSelected("study_guide")}
            >
              <BookOpen aria-hidden="true" />
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>{t("studyGuide")}</span>
                {hasStudyGuide ? (
                  <Badge variant="secondary">{t("current")}</Badge>
                ) : null}
              </span>
            </Button>
            <Button
              type="button"
              variant={selected === "creator_brief" ? "default" : "outline"}
              className="h-auto min-h-12 justify-start gap-3 py-3 text-left"
              aria-pressed={selected === "creator_brief"}
              aria-label={t("chooseCreatorBrief")}
              onClick={() => setSelected("creator_brief")}
            >
              <Clapperboard aria-hidden="true" />
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>{t("creatorBrief")}</span>
                {hasCreatorBrief ? (
                  <Badge variant="secondary">{t("current")}</Badge>
                ) : null}
              </span>
            </Button>
            <Button
              type="button"
              variant={selected === "project_brief" ? "default" : "outline"}
              className="h-auto min-h-12 justify-start gap-3 py-3 text-left"
              aria-pressed={selected === "project_brief"}
              aria-label={t("chooseProjectBrief")}
              onClick={() => setSelected("project_brief")}
            >
              <FileText aria-hidden="true" />
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>{t("projectBrief")}</span>
                {hasProjectBrief ? (
                  <Badge variant="secondary">{t("current")}</Badge>
                ) : null}
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div hidden={selected !== "study_guide"}>
        <ProjectStudyGuide
          projectId={projectId}
          projectName={projectName}
          currentSourceSetRevision={currentSourceSetRevision}
          initialStudyGuide={initialStudyGuide}
          sharedGenerationsUsed={generationsUsed}
          onGenerationsUsedChange={handleGenerationsUsedChange}
          onCurrentChange={setHasStudyGuide}
        />
      </div>
      <div hidden={selected !== "creator_brief"}>
        <ProjectCreatorBrief
          projectId={projectId}
          projectName={projectName}
          currentSourceSetRevision={currentSourceSetRevision}
          initialCreatorBrief={initialCreatorBrief}
          sharedGenerationsUsed={generationsUsed}
          onGenerationsUsedChange={handleGenerationsUsedChange}
          onCurrentChange={setHasCreatorBrief}
        />
      </div>
      <div hidden={selected !== "project_brief"}>
        <ProjectBrief
          projectId={projectId}
          projectName={projectName}
          currentSourceSetRevision={currentSourceSetRevision}
          initialProjectBrief={initialProjectBrief}
          sharedGenerationsUsed={generationsUsed}
          onGenerationsUsedChange={handleGenerationsUsedChange}
          onCurrentChange={setHasProjectBrief}
        />
      </div>
    </section>
  );
}
