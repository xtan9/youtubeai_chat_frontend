import { getTranslations } from "next-intl/server";
import { buildAuthPageHref } from "@/lib/auth/signup-redirect";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { captureProjectActivityEvent } from "@/lib/analytics/server";
import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import { openProject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { ProjectOutcomeState } from "@/app/workspace/_components/project-outcome-state";
import { Workbench } from "./workbench";

export async function generateMetadata() {
  const tr = await getTranslations("project");
  return {
    title: tr("project"),
    robots: { index: false, follow: false },
  };
}
export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const { projectId } = await params;
  const path = "/workspace/projects/" + encodeURIComponent(projectId);
  const original = await searchParams;
  const query = new URLSearchParams();
  let hasRetiredView = false;
  for (const [key, value] of Object.entries(original)) {
    if (["panel", "conversationId", "view", "intent"].includes(key)) {
      hasRetiredView = true;
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(key, item);
    }
  }
  const destination = query.size ? path + "?" + query : path;
  if (hasRetiredView) redirect(destination);

  const owner = await resolveRequestPrincipal({ source: "project" });
  if (owner.kind === "unavailable")
    return <ProjectOutcomeState kind="unavailable" />;
  if (owner.kind === "missing" || owner.principal.isAnonymous) {
    redirect(buildAuthPageHref("/auth/login", destination));
  }
  let opened: Awaited<ReturnType<typeof openProject>>;
  try {
    opened = await openProject(
      await createClient(),
      owner.principal.userId,
      projectId,
    );
  } catch {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  if (opened.kind !== "resolved") {
    const kind =
      opened.kind === "missing" || opened.kind === "invalid"
        ? opened.kind
        : "unavailable";
    return <ProjectOutcomeState kind={kind} />;
  }
  scheduleAnalyticsAfterResponse(() =>
    captureProjectActivityEvent(
      owner.principal.userId,
      "project_opened",
      { project_id: projectId },
      owner.principal.businessAnalyticsSuppressed,
      `project-opened:${projectId}:${new Date().toISOString().slice(0, 10)}`,
    ),
  );
  return <Workbench key={projectId} project={opened.value} />;
}
