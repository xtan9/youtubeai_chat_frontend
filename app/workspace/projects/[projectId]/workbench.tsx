"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IntentShell } from "../../intent/shell";
import { IntentDesk } from "../../intent/desk";
import type { Project } from "@/lib/projects/project-subject";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import type { ProjectSourceSet } from "@/lib/projects/project-source-set-contract";
import { requestJson, SpaceRequestError, useSpace } from "./use-space";
import "./workbench.css";

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

export function Workbench({ project }: { project: Project }) {
  const intent = useTranslations("intent");
  const ui = useTranslations("ui");
  const api = "/api/projects/" + project.id;
  const store = useSpace(api + "/space");
  const client = useQueryClient();
  const history = useQuery({
    queryKey: ["project-research-history", api],
    queryFn: ({ signal }) => loadResearchHistory(api, signal),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
  });
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
        [version, ...(history ?? []).filter((v) => v.id !== version.id)],
    );
  }

  return (
    <IntentShell>
      <div id="work">
        <div className="project-head">
          <div>
            <div className="crumb">
              <Link href="/workspace">{intent("myWorkspace")}</Link>{" "}
              <span>/</span> {intent("project")}
            </div>
            <h1>{project.name}</h1>
          </div>
        </div>
        {store.loadError ? (
          <p role="alert">
            {store.loadError}{" "}
            <button onClick={() => location.reload()}>{ui("reload")}</button>
          </p>
        ) : !store.space || history.isPending || sources === undefined ? (
          <p role="status">{ui("loadingProject")}</p>
        ) : (
          <IntentDesk
            name={project.name}
            projectId={project.id}
            initial={{ history: history.data ?? null, sources }}
            store={store}
            onSourcesChange={changeSources}
            onResearch={addVersion}
          />
        )}
      </div>
    </IntentShell>
  );
}
