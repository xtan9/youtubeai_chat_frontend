import { getTranslations } from "next-intl/server";
import { buildAuthPageHref } from "@/lib/auth/signup-redirect";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { captureProjectActivityEvent } from "@/lib/analytics/server";
import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import {
  openResolvedProject,
  resolveProjectSubject,
} from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { ProjectOutcomeState } from "@/app/workspace/_components/project-outcome-state";
import { Workbench } from "./workbench";

export async function generateMetadata() {
  const tr = await getTranslations("ui");
  return {
    title: tr("videoProjectTitle"),
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
  searchParams,
  base = "/new-workspace",
}: {
  base?: string;
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const owner = await resolveRequestPrincipal({ source: "project" });
  if (owner.kind === "unavailable")
    return <ProjectOutcomeState kind="unavailable" />;
  if (owner.kind === "missing" || owner.principal.isAnonymous) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) query.append(key, item);
      }
    }
    const path = base + "/projects/" + encodeURIComponent(projectId);
    redirect(
      buildAuthPageHref("/auth/login", query.size ? path + "?" + query : path),
    );
  }
  const client = await createClient();
  const subject = await resolveProjectSubject(
    client,
    owner.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved")
    return (
      <ProjectOutcomeState
        kind={
          subject.kind === "missing" || subject.kind === "invalid"
            ? subject.kind
            : "unavailable"
        }
      />
    );
  const opened = await openResolvedProject(client, subject.value);
  if (opened.kind !== "resolved")
    return (
      <ProjectOutcomeState
        kind={opened.kind === "missing" ? "missing" : "unavailable"}
      />
    );
  scheduleAnalyticsAfterResponse(() =>
    captureProjectActivityEvent(
      owner.principal.userId,
      "project_opened",
      { project_id: projectId },
      owner.principal.businessAnalyticsSuppressed,
      `project-opened:${projectId}:${new Date().toISOString().slice(0, 10)}`,
    ),
  );
  const query = await searchParams;
  return (
    <Workbench
      legacy={
        query.view === "investigations" ||
        (base === "/new-workspace" &&
          !!(query.claim || query.finding || query.source !== undefined) &&
          !query.question &&
          !query.intent)
      }
      key={projectId}
      projectId={projectId}
      name={subject.value.name}
    />
  );
}
