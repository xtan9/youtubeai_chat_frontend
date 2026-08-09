import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import {
  projectPassageSearchInputSchema,
  projectPassageSearchRequestSchema,
} from "@/lib/projects/project-passage-search-contract";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsedRequest = projectPassageSearchRequestSchema.safeParse(body);
  const parsedInput = parsedRequest.success
    ? projectPassageSearchInputSchema.safeParse({
        query: parsedRequest.data.query,
        limit: 8,
      })
    : parsedRequest;
  if (!parsedInput.success) {
    return Response.json(
      {
        outcome: "invalid",
        message:
          parsedInput.error.issues[0]?.message ?? "Search terms are not valid.",
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

  if (!subject.value.passageSearch) {
    return projectOutcomeResponse({ kind: "unavailable" });
  }
  const result = await subject.value.passageSearch.search(parsedInput.data);
  switch (result.status) {
    case "ready":
    case "no_results":
    case "not_ready":
      return Response.json({ search: result });
    case "invalid":
      return Response.json(
        { outcome: "invalid", message: "Search terms are not valid." },
        { status: 400 },
      );
    case "missing":
      return projectOutcomeResponse({ kind: "missing" });
    case "unavailable":
      return projectOutcomeResponse({ kind: "unavailable" });
  }
}
