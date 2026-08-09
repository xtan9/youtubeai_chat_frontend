import {
  ProjectConversationRenameRequestSchema,
} from "@/lib/projects/project-grounded-answer-contract";
import { resolveProjectConversationManagement } from "@/lib/projects/project-conversation-api";

type RouteContext = {
  params: Promise<{ projectId: string; conversationId: string }>;
};

function resultResponse(result: {
  status:
    | "created"
    | "renamed"
    | "cleared"
    | "missing"
    | "invalid"
    | "unavailable";
}) {
  if (result.status === "renamed" || result.status === "cleared") {
    return Response.json({ outcome: result.status });
  }
  if (result.status === "created") {
    return Response.json(
      { outcome: "unavailable", message: "Conversation mutation was invalid." },
      { status: 503 },
    );
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

export async function PATCH(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const parsed = ProjectConversationRenameRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Conversation name is not valid." },
      { status: 400 },
    );
  }
  const { projectId, conversationId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  return resultResponse(
    await resolved.capability.rename(conversationId, parsed.data.name),
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId, conversationId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  return resultResponse(
    await resolved.capability.clear(conversationId),
  );
}
