import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { updateProjectSchema } from "@/lib/projects/project-input";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import {
  deleteProject,
  openProject,
  updateProject,
} from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

async function projectClient() {
  try {
    return { kind: "resolved", supabase: await createClient() } as const;
  } catch {
    return {
      kind: "error",
      response: projectOutcomeResponse({ kind: "unavailable" }),
    } as const;
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;
  const client = await projectClient();
  if (client.kind === "error") return client.response;

  const { projectId } = await context.params;
  const result = await openProject(
    client.supabase,
    researcher.principal.userId,
    projectId,
  );
  if (result.kind !== "resolved") return projectOutcomeResponse(result);
  return Response.json({ project: result.value });
}

export async function PATCH(request: Request, context: RouteContext) {
  const researcher = await requireRegisteredResearcher("project");
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
  const parsed = updateProjectSchema.safeParse(body);
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

  const client = await projectClient();
  if (client.kind === "error") return client.response;
  const { projectId } = await context.params;
  const result = await updateProject(
    client.supabase,
    researcher.principal.userId,
    projectId,
    parsed.data,
  );
  if (result.kind !== "resolved") return projectOutcomeResponse(result);
  return Response.json({ project: result.value });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;
  const client = await projectClient();
  if (client.kind === "error") return client.response;

  const { projectId } = await context.params;
  const result = await deleteProject(
    client.supabase,
    researcher.principal.userId,
    projectId,
  );
  if (result.kind !== "resolved") return projectOutcomeResponse(result);
  return new Response(null, { status: 204 });
}
