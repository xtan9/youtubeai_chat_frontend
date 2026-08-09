import { ProjectGroundedCancellationRequestSchema } from "@/lib/projects/project-grounded-answer-contract";
import {
  projectOutcomeResponse,
  projectUnavailableResponse,
} from "@/lib/projects/api-outcomes";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = ProjectGroundedCancellationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { message: "Cancellation request is not valid." },
      {
        status: 400,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
          "X-Error-ID": "PROJECT_QUESTION_CANCELLATION_INVALID",
        },
      },
    );
  }

  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return projectUnavailableResponse(requestId);
  }

  const { projectId } = await context.params;
  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind === "invalid") {
    return Response.json(
      { outcome: "invalid", message: subject.message },
      {
        status: 400,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
          "X-Error-ID": "PROJECT_ID_INVALID",
        },
      },
    );
  }
  if (subject.kind === "unavailable") {
    return projectUnavailableResponse(requestId);
  }
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
  if (!subject.value.groundedAnswers) {
    return projectUnavailableResponse(requestId);
  }

  const cancelled = await subject.value.groundedAnswers.cancel(
    parsed.data.userMessageId,
  );
  if (cancelled.status === "missing") {
    return projectOutcomeResponse({ kind: "missing" });
  }
  if (cancelled.status === "unavailable") {
    return projectUnavailableResponse(requestId);
  }
  return Response.json(
    { outcome: "cancelled" },
    { headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}
