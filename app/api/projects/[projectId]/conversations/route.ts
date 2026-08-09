import {
  ProjectConversationCreateRequestSchema,
} from "@/lib/projects/project-grounded-answer-contract";
import { resolveProjectConversationManagement } from "@/lib/projects/project-conversation-api";

type RouteContext = { params: Promise<{ projectId: string }> };

function mutationResponse(result: {
  status:
    | "created"
    | "renamed"
    | "cleared"
    | "missing"
    | "invalid"
    | "unavailable";
  conversation?: unknown;
}): Response {
  switch (result.status) {
    case "created":
      return Response.json({ conversation: result.conversation }, { status: 201 });
    case "invalid":
      return Response.json(
        { outcome: "invalid", message: "Conversation name is not valid." },
        { status: 400 },
      );
    case "missing":
      return Response.json(
        { outcome: "missing", message: "Project not found." },
        { status: 404 },
      );
    case "unavailable":
      return Response.json(
        {
          outcome: "unavailable",
          message: "Project conversations are temporarily unavailable.",
        },
        { status: 503 },
      );
    case "renamed":
    case "cleared":
      return Response.json({ outcome: result.status });
  }
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { projectId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  const result = await resolved.capability.list();
  if (result.status === "ready") {
    return Response.json({
      conversations: result.conversations,
      messagesUsed: result.messagesUsed,
      messagesLimit: result.messagesLimit,
      tier: result.tier,
    });
  }
  if (result.status === "missing") {
    return Response.json(
      { outcome: "missing", message: "Project not found." },
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
  const body = await request.json().catch(() => null);
  const parsed = ProjectConversationCreateRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Conversation name is not valid." },
      { status: 400 },
    );
  }
  const { projectId } = await context.params;
  const resolved = await resolveProjectConversationManagement(projectId);
  if ("response" in resolved) return resolved.response;
  return mutationResponse(await resolved.capability.create(parsed.data.name));
}
