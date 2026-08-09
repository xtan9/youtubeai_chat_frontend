import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectConversationManagement } from "@/lib/projects/project-conversation-api";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import {
  ProjectConversationCreateRequestSchema,
  ProjectConversationRenameRequestSchema,
} from "@/lib/projects/project-grounded-answer-contract";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
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

  const rawConversationId = new URL(request.url).searchParams.get(
    "conversationId",
  );
  if (
    rawConversationId !== null &&
    !z.uuid().safeParse(rawConversationId).success
  ) {
    return Response.json(
      { outcome: "invalid", message: "Conversation identity is not valid." },
      { status: 400 },
    );
  }
  const loaded = await subject.value.groundedAnswers.load(
    rawConversationId ?? undefined,
  );
  if (loaded.status === "missing") {
    return projectOutcomeResponse({ kind: "missing" });
  }
  if (loaded.status === "unavailable") {
    return projectOutcomeResponse({ kind: "unavailable" });
  }
  return Response.json({ conversation: loaded.conversation });
}

function conversationMutationResponse(result: {
  status:
    | "created"
    | "renamed"
    | "cleared"
    | "missing"
    | "invalid"
    | "unavailable";
  conversation?: unknown;
}): Response {
  if (result.status === "created") {
    return Response.json({ conversation: result.conversation }, { status: 201 });
  }
  if (result.status === "renamed" || result.status === "cleared") {
    return Response.json({ outcome: result.status });
  }
  if (result.status === "invalid") {
    return Response.json(
      { outcome: "invalid", message: "Conversation details are not valid." },
      { status: 400 },
    );
  }
  if (result.status === "missing") {
    return Response.json(
      { outcome: "missing", message: "Project conversation not found." },
      { status: 404 },
    );
  }
  return Response.json(
    {
      outcome: "unavailable",
      message: "Project conversations are temporarily unavailable.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = ProjectConversationCreateRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Conversation name is not valid." },
      { status: 400 },
    );
  }
  const { projectId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  return conversationMutationResponse(
    await resolved.capability.create(parsed.data.name),
  );
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const parsed = z
    .object({
      conversationId: z.uuid(),
      name: ProjectConversationRenameRequestSchema.shape.name,
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Conversation details are not valid." },
      { status: 400 },
    );
  }
  const { projectId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  return conversationMutationResponse(
    await resolved.capability.rename(parsed.data.conversationId, parsed.data.name),
  );
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const parsed = z
    .object({ conversationId: z.uuid() })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Conversation identity is not valid." },
      { status: 400 },
    );
  }
  const { projectId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  return conversationMutationResponse(
    await resolved.capability.clear(parsed.data.conversationId),
  );
}
