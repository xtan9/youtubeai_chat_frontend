import { NextIntlClientProvider } from "next-intl";
import { getNow } from "next-intl/server";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { listWorkspaceProjects } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { ProjectOutcomeState } from "./project-outcome-state";
import {IntentLanding} from "../intent/landing";

export async function WorkspaceListing() {
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

  return (
    <NextIntlClientProvider now={await getNow()}>
      <IntentLanding workspace={result.value} />
    </NextIntlClientProvider>
  );
}
