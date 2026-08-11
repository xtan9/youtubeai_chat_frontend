import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import { captureProjectActivityEvent } from "@/lib/analytics/server";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

type RouteContext = { params: Promise<{ projectId: string }> };

const FeedbackRequestSchema = z
  .object({
    answerId: z.uuid(),
    rating: z.enum(["helpful", "not_helpful"]),
  })
  .strict();

const FeedbackResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.enum(["recorded", "deduplicated", "conflict"]),
      rating: z.enum(["helpful", "not_helpful"]),
      messageOrdinal: z.number().int().min(1).max(1_000_000),
    })
    .strict(),
  z.object({ outcome: z.literal("invalid") }).strict(),
  z.object({ outcome: z.literal("missing") }).strict(),
]);

function unavailableResponse() {
  return Response.json({ outcome: "unavailable" }, { status: 503 });
}

async function parseRequest(request: Request) {
  try {
    return FeedbackRequestSchema.safeParse(await request.json());
  } catch {
    return FeedbackRequestSchema.safeParse(null);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const parsed = await parseRequest(request);
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Choose a valid answer rating." },
      { status: 400 },
    );
  }

  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return unavailableResponse();
  }

  const { projectId } = await context.params;
  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);

  let rpcResult: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    rpcResult = await supabase.rpc("record_project_answer_feedback", {
      p_project_id: subject.value.projectId,
      p_answer_id: parsed.data.answerId,
      p_rating: parsed.data.rating,
    });
  } catch {
    return unavailableResponse();
  }
  if (rpcResult.error) return unavailableResponse();

  const result = FeedbackResultSchema.safeParse(rpcResult.data);
  if (!result.success) return unavailableResponse();

  if (result.data.outcome === "invalid") {
    return Response.json(result.data, { status: 400 });
  }
  if (result.data.outcome === "missing") {
    return Response.json(result.data, { status: 404 });
  }
  if (result.data.outcome === "conflict") {
    return Response.json(result.data, { status: 409 });
  }
  if (result.data.outcome === "recorded") {
    const recorded = result.data;
    scheduleAnalyticsAfterResponse(() =>
      captureProjectActivityEvent(
        researcher.principal.userId,
        "project_answer_feedback_submitted",
        {
          project_id: subject.value.projectId,
          answer_id: parsed.data.answerId,
          message_ordinal: recorded.messageOrdinal,
          rating: recorded.rating,
        },
        researcher.principal.businessAnalyticsSuppressed,
        `project-answer-feedback:${parsed.data.answerId}`,
      ),
    );
  }
  return Response.json(result.data);
}
