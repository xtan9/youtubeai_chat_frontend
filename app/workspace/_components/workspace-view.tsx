"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Clock3, FolderKanban, Plus } from "lucide-react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import type { ProjectLimitEventProperties } from "@/lib/analytics/project-limits";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import {
  decodeProjectLimitResponse,
  type FreeProjectLimitResponse,
} from "@/lib/projects/project-limit-response";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PersonalWorkspace, Project } from "@/lib/projects/project-subject";

type ApiError = {
  message?: string;
  fieldErrors?: { name?: string[]; goal?: string[] };
};

type ProjectCreateError = ApiError & {
  projectLimit: FreeProjectLimitResponse | null;
};

type ProjectLimitSource =
  ProjectLimitEventProperties["project_limit_reached"]["source_surface"];

function governedProjectsUsed(value: unknown, fallback: number): number {
  const count = typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
  return Math.min(10_000, Math.max(1, count));
}

function readApiError(value: unknown): ApiError {
  if (!value || typeof value !== "object") return {};
  return value as ApiError;
}

function captureProjectLimitReached(source: ProjectLimitSource, used: number) {
  captureAnalyticsEvent("project_limit_reached", {
    source_surface: source,
    tier: "free",
    projects_used: governedProjectsUsed(used, 1),
    projects_limit: 1,
  });
}

