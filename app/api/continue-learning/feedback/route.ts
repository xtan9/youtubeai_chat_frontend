import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  recordContinueLearningFeedback,
} from "@/lib/services/continue-learning-reader";
import { z } from "zod";

const FeedbackRequestSchema = z
  .object({
    token: z.string().regex(/^cl1\.[A-Za-z0-9_-]{43}$/),
    judgment: z.enum(["useful", "not_useful"]),
  })
  .strict();

function enabled(): boolean {
  return (
    process.env.CONTINUE_LEARNING_READER_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}

function unavailableResponse(): Response {
  return Response.json({ outcome: "unavailable" }, { status: 503 });
}

async function parseRequest(request: Request) {
  try {
    return FeedbackRequestSchema.safeParse(await request.json());
  } catch {
    return FeedbackRequestSchema.safeParse(null);
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseRequest(request);
  if (!parsed.success) {
    return Response.json(
      { outcome: "invalid", message: "Choose a valid Recommendation judgment." },
      { status: 400 },
    );
  }

  const principalResult = await resolveRequestPrincipal({
    source: "continue_learning_feedback",
  });
  if (principalResult.kind === "unavailable") return unavailableResponse();
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return Response.json({ outcome: "missing" }, { status: 401 });
  }

  if (!enabled()) {
    return Response.json({
      outcome: "unavailable",
      reason: "feature_disabled",
    });
  }

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) return unavailableResponse();

  const result = await recordContinueLearningFeedback(serviceClient, {
    learnerId: principalResult.principal.userId,
    token: parsed.data.token,
    judgment: parsed.data.judgment,
  });
  if (!result) return unavailableResponse();
  if (result.outcome === "invalid") {
    return Response.json(result, { status: 400 });
  }
  if (result.outcome === "missing") {
    return Response.json(result, { status: 404 });
  }
  return Response.json(result);
}
