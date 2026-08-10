"use client";

import { useCallback, useState } from "react";
import { BookOpen, Clapperboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { ProjectCreatorBrief } from "./project-creator-brief";
import { ProjectStudyGuide } from "./project-study-guide";

type ReadyArtifact = Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
>;

type ArtifactChoice = "study_guide" | "creator_brief";

export function ProjectArtifacts({
  projectId,
  projectName,
  currentSourceSetRevision,
  initialStudyGuide,
  initialCreatorBrief,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly currentSourceSetRevision: number;
  readonly initialStudyGuide: ReadyArtifact;
  readonly initialCreatorBrief: ReadyArtifact;
}) {
  const [selected, setSelected] = useState<ArtifactChoice>(() =>
    initialStudyGuide.current || !initialCreatorBrief.current
      ? "study_guide"
      : "creator_brief",
  );
  const [generationsUsed, setGenerationsUsed] = useState(() =>
    Math.max(
      initialStudyGuide.generationsUsed,
      initialCreatorBrief.generationsUsed,
    ),
  );
  const [hasStudyGuide, setHasStudyGuide] = useState(
    initialStudyGuide.current !== null,
  );
  const [hasCreatorBrief, setHasCreatorBrief] = useState(
    initialCreatorBrief.current !== null,
  );
  const handleGenerationsUsedChange = useCallback((next: number) => {
    setGenerationsUsed((current) => Math.max(current, next));
  }, []);

  return (
    <section aria-labelledby="project-artifacts-title" className="flex flex-col gap-4">
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex flex-col gap-2">
            <h2
              id="project-artifacts-title"
              className="text-h4 font-semibold text-text-primary"
            >
              Artifacts
            </h2>
            <p className="max-w-prose text-body-sm text-text-secondary">
              Choose the reusable output that fits your Project. Free includes
              one generation total across Artifact types.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div
            role="group"
            aria-label="Choose Artifact type"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <Button
              type="button"
              variant={selected === "study_guide" ? "default" : "outline"}
              className="h-auto min-h-12 justify-start gap-3 py-3 text-left"
              aria-pressed={selected === "study_guide"}
              aria-label="Choose Study Guide"
              onClick={() => setSelected("study_guide")}
            >
              <BookOpen aria-hidden="true" />
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>Study Guide</span>
                {hasStudyGuide ? (
                  <Badge variant="secondary">Current</Badge>
                ) : null}
              </span>
            </Button>
            <Button
              type="button"
              variant={selected === "creator_brief" ? "default" : "outline"}
              className="h-auto min-h-12 justify-start gap-3 py-3 text-left"
              aria-pressed={selected === "creator_brief"}
              aria-label="Choose Creator Brief"
              onClick={() => setSelected("creator_brief")}
            >
              <Clapperboard aria-hidden="true" />
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>Creator Brief</span>
                {hasCreatorBrief ? (
                  <Badge variant="secondary">Current</Badge>
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
    </section>
  );
}
