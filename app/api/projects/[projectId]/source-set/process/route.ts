import { after } from "next/server";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import {
  completeProjectVideoProcessing,
  failProjectVideoProcessingCompletion,
  failProjectVideoProcessingSchedule,
  prepareProjectVideoProcessing,
  startProjectVideoProcessing,
  type ProjectVideoProcessingLease,
  type ProjectVideoProcessingStartOutcome,
} from "@/lib/projects/project-video-processing";
import { processProjectVideoSchema } from "@/lib/projects/project-source-set-input";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject, type ProjectSubject } from "@/lib/projects/project-subject";
import { extractVideoId } from "@/lib/services/youtube-url";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ projectId: string }> };

const MESSAGES = {
  already_ready: "That Video is already ready in this Project.",
  already_processing: "That Video is already processing in this Project.",
  limit_reached:
    "This Source Set already has five Videos, the universal grounding limit.",
  conflict:
    "The Source Set changed in another request. Review the latest sources and try again.",
  invalid_video: "Enter a valid HTTPS YouTube Video URL.",
  missing: "Project not found.",
  forbidden: "Project access is not allowed.",
  unavailable: "Project Video processing is temporarily unavailable.",
} as const;

function processingStartResponse(
  outcome: ProjectVideoProcessingStartOutcome,
): Response {
  const message =
    outcome.kind in MESSAGES
      ? MESSAGES[outcome.kind as keyof typeof MESSAGES]
      : undefined;
  const body = {
    outcome: outcome.kind,
    ...(message ? { message } : {}),
    ...(outcome.sourceSet ? { sourceSet: outcome.sourceSet } : {}),
  };

  switch (outcome.kind) {
    case "started":
    case "retry_started":
    case "already_processing":
      return Response.json(body, { status: 202 });
    case "already_ready":
      return Response.json(body);
    case "limit_reached":
    case "conflict":
      return Response.json(body, { status: 409 });
    case "invalid_video":
      return Response.json(body, { status: 400 });
    case "missing":
      return Response.json(body, { status: 404 });
    case "forbidden":
      return Response.json(body, { status: 403 });
    case "unavailable":
      return Response.json(body, { status: 503 });
  }
}

async function failAcceptedAttempt(
  subject: ProjectSubject,
  lease: ProjectVideoProcessingLease,
  principal: Parameters<typeof failProjectVideoProcessingSchedule>[0]["principal"],
) {
  await failProjectVideoProcessingSchedule({ subject, lease, principal });
}

export async function POST(request: Request, context: RouteContext) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { outcome: "invalid", message: "Video details must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = processProjectVideoSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      {
        outcome: "invalid",
        message: "Enter a valid HTTPS YouTube Video URL and Source Set revision.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }
  const youtubeVideoId = extractVideoId(parsed.data.youtubeUrl);
  if (!youtubeVideoId) {
    return Response.json(
      { outcome: "invalid", message: MESSAGES.invalid_video },
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
  const resolvedSubject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (resolvedSubject.kind !== "resolved") {
    return projectOutcomeResponse(resolvedSubject);
  }
  const subject = resolvedSubject.value;

  const started = await startProjectVideoProcessing(
    supabase,
    subject,
    youtubeVideoId,
    parsed.data.expectedRevision,
  );
  if (!started.lease) return processingStartResponse(started);
  const lease = started.lease;

  let prepared: Awaited<ReturnType<typeof prepareProjectVideoProcessing>>;
  try {
    prepared = await prepareProjectVideoProcessing(
      lease,
      researcher.principal,
    );
  } catch {
    await failAcceptedAttempt(subject, lease, researcher.principal);
    return processingStartResponse({ kind: "unavailable" });
  }

  if (!prepared.response.ok) {
    await completeProjectVideoProcessing({
      subject,
      lease,
      principal: researcher.principal,
      response: prepared.response.clone(),
    });
    return prepared.response;
  }

  try {
    after(async () => {
      try {
        await completeProjectVideoProcessing({
          subject,
          lease,
          principal: researcher.principal,
          response: prepared.response,
        });
      } catch {
        await failProjectVideoProcessingCompletion({
          subject,
          lease,
          principal: researcher.principal,
        });
      }
    });
  } catch {
    prepared.abort();
    await failAcceptedAttempt(subject, lease, researcher.principal);
    return processingStartResponse({ kind: "unavailable" });
  }

  return processingStartResponse(started);
}
