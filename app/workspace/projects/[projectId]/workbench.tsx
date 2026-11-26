"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProjectSectionContent } from "./project-section";
import { IntentShell } from "../../intent/shell";
import { IntentDesk } from "../../intent/desk";
import type { Project } from "@/lib/projects/project-subject";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import type { ProjectSourceSet } from "@/lib/projects/project-source-set-contract";
import { requestJson, SpaceRequestError, useSpace } from "./use-space";
import "./workbench.css";

const ProjectTools = dynamic(() => import("./project-tools"));
const sections = {
  desk: "workspace",
  sources: "projectSources",
  conversation: "projectConversation",
  research: "projectResearch",
  outputs: "outputs",
  search: "search",
  settings: "settings",
} as const;
export type ProjectSection = keyof typeof sections;

async function loadResearchHistory(api: string, signal: AbortSignal) {
  let cursor: string | null = null;
  const versions: ResearchVersion[] = [];
  do {
    const page: { versions: ResearchVersion[]; nextCursor?: string } =
      await requestJson(
        api +
          "/research" +
          (cursor ? "?before=" + encodeURIComponent(cursor) : ""),
        "GET",
        undefined,
        signal,
      );
    versions.push(...page.versions);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return versions;
}

function Editor({
  project,
  sources,
  onSourcesChange,
  onResearch,
}: {
  project: Project;
  sources: ProjectSourceSet | null | undefined;
  onSourcesChange: (sources: ProjectSourceSet) => void;
  onResearch: (version: ResearchVersion) => void;
}) {
  const ui = useTranslations("ui");
  const api = "/api/projects/" + project.id;
  const store = useSpace(api + "/space");
  const history = useQuery({
    queryKey: ["project-research-history", api],
    queryFn: ({ signal }) => loadResearchHistory(api, signal),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
  });
  if (store.loadError) {
    return (
      <p role="alert">
        {store.loadError}{" "}
        <button onClick={() => location.reload()}>{ui("reload")}</button>
      </p>
    );
  }
  if (!store.space || history.isPending || sources === undefined)
    return <p role="status">{ui("loadingProject")}</p>;
  return (
    <IntentDesk
      name={project.name}
      projectId={project.id}
      initial={{ history: history.data ?? null, sources }}
      store={store}
      onSourcesChange={onSourcesChange}
      onResearch={onResearch}
    />
  );
}

export function Workbench({ project: initialProject }: { project: Project }) {
  const ui = useTranslations("ui");
  const t = useTranslations("project");
  const intent = useTranslations("intent");
  const [project, setProject] = useState(initialProject);
  const projectId = project.id;
  const api = "/api/projects/" + projectId;
  const client = useQueryClient();
  const params = useSearchParams();
  const requested = params.get("panel");
  const section =
    requested && Object.hasOwn(sections, requested)
      ? (requested as ProjectSection)
      : params.has("conversationId")
        ? "conversation"
        : "desk";
  const [deskRevision, setDeskRevision] = useState<string>();
  const sourceSet = useQuery({
    queryKey: ["project-source-set", api],
    queryFn: async ({ signal }) =>
      (
        await requestJson<{ sourceSet: ProjectSourceSet }>(
          api + "/source-set",
          "GET",
          undefined,
          signal,
        )
      ).sourceSet,
    enabled: ["desk", "sources", "outputs", "research"].includes(section),
    retry: (failures, error) =>
      failures < 1 && (!(error instanceof SpaceRequestError) || error.status >= 500),
    gcTime: 0,
    staleTime: Infinity,
  });
  const sources = sourceSet.isError && !sourceSet.data ? null : sourceSet.data;
  const changeSources = useCallback(
    (next: ProjectSourceSet) => {
      client.setQueryData<ProjectSourceSet>(
        ["project-source-set", api],
        (current) =>
          current && current.revision > next.revision ? current : next,
      );
    },
    [api, client],
  );

  function addVersion(version: ResearchVersion) {
    client.setQueryData<ResearchVersion[]>(
      ["project-research-history", api],
      (history) =>
        history && [version, ...history.filter((v) => v.id !== version.id)],
    );
  }

  function selectSection(next: string) {
    const url = new URL(location.href);
    const defaultSection = url.searchParams.has("conversationId")
      ? "conversation"
      : "desk";
    if (next === defaultSection) url.searchParams.delete("panel");
    else url.searchParams.set("panel", next);
    window.history.pushState(null, "", url);
  }

  return (
    <>
      <IntentShell compact={section !== "desk"}>
        <div id="work">
          <div className="project-head">
            <div>
              <div className="crumb">
                <Link href="/workspace">{intent("myWorkspace")}</Link>{" "}
                <span>/</span> {intent("project")}
              </div>
              <h1>{project.name}</h1>
            </div>
            <select
              aria-label={t("projectSections")}
              className="project-sections"
              value={section}
              onChange={(event) => selectSection(event.target.value)}
            >
              {Object.entries(sections).map(([value, label]) => (
                <option key={value} value={value}>
                  {value === "desk" ? ui("workspace") : t(label)}
                </option>
              ))}
            </select>
          </div>
          <ProjectSectionContent active={section === "desk"}>
            <Editor
              project={project}
              sources={sources}
              onSourcesChange={changeSources}
              onResearch={(version) => {
                addVersion(version);
                setDeskRevision(version.id);
              }}
            />
          </ProjectSectionContent>
        </div>
      </IntentShell>
      <ProjectSectionContent active={section !== "desk"}>
        <div
          className="ph-no-capture mx-auto w-full max-w-5xl px-4 pb-8"
          data-ph-no-autocapture
        >
          <ProjectTools
            section={section}
            project={project}
            onSaved={setProject}
            sources={sources}
            retrySources={() => void sourceSet.refetch()}
            onResearch={addVersion}
            deskRevision={deskRevision}
            onSourcesChange={changeSources}
            conversationId={params.get("conversationId")}
          />
        </div>
      </ProjectSectionContent>
    </>
  );
}
