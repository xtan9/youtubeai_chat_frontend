"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";
import type { Project } from "@/lib/projects/project-subject";
import type { ProjectSourceSet as Sources } from "@/lib/projects/project-source-set-contract";
import type {
  ProjectConversation as Conversation,
  ProjectConversationSummary,
} from "@/lib/projects/project-grounded-answer-contract";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";
import { ProjectArtifacts } from "./project-artifacts";
import { ProjectConversation } from "./project-conversation";
import { ProjectResearchNotebook } from "./project-research-notebook";
import { ProjectSearch } from "./project-search";
import { ProjectSettings } from "./project-settings";
import { ProjectSourceSet } from "./project-source-set";
import { requestJson, SpaceRequestError } from "./use-space";
import { ProjectSectionContent as Section, type ProjectSection } from "./project-section";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";

type Artifact = Extract<ProjectArtifactLoadResolution, { status: "ready" }>;

async function loadConversation(
  api: string,
  id: string | null,
  signal: AbortSignal,
) {
  const read = (thread?: string) =>
    requestJson<{ conversation: Conversation }>(
      api +
        "/conversation" +
        (thread ? "?conversationId=" + encodeURIComponent(thread) : ""),
      "GET",
      undefined,
      signal,
    );
  const selected = id && z.uuid().safeParse(id).success ? id : undefined;
  const [list, result] = await Promise.all([
    requestJson<{ conversations: ProjectConversationSummary[] }>(
      api + "/conversations",
      "GET",
      undefined,
      signal,
    ).catch((error) => {
      if (error instanceof SpaceRequestError && error.status >= 500)
        return { conversations: [] };
      throw error;
    }),
    read(selected).catch((error) => {
      if (
        selected &&
        error instanceof SpaceRequestError &&
        error.status === 404
      )
        return read();
      throw error;
    }),
  ]);
  const first = list.conversations[0];
  const { conversation } =
    !result.conversation.conversationId && first
      ? await read(first.conversationId)
      : result;
  return { conversation, conversations: list.conversations };
}

function LoadState({ retry }: { retry?: () => void }) {
  const ui = useTranslations("ui");
  return retry ? (
    <p role="alert">
      {ui("unavailable")} <button onClick={retry}>{ui("reload")}</button>
    </p>
  ) : (
    <p role="status">{ui("loadingProject")}</p>
  );
}

function Conversations({
  projectId,
  conversationId,
  active,
}: {
  projectId: string;
  conversationId: string | null;
  active: boolean;
}) {
  // Thread selection after opening is owned by ProjectConversation, including its URL updates.
  const [entry, setEntry] = useState({ id: conversationId, visit: 0 });
  const displayedThread = useRef(conversationId);
  useEffect(() => {
    if (active) displayedThread.current = conversationId;
  }, [active, conversationId]);
  useEffect(() => {
    function restoreThread() {
      const query = new URLSearchParams(location.search);
      const thread = query.get("conversationId");
      if (thread === displayedThread.current) return;
      if (thread || query.get("panel") === "conversation") {
        displayedThread.current = thread;
        setEntry((previous) => ({ id: thread, visit: previous.visit + 1 }));
      }
    }
    window.addEventListener("popstate", restoreThread);
    return () => window.removeEventListener("popstate", restoreThread);
  }, []);
  const query = useQuery({
    queryKey: ["project-conversations", projectId, entry],
    queryFn: ({ signal }) =>
      loadConversation("/api/projects/" + projectId, entry.id, signal),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  if (!query.data)
    return (
      <LoadState
        retry={query.isError ? () => void query.refetch() : undefined}
      />
    );
  return (
    <ProjectConversation
      key={entry.visit}
      projectId={projectId}
      initialConversation={query.data.conversation}
      initialConversations={query.data.conversations}
    />
  );
}

function Outputs({
  project,
  revision,
}: {
  project: Project;
  revision?: number;
}) {
  const api = "/api/projects/" + project.id + "/artifacts/";
  const query = useQuery({
    queryKey: ["project-outputs", api],
    queryFn: ({ signal }) =>
      Promise.all([
        requestJson<{ studyGuide: Artifact }>(
          api + "study-guide",
          "GET",
          undefined,
          signal,
        ),
        requestJson<{ creatorBrief: Artifact }>(
          api + "creator-brief",
          "GET",
          undefined,
          signal,
        ),
        requestJson<{ projectBrief: Artifact }>(
          api + "project-brief",
          "GET",
          undefined,
          signal,
        ),
      ]),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  if (!query.data)
    return (
      <LoadState
        retry={query.isError ? () => void query.refetch() : undefined}
      />
    );
  const [{ studyGuide }, { creatorBrief }, { projectBrief }] = query.data;
  return (
    <ProjectArtifacts
      projectId={project.id}
      projectName={project.name}
      currentSourceSetRevision={revision ?? studyGuide.currentSourceSetRevision}
      initialStudyGuide={studyGuide}
      initialCreatorBrief={creatorBrief}
      initialProjectBrief={projectBrief}
    />
  );
}

export default function ProjectTools({
  section,
  project,
  onSaved,
  sources,
  onSourcesChange,
  conversationId,
  onResearch,
  deskRevision,
  retrySources,
}: {
  retrySources: () => void;
  onResearch: (version: ResearchVersion) => void;
  deskRevision: string | undefined;
  section: ProjectSection;
  project: Project;
  onSaved: (project: Project) => void;
  sources: Sources | null | undefined;
  onSourcesChange: (sources: Sources) => void;
  conversationId: string | null;
}) {
  return (
    <>
      {section === "sources" &&
        (sources ? (
          <ProjectSourceSet
            compact
            projectId={project.id}
            initialSourceSet={sources}
            onSourceSetChange={onSourcesChange}
            initialCandidatePage={null}
          />
        ) : (
          <LoadState
            retry={sources === null ? retrySources : undefined}
          />
        ))}
      <Section active={section === "conversation"}>
        <Conversations
          projectId={project.id}
          conversationId={conversationId}
          active={section === "conversation"}
        />
      </Section>
      <Section active={section === "outputs"}>
        <Outputs project={project} revision={sources?.revision} />
      </Section>
      <Section active={section === "research"}>
        {sources && (
          <ProjectResearchNotebook
            onPublished={onResearch}
            deskRevision={deskRevision}
            projectId={project.id}
            currentSourceSetRevision={sources.revision}
          />
        )}
        {!sources && (
          <LoadState
            retry={sources === null ? retrySources : undefined}
          />
        )}
      </Section>
      <Section active={section === "search"}>
        <ProjectSearch projectId={project.id} />
      </Section>
      <Section active={section === "settings"}>
        <ProjectSettings project={project} onSaved={onSaved} />
      </Section>
    </>
  );
}
