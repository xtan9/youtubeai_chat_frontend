"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { ArrowRight, ChevronRight, Clock3 } from "lucide-react";
import type { PersonalWorkspace } from "@/lib/projects/project-subject";
import { decodeProjectLimitResponse } from "@/lib/projects/project-limit-response";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { ProjectLimitUpgrade } from "../_components/workspace-view";
import { IntentShell } from "./shell";

function RecentProjects({ projects }: { projects: PersonalWorkspace["projects"] }) {
  const ui = useTranslations("ui"), t = useTranslations("intent");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return (
    <section className="recent-projects" aria-labelledby="recent-directory-title">
      <div className="recent-heading">
        <h2 id="recent-directory-title">{ui("recentlyActive")}</h2>
        <Link className="manage-projects" href="/workspace/manage">
          {t("manageProjects")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <ul className="recent-grid" role="list">
        {projects.map((project) => {
          const activeAt = new Date(project.lastActiveAt);
          const validDate = Number.isFinite(activeAt.getTime());
          // Use the project UUID so a book keeps its cover when activity reorders the list.
          const cover = parseInt(project.id.slice(-2), 16) % 5;
          return (
            <li key={project.id}>
              <Link className="recent-entry" href={"/workspace/projects/" + project.id}
                aria-label={ui("openNamedProject", { name: project.name })}
                aria-describedby={validDate ? "activity-" + project.id : undefined}>
                <span className="recent-cover" data-cover={cover} aria-hidden="true" />
                <div className="recent-details">
                  <h3>{project.name}</h3>
                  {project.goal && <p className="recent-goal">{project.goal}</p>}
                  {validDate && (
                    <time id={"activity-" + project.id} dateTime={project.lastActiveAt}
                      title={ui("activeDate", { date: format.dateTime(activeAt, { dateStyle: "long", timeStyle: "long", timeZone: "UTC" }) })}>
                      <Clock3 aria-hidden="true" />{format.relativeTime(activeAt, now)}
                    </time>
                  )}
                </div>
                <ChevronRight className="recent-open" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function IntentLanding({ workspace }: { workspace: PersonalWorkspace }) {
  const t = useTranslations("intent"),
    ui = useTranslations("ui");
  const router = useRouter(),
    entitlements = useEntitlements();
  const [name, setName] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [used, setUsed] = useState(0);
  const limited =
    used || (entitlements.data?.tier === "free" && workspace.projects.length);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), goal: "" }),
      });
      const body = await response.json();
      if (!response.ok || !body.project?.id) {
        const limit = decodeProjectLimitResponse(body);
        if (limit?.errorCode === "free_project_limit_reached") {
          setUsed(limit.projectsUsed);
          captureAnalyticsEvent("project_limit_reached", {
            source_surface: "workspace_create_dialog",
            tier: "free",
            projects_used: limit.projectsUsed,
            projects_limit: 1,
          });
        }
        throw Error(body.message || ui("creationFailed"));
      }
      router.push("/workspace/projects/" + body.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ui("creationFailed"));
      setPending(false);
    }
  }
  return (
    <IntentShell>
      <div id="landing">
        <div className="crumb">
          {t("workspace")} <span>/</span> {t("newProject")}
        </div>
        <div className="create-card">
          <form className="create-form" onSubmit={create}>
            <h1>{ui("createProject")}</h1>
            <p className="lede">{t("nameFirst")}</p>
            {limited ? (
              <ProjectLimitUpgrade
                source="workspace_header"
                used={Number(limited)}
              />
            ) : (
              <>
                <label className="field-label" htmlFor="project-name">
                  {ui("projectName")}
                </label>
                <input
                  required
                  maxLength={90}
                  autoComplete="off"
                  id="project-name"
                  className="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="primary start" disabled={pending}>
                  {pending ? ui("creating") : t("createOpen")}
                  <ArrowRight size={16} />
                </button>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </form>
          <div className="cover-wrap" aria-hidden="true">
            <div className="cover">
              <small>Workspace / {t("preview")}</small>
              <strong>{name.trim() || t("newProject")}</strong>
              <div className="cover-rule" />
            </div>
          </div>
        </div>
        {!!workspace.projects.length && <RecentProjects projects={workspace.projects} />}
      </div>
    </IntentShell>
  );
}
