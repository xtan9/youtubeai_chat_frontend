import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { reconcileStaleProjectVideoProcessing } from "@/lib/projects/project-video-processing";
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
  if (!subject.value.groundedAnswers || !subject.value.artifacts) {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  const groundedAnswers = subject.value.groundedAnswers;
  const conversationManagement = subject.value.conversations;
  const artifacts = subject.value.artifacts;

  let project: Awaited<ReturnType<typeof openResolvedProject>>;
  let sourceSet: Awaited<ReturnType<typeof loadProjectSourceSet>>;
  let candidates: Awaited<ReturnType<typeof loadProjectHistoryCandidates>>;
  let conversation: Awaited<
    ReturnType<typeof groundedAnswers.load>
  >;
  let conversationList: Awaited<ReturnType<NonNullable<typeof conversationManagement>["list"]>>;
  let studyGuide: Awaited<ReturnType<typeof artifacts.load>>;
  try {
    await reconcileStaleProjectVideoProcessing(
      subject.value,
      principalResult.principal.smokeProEntitled === true,
    );
    [project, sourceSet, candidates, conversation, conversationList, studyGuide] = await Promise.all([
      openResolvedProject(supabase, subject.value),
      loadProjectSourceSet(supabase, subject.value),
      loadProjectHistoryCandidates(supabase, subject.value),
      groundedAnswers.load(),
      conversationManagement?.list() ??
        Promise.resolve({ status: "unavailable" as const }),
      artifacts.load("study_guide"),
    ]);

    // A Project may contain named threads before the legacy default thread has
    // ever been used. In that case the compatibility loader has no history to
    // return, so resume the first listed thread instead of presenting a blank
    // active conversation after a page reload.
    if (
      conversation.status === "ready" &&
      conversation.conversation.conversationId === null &&
      conversationList.status === "ready" &&
      conversationList.conversations[0]
    ) {
      conversation = await groundedAnswers.load(
        conversationList.conversations[0].conversationId,
      );
    }
  } catch {
    return <ProjectOutcomeState kind="unavailable" />;
  }

  if (project.kind === "invalid" || project.kind === "missing") {
    return <ProjectOutcomeState kind={project.kind} />;
  }
  if (
    project.kind !== "resolved" ||
    sourceSet.kind !== "resolved" ||
    conversation.status !== "ready" ||
    studyGuide.status !== "ready"
  ) {
    return <ProjectOutcomeState kind="unavailable" />;
  }
  return (
    <ProjectView
      initialProject={project.value}
      initialSourceSet={sourceSet.value}
      initialConversation={conversation.conversation}
      initialConversations={
        conversationList.status === "ready" ? conversationList.conversations : []
      }
      initialCandidatePage={
        candidates.kind === "resolved" ? candidates.value : null
      }
      initialStudyGuide={studyGuide}
    />
  );
}
