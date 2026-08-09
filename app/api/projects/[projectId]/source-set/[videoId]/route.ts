import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import {
  removeProjectVideoQuerySchema,
  videoIdSchema,
} from "@/lib/projects/project-source-set-input";
import { removeVideoFromProject } from "@/lib/projects/project-source-set";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { sourceSetMutationResponse } from "@/lib/projects/source-set-api-outcomes";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string; videoId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const { projectId, videoId: rawVideoId } = await context.params;
  const videoId = videoIdSchema.safeParse(rawVideoId);
  const revision = removeProjectVideoQuerySchema.safeParse({
    expectedRevision: new URL(request.url).searchParams.get("revision"),
  });
  if (!videoId.success || !revision.success) {
    return Response.json(
      { outcome: "invalid", message: "Choose a valid Project Video and revision." },
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

  const subject = await resolveProjectSubject(
    supabase,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);

  const result = await removeVideoFromProject(
    supabase,
    subject.value,
    videoId.data,
    revision.data.expectedRevision,
  );
  return sourceSetMutationResponse(result);
}
