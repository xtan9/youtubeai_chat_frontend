"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import type { PersonalWorkspace } from "@/lib/projects/project-subject";
import { decodeProjectLimitResponse } from "@/lib/projects/project-limit-response";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { ProjectLimitUpgrade } from "../_components/workspace-view";
import { IntentShell } from "./shell";

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
        {!!workspace.projects.length && (
          <section className="recent-projects">
            <h2>{ui("recentlyActive")}</h2>
            <Link className="link" href="/workspace/manage">
              {t("manageProjects")}
            </Link>
            {workspace.projects.map((project) => (
              <Link
                key={project.id}
                className="file"
                href={"/workspace/projects/" + project.id}
                aria-label={ui("openNamedProject", { name: project.name })}
              >
                {project.name}
              </Link>
            ))}
          </section>
        )}
      </div>
    </IntentShell>
  );
}
