import { createClient } from "@/lib/supabase/server";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { createProjectSchema } from "@/lib/projects/project-input";
import { createProject, listWorkspaceProjects } from "@/lib/projects/project-subject";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";

export async function GET() {
  const researcher = await requireRegisteredResearcher("workspace_projects");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return projectOutcomeResponse({ kind: "unavailable" });
  }

  const result = await listWorkspaceProjects(
    supabase,
    researcher.principal.userId,
  );
  if (result.kind !== "resolved") return projectOutcomeResponse(result);
  return Response.json({ workspace: result.value });
}

export async function POST(request: Request) {
  const researcher = await requireRegisteredResearcher("workspace_projects", {
    projectCreation: true,
  });
  if (researcher.kind === "error") return researcher.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return projectOutcomeResponse({
      kind: "invalid",
      message: "Project details must be valid JSON.",
    });
  }
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        outcome: "invalid",
        message: "Check the highlighted Project details.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return projectOutcomeResponse({ kind: "unavailable" });
  }
  const result = await createProject(
    supabase,
    researcher.principal.userId,
    parsed.data,
  );
  if (result.kind !== "resolved") return projectOutcomeResponse(result);
  return Response.json({ project: result.value }, { status: 201 });
}
