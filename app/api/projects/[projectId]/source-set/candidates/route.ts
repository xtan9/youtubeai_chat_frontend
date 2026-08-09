import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { projectHistoryCandidateQuerySchema } from "@/lib/projects/project-source-set-input";
import { loadProjectHistoryCandidates } from "@/lib/projects/project-source-set";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const url = new URL(request.url);
  const parsed = projectHistoryCandidateQuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      {
        outcome: "invalid",
        message: "Check the History search and page.",
      },
      { status: 400 },
    );
  }

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

  const candidates = await loadProjectHistoryCandidates(
    supabase,
    subject.value,
    parsed.data,
  );
  if (candidates.kind !== "resolved") return projectOutcomeResponse(candidates);
  return Response.json({ candidatePage: candidates.value });
}