function ProjectLimitUpgrade({
  source,
  used,
}: {
  source: ProjectLimitSource;
  used: number;
}) {
  const governedUsed = governedProjectsUsed(used, 1);
  const { captureClick: captureSubscriptionDiscoveryClick } =
    useSubscriptionDiscovery({
      sourceSurface: "project_limit",
      presentationState: "upgrade_to_pro",
      authenticationState: "registered",
    });

  function captureUpgradeClick() {
    captureSubscriptionDiscoveryClick();
    captureAnalyticsEvent("project_limit_cta_clicked", {
      source_surface: source,
      tier: "free",
      projects_used: governedUsed,
      projects_limit: 1,
      cta: "upgrade_to_pro",
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <p className="text-body-sm text-text-secondary">
        {governedUsed} of 1 Free Project used
      </p>
      <Button asChild>
        <Link
          href="/pricing?source_surface=project_limit"
          onClick={captureUpgradeClick}
        >
          Upgrade to Pro
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      <p className="max-w-xs text-body-sm text-text-muted sm:text-right">
        Or delete your current Project to free this Project slot. Other usage
        does not reset.
      </p>
    </div>
  );
}

function activityLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently active";
  return `Active ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)}`;
}

function CreateProjectDialog({
  onCreated,
  projectsUsed,
  emptyState = false,
}: {
  onCreated: (project: Project) => void;
  projectsUsed: number;
  emptyState?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ProjectCreateError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, goal }),
      });
      const payload: unknown = await response.json();
      const decodedLimit = decodeProjectLimitResponse(payload);
      const projectLimit =
        decodedLimit?.errorCode === "free_project_limit_reached"
          ? decodedLimit
          : null;
      const project = (payload as { project?: Project } | null)?.project;
      if (!response.ok || !project) {
        if (projectLimit) {
          captureProjectLimitReached(
            "workspace_create_dialog",
            governedProjectsUsed(projectLimit.projectsUsed, projectsUsed),
          );
        }
        captureAnalyticsEvent("project_action_failed", {
          action_kind: "create",
          error_class: projectLimit
            ? "quota"
            : response.status === 429
              ? "rate_limit"
              : response.status >= 500
                ? "persistence"
                : "request",
          ...(response.status >= 400 && response.status <= 599
            ? { http_status: response.status }
            : {}),
        });
        setError({ ...readApiError(payload), projectLimit });
        return;
      }
      onCreated(project);
      setName("");
      setGoal("");
      setOpen(false);
    } catch {
      captureAnalyticsEvent("project_action_failed", {
        action_kind: "create",
        error_class: "network",
      });
      setError({
        message: "Couldn’t create the Project. Check your connection and try again.",
        projectLimit: null,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size={emptyState ? "lg" : "default"}>
          <Plus aria-hidden="true" />
          Create Project
        </Button>
      </DialogTrigger>
      <DialogContent className="ph-no-capture" data-ph-no-autocapture>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Create a Project</DialogTitle>
            <DialogDescription>
              Give this body of research a clear name. You can refine its Goal later.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-project-name">Project name</Label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoComplete="off"
              aria-invalid={Boolean(error?.fieldErrors?.name)}
              aria-describedby={error?.fieldErrors?.name ? "new-project-name-error" : undefined}
              autoFocus
            />
            {error?.fieldErrors?.name?.[0] ? (
              <p id="new-project-name-error" className="text-body-sm text-accent-danger">
                {error.fieldErrors.name[0]}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-project-goal">Project Goal (optional)</Label>
            <Textarea
              id="new-project-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              maxLength={2000}
              rows={4}
              aria-invalid={Boolean(error?.fieldErrors?.goal)}
              aria-describedby={
                error?.fieldErrors?.goal
                  ? "new-project-goal-help new-project-goal-error"
                  : "new-project-goal-help"
              }
            />
            <p id="new-project-goal-help" className="text-body-sm text-text-muted">
              Your Goal guides future analysis. It is never treated as source evidence.
            </p>
            {error?.fieldErrors?.goal?.[0] ? (
              <p id="new-project-goal-error" className="text-body-sm text-accent-danger">
                {error.fieldErrors.goal[0]}
              </p>
            ) : null}
          </div>

          {error?.message ? (
            <Alert variant="destructive">
              <AlertTitle>
                {error.projectLimit
                  ? "Free Project limit reached"
                  : "Project couldn’t be created"}
              </AlertTitle>
              <AlertDescription className="gap-3">
                <p>{error.message}</p>
                {error.projectLimit ? (
                  <ProjectLimitUpgrade
                    source="workspace_create_dialog"
                    used={governedProjectsUsed(
                      error.projectLimit.projectsUsed,
                      projectsUsed,
                    )}
                  />
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceView({ initialWorkspace }: { initialWorkspace: PersonalWorkspace }) {
  const [projects, setProjects] = useState([...initialWorkspace.projects]);
  const entitlements = useEntitlements();
  const capViewCaptured = useRef(false);
  const tier = entitlements.data?.tier;
  const isAtFreeProjectLimit = tier === "free" && projects.length >= 1;

  useEffect(() => {
    if (!isAtFreeProjectLimit || capViewCaptured.current) return;
    capViewCaptured.current = true;
    captureProjectLimitReached("workspace_header", projects.length);
  }, [isAtFreeProjectLimit, projects.length]);

  function addProject(project: Project) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
  }

  return (
    <div
      className="ph-no-capture mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
      data-ph-no-autocapture
    >
      <header className="flex flex-col gap-5 border-b border-border-subtle pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-3xl flex-col gap-3">
          <div className="flex items-center gap-2 text-body-sm font-medium text-text-muted">
            <FolderKanban aria-hidden="true" />
            Personal Workspace
          </div>
          <h1 className="text-h2 text-text-primary">Your research, ready to resume</h1>
          <p className="text-body-lg text-text-secondary">
            Projects gather related YouTube research around one evolving Goal.
          </p>
        </div>
        {projects.length > 0 ? (
          isAtFreeProjectLimit ? (
            <ProjectLimitUpgrade source="workspace_header" used={projects.length} />
          ) : (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <CreateProjectDialog
                onCreated={addProject}
                projectsUsed={projects.length}
              />
              {tier === "pro" ? (
                <p className="text-body-sm text-text-muted sm:text-right">
                  Unlimited Projects within technical and abuse limits
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </header>

      {projects.length === 0 ? (
        <Card className="border-dashed bg-surface-sunken/50">
          <CardContent className="flex flex-col items-center gap-5 px-6 py-12 text-center sm:py-16">
            <div className="flex size-14 items-center justify-center rounded-full bg-surface-raised shadow-sm">
              <FolderKanban aria-hidden="true" className="size-7 text-accent-brand" />
            </div>
            <div className="flex max-w-prose flex-col gap-2">
              <h2 className="text-h4 text-text-primary">Start your first Project</h2>
              <p className="text-body-md text-text-secondary">
                Name a topic, question, or creative direction. Your Project will become the private home for its sources and findings.
              </p>
            </div>
            <CreateProjectDialog
              onCreated={addProject}
              projectsUsed={projects.length}
              emptyState
            />
          </CardContent>
        </Card>
      ) : (
        <section aria-labelledby="recent-projects-heading" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id="recent-projects-heading" className="text-h4 text-text-primary">
              Recently active
            </h2>
            <p className="text-body-sm text-text-muted">
              {projects.length} {projects.length === 1 ? "Project" : "Projects"}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {projects.map((project) => (
              <Card key={project.id} className="relative overflow-hidden transition-shadow duration-fast hover:shadow-md">
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-accent-brand" />
                <CardHeader className="gap-3 pl-7">
                  <div className="flex items-center gap-2 text-body-sm text-text-muted">
                    <Clock3 aria-hidden="true" />
                    <time dateTime={project.lastActiveAt}>{activityLabel(project.lastActiveAt)}</time>
                  </div>
                  <h3 className="text-h5 font-semibold text-text-primary">{project.name}</h3>
                </CardHeader>
                <CardContent className="pl-7">
                  <p className="line-clamp-3 text-body-md text-text-secondary">
                    {project.goal ?? "No Project Goal yet. Add one when you know what this research should help you decide or create."}
                  </p>
                </CardContent>
                <CardFooter className="justify-end pl-7">
                  <Button asChild variant="outline">
                    <Link href={`/workspace/projects/${project.id}`} aria-label={`Open ${project.name}`}>
                      Open Project
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
