import { z } from "zod";
import { logAppEvent } from "@/lib/observability";
import {
  projectOutcomeResponse,
  projectUnavailableResponse,
} from "@/lib/projects/api-outcomes";
import type { ProjectArtifactReservation } from "@/lib/projects/project-artifact-contract";
import { PROJECT_GROUNDED_RETRIEVAL_LIMIT } from "@/lib/projects/project-grounded-answer-contract";
import { buildProjectAnswerArtifacts } from "@/lib/projects/project-grounded-evidence";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import {
  buildProjectStudyGuideMessages,
  validateProjectStudyGuide,
} from "@/lib/projects/project-study-guide";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import { streamChatCompletion } from "@/lib/services/llm-chat-client";
import { SPARK } from "@/lib/services/models";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ projectId: string }> };

const STUDY_GUIDE_KIND = "study_guide" as const;
const STUDY_GUIDE_PROMPT_VERSION = "study-guide-v1";
const STUDY_GUIDE_MAX_LENGTH = 100_000;
const StudyGuideGenerationRequestSchema = z
  .object({ attemptToken: z.uuid().optional() })
  .strict();

function jsonError(
  status: number,
  message: string,
  requestId: string,
  errorId: string,
) {
  return Response.json(
    { message },
    {
      status,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "X-Error-ID": errorId,
      },
    },
  );
}

