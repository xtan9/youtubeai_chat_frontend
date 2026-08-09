import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return projectOutcomeResponse({ kind: "unavailable" });
  }

  const { projectId } = await context.params;
  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
  if (!subject.value.groundedAnswers) {
    return projectOutcomeResponse({ kind: "unavailable" });
  }

  const loaded = await subject.value.groundedAnswers.load();
  if (loaded.status === "missing") {
    return projectOutcomeResponse({ kind: "missing" });
  }
  if (loaded.status === "unavailable") {
    return projectOutcomeResponse({ kind: "unavailable" });
  }
  return Response.json({ conversation: loaded.conversation });
}
