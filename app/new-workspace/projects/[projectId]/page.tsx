import {getTranslations} from "next-intl/server";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { ProjectOutcomeState } from "@/app/workspace/_components/project-outcome-state";
import { Workbench } from "./workbench";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tr = await getTranslations("ui");
  return {title: tr("videoProjectTitle"), robots: {index: false, follow: false}};
}
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const owner = await resolveRequestPrincipal({ source: "project" });
  if (owner.kind === "unavailable")
    return <ProjectOutcomeState kind="unavailable" />;
  if (owner.kind === "missing" || owner.principal.isAnonymous)
    redirect(
      "/auth/login?next=" +
        encodeURIComponent("/new-workspace/projects/" + projectId),
    );
  const subject = await resolveProjectSubject(
    await createClient(),
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
  return (
    <Workbench
      key={projectId}
      projectId={projectId}
      name={subject.value.name}
    />
  );
}