function quotaResponse(requestId: string, generationsUsed: number) {
  return Response.json(
    {
      message:
        "Free includes 1 Artifact generation total. Upgrade to Pro for unlimited Artifact generations within technical and abuse limits.",
      errorCode: "free_artifact_generation_exceeded",
      tier: "free",
      upgradeUrl: "/pricing",
      artifactGenerationsUsed: generationsUsed,
      artifactGenerationsLimit: 1,
    },
    {
      status: 402,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "X-Error-ID": "PROJECT_ARTIFACT_QUOTA_EXCEEDED",
      },
    },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  let subject: Awaited<ReturnType<typeof resolveProjectSubject>>;
  try {
    supabase = await createClient();
    const { projectId } = await context.params;
    subject = await resolveProjectSubject(
      supabase,
      researcher.principal.userId,
      projectId,
    );
  } catch {
    return projectUnavailableResponse(requestId);
  }
  if (subject.kind === "unavailable") return projectUnavailableResponse(requestId);
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
  if (!subject.value.artifacts) return projectUnavailableResponse(requestId);

  const loaded = await subject.value.artifacts.load(STUDY_GUIDE_KIND);
  if (loaded.status === "missing") {
    return projectOutcomeResponse({ kind: "missing" });
  }
  if (loaded.status === "unavailable") {
    return projectUnavailableResponse(requestId);
  }
  return Response.json(
    { studyGuide: loaded },
    { headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsedBody = StudyGuideGenerationRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError(
      400,
      "Study Guide generation request is not valid.",
      requestId,
      "PROJECT_STUDY_GUIDE_REQUEST_INVALID",
    );
  }

  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher.response;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  let subject: Awaited<ReturnType<typeof resolveProjectSubject>>;
  try {
    supabase = await createClient();
    const { projectId } = await context.params;
    subject = await resolveProjectSubject(
      supabase,
      researcher.principal.userId,
      projectId,
    );
  } catch {
    return projectUnavailableResponse(requestId);
  }
  if (subject.kind === "invalid") {
    return jsonError(400, subject.message, requestId, "PROJECT_ID_INVALID");
  }
  if (subject.kind === "unavailable") return projectUnavailableResponse(requestId);
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
  if (!subject.value.artifacts || !subject.value.passageSearch) {
    return projectUnavailableResponse(requestId);
  }

  const rateLimit = await checkRateLimit(researcher.principal.userId, false);
  if (!rateLimit.allowed) {
    return jsonError(
      429,
      "Rate limit exceeded. Please try again later.",
      requestId,
      "RATE_LIMITED",
    );
  }

  const attemptToken = parsedBody.data.attemptToken ?? crypto.randomUUID();
  const started = await subject.value.artifacts.reserve(
    STUDY_GUIDE_KIND,
    attemptToken,
  );
  switch (started.status) {
    case "limit_reached":
      return quotaResponse(requestId, started.generationsUsed);
    case "invalid":
      return jsonError(
        400,
        "Study Guide generation request is not valid.",
        requestId,
        "PROJECT_STUDY_GUIDE_REQUEST_INVALID",
      );
    case "missing":
      return projectOutcomeResponse({ kind: "missing" });
    case "unavailable":
      return projectUnavailableResponse(requestId);
    case "started":
      break;
  }

  const reservation: ProjectArtifactReservation = {
    outcome: "started",
    attemptId: started.attemptId,
    attemptToken: started.attemptToken,
    kind: started.kind,
    tier: started.tier,
    generationsUsed: started.generationsUsed,
    generationsLimit: started.generationsLimit,
  };
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    const result = await subject.value.artifacts!.fail(reservation);
    if (result.status === "unavailable") {
      logAppEvent("error", "[project-study-guide] reservation release failed", {
        errorId: "PROJECT_ARTIFACT_RELEASE_FAILED",
        projectId: subject.value.projectId,
        requestId,
      });
    }
  };

  try {
    const query = [
      "Study Guide",
      subject.value.name,
      subject.value.guidance.goal,
    ]
      .filter((value): value is string => Boolean(value))
      .join(": ")
      .slice(0, 200);
    const search = await subject.value.passageSearch.search({
      query,
      limit: PROJECT_GROUNDED_RETRIEVAL_LIMIT,
    });
    if (search.status === "missing") {
      await release();
      return projectOutcomeResponse({ kind: "missing" });
    }
    if (search.status === "invalid" || search.status === "unavailable") {
      await release();
      return projectUnavailableResponse(requestId);
    }

    const artifacts = buildProjectAnswerArtifacts({
      projectId: subject.value.projectId,
      search,
      goal: subject.value.guidance.goal,
    });
    if (artifacts.evidenceSnapshot.passages.length === 0) {
      await release();
      return jsonError(
        409,
        search.status === "not_ready"
          ? "A Study Guide needs at least one ready Project Transcript. Try again when processing finishes."
          : "The ready Project Transcripts do not contain enough evidence for a Study Guide.",
        requestId,
        search.status === "not_ready"
          ? "PROJECT_STUDY_GUIDE_EVIDENCE_NOT_READY"
          : "PROJECT_STUDY_GUIDE_EVIDENCE_INSUFFICIENT",
      );
    }

    const messages = buildProjectStudyGuideMessages({
      projectName: subject.value.name,
      goal: subject.value.guidance.goal,
      sourceManifest: artifacts.sourceManifest,
      evidenceSnapshot: artifacts.evidenceSnapshot,
    });
    let generated = "";
    for await (const event of streamChatCompletion({
      messages,
      signal: request.signal,
    })) {
      if (event.type !== "delta") continue;
      generated += event.text;
      if (generated.length > STUDY_GUIDE_MAX_LENGTH) {
        throw new Error("Study Guide exceeded its technical limit.");
      }
    }

    const validated = validateProjectStudyGuide(
      generated,
      artifacts.sourceManifest,
    );
    if (validated.status !== "valid") {
      throw new Error(`Study Guide validation failed: ${validated.reason}`);
    }
    const generatedAt = new Date().toISOString();
    const completed = await subject.value.artifacts.complete({
      reservation,
      content: validated.content,
      artifacts,
      citationDiagnostics: validated.citationDiagnostics,
      generationMetadata: {
        model: SPARK,
        promptVersion: STUDY_GUIDE_PROMPT_VERSION,
        generatedAt,
      },
    });
    if (completed.status === "conflict") {
      await release();
      return jsonError(
        409,
        "The Source Set changed while the Study Guide was being generated. Try again to use the latest evidence.",
        requestId,
        "PROJECT_STUDY_GUIDE_SOURCE_SET_CHANGED",
      );
    }
    if (completed.status === "missing") {
      await release();
      return projectOutcomeResponse({ kind: "missing" });
    }
    if (completed.status !== "completed") {
      await release();
      return projectUnavailableResponse(requestId);
    }

    const loaded = await subject.value.artifacts.load(STUDY_GUIDE_KIND);
    if (loaded.status !== "ready") return projectUnavailableResponse(requestId);
    return Response.json(
      { studyGuide: loaded },
      {
        status: 201,
        headers: { [REQUEST_ID_HEADER]: requestId },
      },
    );
  } catch (error) {
    await release();
    logAppEvent("error", "[project-study-guide] generation failed", {
      errorId: "PROJECT_STUDY_GUIDE_GENERATION_FAILED",
      projectId: subject.value.projectId,
      errorName: error instanceof Error ? error.name : typeof error,
      requestId,
    });
    return projectUnavailableResponse(requestId);
  }
}
