import { z } from "zod";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string; questionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return projectOutcomeResponse({ kind: "unavailable" });
  }
  const { projectId, questionId } = await context.params;
  if (!z.uuid().safeParse(questionId).success) {
    return Response.json(
      { message: "Question identity is not valid." },
      { status: 400 },
    );
  }
  const rawConversationId = new URL(request.url).searchParams.get(
    "conversationId",
  );
  if (
    rawConversationId !== null &&
    !z.uuid().safeParse(rawConversationId).success
  ) {
    return Response.json(
      { message: "Conversation identity is not valid." },
      { status: 400 },
    );
  }
  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
  if (!subject.value.groundedAnswers) {
    return projectOutcomeResponse({ kind: "unavailable" });
  }

  const loaded = await subject.value.groundedAnswers.loadAttempt(
    questionId,
    rawConversationId ?? undefined,
  );
  if (loaded.status === "missing") {
    return Response.json(
      { outcome: "missing", message: "Question not found." },
      { status: 404 },
    );
  }
  if (loaded.status === "unavailable") {
    return projectOutcomeResponse({ kind: "unavailable" });
  }
  return Response.json({ attempt: loaded });
}
