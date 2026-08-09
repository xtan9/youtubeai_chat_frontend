import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import {
  loadProjectHistoryCandidates,
  loadProjectSourceSet,
} from "@/lib/projects/project-source-set";
import {
  openResolvedProject,
  resolveProjectSubject,
} from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { ProjectOutcomeState } from "../../_components/project-outcome-state";
import { ProjectView } from "./project-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project - YouTube AI Chat",
  robots: { index: false, follow: false },
};

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const principalResult = await resolveRequestPrincipal({ source: "project" });
  if (principalResult.kind === "unavailable") {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  if (principalResult.kind === "missing" || principalResult.principal.isAnonymous) {
    redirect("/auth/login?next=/workspace");
  }

  const { projectId } = await params;
  let subject: Awaited<ReturnType<typeof resolveProjectSubject>>;
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
    subject = await resolveProjectSubject(
      supabase,
      principalResult.principal.userId,
      projectId,
    );
  } catch {
    return <ProjectOutcomeState kind="unavailable" />;
  }

  if (subject.kind !== "resolved") {
    if (subject.kind === "invalid" || subject.kind === "missing") {
      return <ProjectOutcomeState kind={subject.kind} />;
    }
    return <ProjectOutcomeState kind="unavailable" />;
  }

  let project: Awaited<ReturnType<typeof openResolvedProject>>;
  let sourceSet: Awaited<ReturnType<typeof loadProjectSourceSet>>;
  let candidates: Awaited<ReturnType<typeof loadProjectHistoryCandidates>>;
  try {
    [project, sourceSet, candidates] = await Promise.all([
      openResolvedProject(supabase, subject.value),
      loadProjectSourceSet(supabase, subject.value),
      loadProjectHistoryCandidates(supabase, subject.value),
    ]);
  } catch {
    return <ProjectOutcomeState kind="unavailable" />;
  }

  if (project.kind === "invalid" || project.kind === "missing") {
    return <ProjectOutcomeState kind={project.kind} />;
  }
  if (project.kind !== "resolved" || sourceSet.kind !== "resolved") {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  return (
    <ProjectView
      initialProject={project.value}
      initialSourceSet={sourceSet.value}
      initialCandidatePage={
        candidates.kind === "resolved" ? candidates.value : null
      }
    />
  );
}
