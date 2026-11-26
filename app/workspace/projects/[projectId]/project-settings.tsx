"use client";

import { projectNotice } from "@/i18n/project-notice";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Lightbulb, Save, Trash2 } from "lucide-react";
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
import type { Project } from "@/lib/projects/project-subject";

type ApiError = {
  message?: string;
  fieldErrors?: { name?: string[]; goal?: string[] };
};

export function ProjectSettings({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (project: Project) => void;
}) {
  const t = useTranslations("project");
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal ?? "");
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
      const payload = (await response.json()) as ApiError & {
        project?: Project;
      };
      if (!response.ok || !payload.project) {
        setError(payload);
        return;
      }
      onSaved(payload.project);
      setName(payload.project.name);
      setGoal(payload.project.goal ?? "");
      setSaved(true);
      router.refresh();
    } catch {
      setError({ message: "couldnTSaveChangesCheckYourConnectionAnd" });
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
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as ApiError;
        setDeleteError(payload.message ?? "couldnTDeleteTheProjectTryAgain");
        setDeleting(false);
        return;
      }
      router.push("/workspace");
      router.refresh();
    } catch {
      setDeleteError("couldnTDeleteTheProjectCheckYourConnection");
      setDeleting(false);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Card>
        <CardHeader>
          <h2 className="text-h4 font-semibold text-text-primary">
            {t("projectDetails")}
          </h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-name">{t("projectName")}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                maxLength={120}
                aria-invalid={Boolean(error?.fieldErrors?.name)}
                aria-describedby={
                  error?.fieldErrors?.name ? "project-name-error" : undefined
                }
              />
              {error?.fieldErrors?.name?.[0] ? (
                <p
                  id="project-name-error"
                  className="text-body-sm text-accent-danger"
                >
                  {projectNotice(t, error.fieldErrors.name[0])}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="project-goal">{t("projectGoalOptional")}</Label>
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
              <p
                id="project-goal-help"
                className="text-body-sm text-text-muted"
              >
                {t("describeWhatYouWantToLearnCompareOr")}
              </p>
              {error?.fieldErrors?.goal?.[0] ? (
                <p
                  id="project-goal-error"
                  className="text-body-sm text-accent-danger"
                >
                  {projectNotice(t, error.fieldErrors.goal[0])}
                </p>
              ) : null}
            </div>

            {error?.message ? (
              <p role="alert" className="text-body-sm text-accent-danger">
                {projectNotice(t, error.message)}
              </p>
            ) : null}
            {saved ? (
              <p role="status" className="text-body-sm text-accent-success">
                {t("changesSaved")}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button type="submit" disabled={pending || deleting}>
                <Save aria-hidden="true" />
                {pending ? t("savingLabel") : t("saveChanges")}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending || deleting}
                  >
                    <Trash2 aria-hidden="true" />
                    {t("deleteProject")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  className="ph-no-capture"
                  data-ph-no-autocapture
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("deleteNamed", { name: project.name })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("thisPermanentlyRemovesThisProjectAndItsFuture")}
                    </AlertDialogDescription>
                    {deleteError ? (
                      <p
                        role="alert"
                        className="text-body-sm text-accent-danger"
                      >
                        {projectNotice(t, deleteError)}
                      </p>
                    ) : null}
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>
                      {t("keepProject")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={(event) => {
                        event.preventDefault();
                        void remove();
                      }}
                      disabled={deleting}
                    >
                      {deleting ? t("deleting") : t("deleteProject")}
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
              {t("guidanceNotEvidence")}
            </h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-body-sm text-text-secondary">
            <p>{t("yourGoalHelpsFutureConversationsAndOutputsFocus")}</p>
            <p>{t("itIsNeverCitedSearchedOrTreatedAs")}</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
