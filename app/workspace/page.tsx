import type { Metadata } from "next";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { listWorkspaceProjects } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { ProjectOutcomeState } from "./_components/project-outcome-state";
import { WorkspaceView } from "./_components/workspace-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workspace - YouTube AI Chat",
  description: "Resume and organize your private YouTube research Projects.",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage() {
  const principalResult = await resolveRequestPrincipal({ source: "workspace_projects" });
  if (principalResult.kind === "unavailable") {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  if (principalResult.kind === "missing" || principalResult.principal.isAnonymous) {
    return <ProjectOutcomeState kind="anonymous" />;
  }

  let result: Awaited<ReturnType<typeof listWorkspaceProjects>>;
  try {
    const supabase = await createClient();
    result = await listWorkspaceProjects(supabase, principalResult.principal.userId);
  } catch {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  if (result.kind !== "resolved") {
    return <ProjectOutcomeState kind="unavailable" />;
  }

  return <WorkspaceView initialWorkspace={result.value} />;
}
