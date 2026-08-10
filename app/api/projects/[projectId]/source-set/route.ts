import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import { captureProjectActivityEvent } from "@/lib/analytics/server";
import { recordProjectAnalyticsTransition } from "@/lib/analytics/project-server";
import {
  addProjectHistoryVideoSchema,
  reorderProjectVideosSchema,
} from "@/lib/projects/project-source-set-input";
import {
  addHistoryVideoToProject,
  loadProjectSourceSet,
  reorderProjectVideos,
} from "@/lib/projects/project-source-set";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { reconcileStaleProjectVideoProcessing } from "@/lib/projects/project-video-processing";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { sourceSetMutationResponse } from "@/lib/projects/source-set-api-outcomes";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

async function parseJson(request: Request) {
  try {
    return { ok: true, body: await request.json() } as const;
  } catch {
    return { ok: false } as const;
  }
}

async function sourceSetContext(context: RouteContext) {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return researcher;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return {
      kind: "error",
      response: projectOutcomeResponse({ kind: "unavailable" }),
    } as const;
  }

  const { projectId } = await context.params;
  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved") {
    return { kind: "error", response: projectOutcomeResponse(subject) } as const;
  }
  return {
    kind: "resolved",
    supabase,
    subject: subject.value,
    principal: researcher.principal,
  } as const;
}

export async function GET(_request: Request, context: RouteContext) {
  const routeContext = await sourceSetContext(context);
  if (routeContext.kind === "error") return routeContext.response;

  await reconcileStaleProjectVideoProcessing(
    routeContext.subject,
    routeContext.principal.businessAnalyticsSuppressed,
  );

  const result = await loadProjectSourceSet(
    routeContext.supabase,
    routeContext.subject,
  );
  if (result.kind !== "resolved") return projectOutcomeResponse(result);
  return Response.json({ sourceSet: result.value });
}

export async function POST(request: Request, context: RouteContext) {
  const parsedJson = await parseJson(request);
  if (!parsedJson.ok) {
    return Response.json(
      { outcome: "invalid", message: "Source Set details must be valid JSON." },
      { status: 400 },
    );
  }
  const parsed = addProjectHistoryVideoSchema.safeParse(parsedJson.body);
  if (!parsed.success) {
    return Response.json(
      {
        outcome: "invalid",
        message: "Choose a valid History Video and current Source Set revision.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const routeContext = await sourceSetContext(context);
  if (routeContext.kind === "error") return routeContext.response;
  const result = await addHistoryVideoToProject(
    routeContext.supabase,
    routeContext.subject,
    parsed.data.videoId,
    parsed.data.expectedRevision,
  );
  if (result.kind === "added" && result.sourceSet) {
    const sourceSetRevision = result.sourceSet.revision;
    const addedVideo = result.sourceSet.videos.find(
      (video) => video.videoId === parsed.data.videoId,
    );
    if (addedVideo) {
      scheduleAnalyticsAfterResponse(async () => {
        await Promise.all([
          captureProjectActivityEvent(
            routeContext.principal.userId,
            "project_source_added",
            {
              project_id: routeContext.subject.projectId,
              source_kind: "history",
              readiness: "ready",
              source_ordinal: addedVideo.position,
              source_set_revision: sourceSetRevision,
            },
            routeContext.principal.businessAnalyticsSuppressed,
            `project-source-added:${routeContext.subject.projectId}:${addedVideo.videoId}`,
          ),
          recordProjectAnalyticsTransition({
            projectId: routeContext.subject.projectId,
            ownerId: routeContext.principal.userId,
            trigger: "source_ready",
            occurredAt: addedVideo.statusUpdatedAt,
            businessAnalyticsSuppressed:
              routeContext.principal.businessAnalyticsSuppressed,
          }),
        ]);
      });
    }
  }
  return sourceSetMutationResponse(result);
}

export async function PATCH(request: Request, context: RouteContext) {
  const parsedJson = await parseJson(request);
  if (!parsedJson.ok) {
    return Response.json(
      { outcome: "invalid", message: "Source Set details must be valid JSON." },
      { status: 400 },
    );
  }
  const parsed = reorderProjectVideosSchema.safeParse(parsedJson.body);
  if (!parsed.success) {
    return Response.json(
      {
        outcome: "invalid",
        message: "Check the requested Source Set order.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const routeContext = await sourceSetContext(context);
  if (routeContext.kind === "error") return routeContext.response;
  const result = await reorderProjectVideos(
    routeContext.supabase,
    routeContext.subject,
    parsed.data.videoIds,
    parsed.data.expectedRevision,
  );
  return sourceSetMutationResponse(result);
}
