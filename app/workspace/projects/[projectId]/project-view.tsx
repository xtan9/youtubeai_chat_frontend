"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { ArrowLeft, Lightbulb, Save, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ProjectHistoryCandidatePage,
  ProjectSourceSet as ProjectSourceSetValue,
} from "@/lib/projects/project-source-set";
import type {
  ProjectConversation as ProjectConversationValue,
  ProjectConversationSummary,
} from "@/lib/projects/project-grounded-answer-contract";
import type { Project } from "@/lib/projects/project-subject";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { ProjectConversation } from "./project-conversation";
import { ProjectSourceSet } from "./project-source-set";
import { ProjectSearch } from "./project-search";
import { ProjectStudyGuide } from "./project-study-guide";

type ApiError = {
  message?: string;
  fieldErrors?: { name?: string[]; goal?: string[] };
};

type ProjectViewProps = {
  initialProject: Project;
  initialSourceSet: ProjectSourceSetValue;
  initialCandidatePage: ProjectHistoryCandidatePage | null;
  initialConversation: ProjectConversationValue;
  initialConversations: readonly ProjectConversationSummary[];
  initialStudyGuide: Extract<
    ProjectArtifactLoadResolution,
    { status: "ready" }
  >;
};

export function ProjectView({
  initialProject,
  initialSourceSet,
  initialCandidatePage,
  initialConversation,
  initialConversations,
  initialStudyGuide,
}: ProjectViewProps) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [name, setName] = useState(initialProject.name);
  const [goal, setGoal] = useState(initialProject.goal ?? "");
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [currentSourceSetRevision, setCurrentSourceSetRevision] = useState(
    initialSourceSet.revision,
  );
  const handleSourceSetChange = useCallback(
    (next: ProjectSourceSetValue) =>
      setCurrentSourceSetRevision((current) =>
        Math.max(current, next.revision),
      ),
    [],
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, goal }),
      });
      const payload = (await response.json()) as ApiError & { project?: Project };
      if (!response.ok || !payload.project) {
        setError(payload);
        return;
      }
      setProject(payload.project);
      setName(payload.project.name);
      setGoal(payload.project.goal ?? "");
      setSaved(true);
      router.refresh();
    } catch {
      setError({ message: "Couldn’t save changes. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as ApiError;
        setDeleteError(payload.message ?? "Couldn’t delete the Project. Try again.");
        setDeleting(false);
        return;
      }
      router.push("/workspace");
      router.refresh();
    } catch {
      setDeleteError("Couldn’t delete the Project. Check your connection and try again.");
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/workspace"
        className="inline-flex w-fit items-center gap-2 rounded-md text-body-sm font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-focus"
      >
        <ArrowLeft aria-hidden="true" />
        Back to Workspace
      </Link>

      <header className="flex flex-col gap-3 border-b border-border-subtle pb-8">
        <p className="text-body-sm font-medium text-text-muted">Project</p>
        <h1 className="break-words text-h2 text-text-primary">{project.name}</h1>
        <p className="max-w-prose text-body-md text-text-secondary">
          Curate a bounded Source Set, then use it as the evidence for grounded research.
        </p>
      </header>

      <ProjectSourceSet
        projectId={project.id}
        initialSourceSet={initialSourceSet}
        initialCandidatePage={initialCandidatePage}
        onSourceSetChange={handleSourceSetChange}
      />

      <ProjectStudyGuide
        projectId={project.id}
        projectName={project.name}
        currentSourceSetRevision={currentSourceSetRevision}
        initialStudyGuide={initialStudyGuide}
      />

      <ProjectConversation
        projectId={project.id}
        initialConversation={initialConversation}
        initialConversations={initialConversations}
      />

      <ProjectSearch projectId={project.id} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <Card>
          <CardHeader>
            <h2 className="text-h4 font-semibold text-text-primary">Project details</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSaved(false);
                  }}
                  maxLength={120}
                  aria-invalid={Boolean(error?.fieldErrors?.name)}
                  aria-describedby={error?.fieldErrors?.name ? "project-name-error" : undefined}
                />
                {error?.fieldErrors?.name?.[0] ? (
                  <p id="project-name-error" className="text-body-sm text-accent-danger">
                    {error.fieldErrors.name[0]}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="project-goal">Project Goal (optional)</Label>
                <Textarea
                  id="project-goal"
                  value={goal}
                  onChange={(event) => {
                    setGoal(event.target.value);
                    setSaved(false);
                  }}
                  maxLength={2000}
                  rows={7}
                  aria-invalid={Boolean(error?.fieldErrors?.goal)}
                  aria-describedby={
                    error?.fieldErrors?.goal
                      ? "project-goal-help project-goal-error"
                      : "project-goal-help"
                  }
                />
                <p id="project-goal-help" className="text-body-sm text-text-muted">
                  Describe what you want to learn, compare, or create.
                </p>
                {error?.fieldErrors?.goal?.[0] ? (
                  <p id="project-goal-error" className="text-body-sm text-accent-danger">
                    {error.fieldErrors.goal[0]}
                  </p>
                ) : null}
              </div>

              {error?.message ? (
                <p role="alert" className="text-body-sm text-accent-danger">
                  {error.message}
                </p>
              ) : null}
              {saved ? (
                <p role="status" className="text-body-sm text-accent-success">
                  Changes saved.
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button type="submit" disabled={pending || deleting}>
                  <Save aria-hidden="true" />
                  {pending ? "Saving…" : "Save changes"}
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" disabled={pending || deleting}>
                      <Trash2 aria-hidden="true" />
                      Delete Project
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes this Project and its future Project work. Shared cached Videos, Transcripts, and Summaries are not deleted.
                      </AlertDialogDescription>
                      {deleteError ? (
                        <p role="alert" className="text-body-sm text-accent-danger">
                          {deleteError}
                        </p>
                      ) : null}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>Keep Project</AlertDialogCancel>
                      <AlertDialogAction
                        className={buttonVariants({ variant: "destructive" })}
                        onClick={(event) => {
                          event.preventDefault();
                          void remove();
                        }}
                        disabled={deleting}
                      >
                        {deleting ? "Deleting…" : "Delete Project"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </form>
          </CardContent>
        </Card>

        <aside>
          <Card className="bg-surface-sunken/50">
            <CardHeader>
              <h2 className="flex items-center gap-2 text-h5 font-semibold text-text-primary">
                <Lightbulb aria-hidden="true" className="text-accent-brand" />
                Guidance, not evidence
              </h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-body-sm text-text-secondary">
              <p>Your Goal helps future conversations and outputs focus on what matters to you.</p>
              <p>It is never cited, searched, or treated as proof. Only Project Videos can support grounded claims.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
