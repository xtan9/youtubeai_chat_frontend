"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpen, FileText, Lightbulb, MessageSquare, Save, Search, Settings2, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ProjectArtifacts } from "./project-artifacts";
import { ProjectSourceSet } from "./project-source-set";
import { ProjectSearch } from "./project-search";
import { ProjectResearchNotebook } from "./project-research-notebook";

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
  initialCreatorBrief: Extract<
    ProjectArtifactLoadResolution,
    { status: "ready" }
  >;
  initialProjectBrief: Extract<
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
  initialCreatorBrief,
  initialProjectBrief,
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
  const [activeTab, setActiveTab] = useState("research");
  const [sourcesOpen, setSourcesOpen] = useState(initialSourceSet.videos.length === 0);
  const [sourceVideos, setSourceVideos] = useState(initialSourceSet.videos);
  const [currentSourceSetRevision, setCurrentSourceSetRevision] = useState(
    initialSourceSet.revision,
  );
  const handleSourceSetChange = useCallback(
    (next: ProjectSourceSetValue) => {
      setCurrentSourceSetRevision((current) => Math.max(current, next.revision));
      setSourceVideos(next.videos);
    },
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

  // A 19rem source rail leaves readable video titles while the 1440px cap keeps
  // the research column comfortable to read on wide desktop displays.
  return (
    <div
      className="ph-no-capture mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7"
      data-ph-no-autocapture
    >
      <Link
        href="/workspace"
        className="inline-flex w-fit items-center gap-2 rounded-md text-body-sm font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-focus"
      >
        <ArrowLeft aria-hidden="true" />
        Back to Workspace
      </Link>

      <header className="flex flex-col gap-2 border-b border-border-subtle pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-caption font-medium uppercase tracking-wider text-text-muted">Research project</p>
          <Badge variant="outline">{sourceVideos.filter((video) => video.status === "ready").length}/{sourceVideos.length} videos ready</Badge>
        </div>
        <h1 className="break-words text-h2 text-text-primary">{project.name}</h1>
        <p className="max-w-prose text-body-md text-text-secondary">
          {project.goal ?? "Bring your videos together. Ask questions, compare viewpoints, and follow the evidence."}
        </p>
      </header>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Button
          type="button"
          variant="outline"
          className="justify-between lg:hidden"
          aria-controls="project-sources-panel"
          aria-expanded={sourcesOpen}
          onClick={() => setSourcesOpen((current) => !current)}
        >
          <span className="flex items-center gap-2"><BookOpen aria-hidden="true" />Sources · {sourceVideos.length} videos</span>
          <span className="text-caption">{sourcesOpen ? "Hide" : "Show"}</span>
        </Button>
        <aside
          id="project-sources-panel"
          aria-label="Project sources"
          className={`${sourcesOpen ? "block" : "hidden"} min-w-0 lg:sticky lg:top-6 lg:block`}
        >
          <ProjectSourceSet
            projectId={project.id}
            initialSourceSet={initialSourceSet}
            initialCandidatePage={initialCandidatePage}
            onSourceSetChange={handleSourceSetChange}
            compact
          />
        </aside>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-4">
          {/* The site header scrolls normally; keep section navigation available
              at the viewport edge while reading a long conversation. */}
          <TabsList aria-label="Project sections" className="sticky top-0 z-20 grid h-11 w-full grid-cols-4 shadow-sm">
            <TabsTrigger value="research"><MessageSquare aria-hidden="true" className="hidden sm:block" /><span>Research</span></TabsTrigger>
            <TabsTrigger value="outputs"><FileText aria-hidden="true" className="hidden sm:block" /><span>Outputs</span></TabsTrigger>
            <TabsTrigger value="search"><Search aria-hidden="true" className="hidden sm:block" /><span>Search</span></TabsTrigger>
            <TabsTrigger value="settings"><Settings2 aria-hidden="true" className="hidden sm:block" /><span>Settings</span></TabsTrigger>
          </TabsList>
          <TabsContent value="research" forceMount hidden={activeTab !== "research"}>
            <ProjectResearchNotebook key={project.id} projectId={project.id} currentSourceSetRevision={currentSourceSetRevision} />
            <p className="mb-3 text-body-sm text-text-secondary">Video-only conversation · Ask about the project transcripts without external research.</p>
            <ProjectConversation
              projectId={project.id}
              initialConversation={initialConversation}
              initialConversations={initialConversations}
            />
          </TabsContent>
          <TabsContent value="outputs" forceMount hidden={activeTab !== "outputs"}>
            <ProjectArtifacts
              projectId={project.id}
              projectName={project.name}
              currentSourceSetRevision={currentSourceSetRevision}
              initialStudyGuide={initialStudyGuide}
              initialCreatorBrief={initialCreatorBrief}
              initialProjectBrief={initialProjectBrief}
            />
          </TabsContent>
          <TabsContent value="search" forceMount hidden={activeTab !== "search"}>
            <ProjectSearch projectId={project.id} />
          </TabsContent>
          <TabsContent value="settings" forceMount hidden={activeTab !== "settings"}>
      <div className="grid min-w-0 grid-cols-1 gap-4">
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
                  rows={4}
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
                  <AlertDialogContent
                    className="ph-no-capture"
                    data-ph-no-autocapture
                  >
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
