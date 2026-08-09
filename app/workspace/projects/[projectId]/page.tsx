import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { openProject } from "@/lib/projects/project-subject";
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
  let result: Awaited<ReturnType<typeof openProject>>;
  try {
    const supabase = await createClient();
    result = await openProject(supabase, principalResult.principal.userId, projectId);
  } catch {
    return <ProjectOutcomeState kind="unavailable" />;
  }

  if (result.kind === "invalid" || result.kind === "missing") {
    return <ProjectOutcomeState kind={result.kind} />;
  }
  if (result.kind !== "resolved") {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  return <ProjectView initialProject={result.value} />;
}
