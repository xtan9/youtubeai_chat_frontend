import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { ResearchRequestSchema } from "@/lib/projects/project-research-contract";
import {
  completeResearch,
  failResearch,
  loadResearchVersions,
  reserveResearch,
} from "@/lib/projects/project-research-journal";
import { retrieveProjectResearchEvidence } from "@/lib/projects/project-research-retrieval";
import { createProjectResearchPassageSearchCapability } from "@/lib/projects/project-passage-search";
import { buildProjectAnswerArtifacts } from "@/lib/projects/project-grounded-evidence";
import { runProjectResearch } from "@/lib/projects/project-research-engine";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { logAppEvent } from "@/lib/observability";

export const maxDuration = 300;
type Context = { params: Promise<{ projectId: string }> };
const error = (status: number, message: string) =>
  Response.json({ message }, { status });
async function authorized(context: Context) {
  const researcher = await requireRegisteredResearcher("project");
  if (researcher.kind === "error") return { response: researcher.response };
  const client = await createClient();
  const { projectId } = await context.params;
  const subject = await resolveProjectSubject(
    client,
    researcher.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved")
    return { response: projectOutcomeResponse(subject) };
  return { client, subject: subject.value, principal: researcher.principal };
}
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorized(context);
    if (auth.response) return auth.response;
    const before = new URL(request.url).searchParams.get("before");
    if (before && !z.uuid().safeParse(before).success)
      return error(400, "Invalid research history cursor.");
    const versions = before
      ? await loadResearchVersions(
          auth.client!,
          auth.subject!.projectId,
          before,
        )
      : await loadResearchVersions(auth.client!, auth.subject!.projectId);
    return Response.json({
      versions,
      nextCursor: versions.length === 10 ? versions.at(-1)!.id : null,
    });
  } catch {
    return error(
      503,
      "Research history is temporarily unavailable. Please retry.",
    );
  }
}
export async function POST(request: Request, context: Context) {
  let reservation: { id: string; projectId: string } | undefined;
  let completed = false;
  let stage = "authorization";
  try {
    const auth = await authorized(context);
    if (auth.response) return auth.response;
    const { client, subject, principal } = auth;
    const body = ResearchRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!body.success)
      return error(400, "Enter a research question of 3–2,000 characters.");
    const limit = await checkRateLimit(principal!.userId, false);
    if (!limit.allowed)
      return error(
        429,
        "Too many research requests. Please try again shortly.",
      );
    stage = "reservation";
    const versions = await loadResearchVersions(client!, subject!.projectId);
    const previous = versions[0] ?? null;
    if ((previous?.id ?? null) !== body.data.baseVersionId)
      return error(
        409,
        "Research has changed. Reload the latest judgment before updating.",
      );
    const reserved = await reserveResearch(
      subject!.projectId,
      principal!.userId,
      body.data.baseVersionId,
    );
    if (reserved.outcome === "limit_reached")
      return error(
        402,
        "Free includes one research update. Upgrade to Pro to continue this research.",
      );
    if (reserved.outcome !== "started")
      return error(
        409,
        "Another update is running or the research has changed. Reload and try again.",
      );
    reservation = { id: reserved.id, projectId: subject!.projectId };
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(260_000),
    ]);
    stage = "retrieval";
    const search = await retrieveProjectResearchEvidence({
      passageSearch: createProjectResearchPassageSearchCapability(
        client!,
        subject!,
      ),
      question: body.data.question,
      projectName: subject!.name,
      history: previous
        ? [
            { role: "user", content: previous.document.question },
            {
              role: "assistant",
              content: previous.document.synthesis.judgment.text,
            },
          ]
        : [],
      signal,
      onUsage: () => undefined,
    });
    if (
      search.status !== "ready" &&
      search.status !== "no_results" &&
      search.status !== "not_ready"
    )
      throw new Error("project_retrieval_unavailable");
    const artifacts = buildProjectAnswerArtifacts({
      projectId: subject!.projectId,
      search,
      goal: null,
      balanceSources: true,
    });
    stage = "research";
    const document = await runProjectResearch({
      name: subject!.name,
      goal: subject!.guidance.goal,
      question: body.data.question,
      previous: previous?.document ?? null,
      artifacts,
      onStage: (next) => {
        stage = next;
      },
      signal,
      onUsage: () => undefined,
    });
    signal.throwIfAborted();
    stage = "persistence";
    const saved = await completeResearch(
      reserved.id,
      principal!.userId,
      document,
    );
    if (saved.outcome !== "completed")
      return error(
        409,
        "The project sources or research changed. Your previous judgment is preserved; reload and retry.",
      );
    completed = true;
    return Response.json(
      {
        versions: [saved.version, ...versions].slice(0, 10),
        nextCursor: versions.length >= 9 ? versions[8].id : null,
      },
      { status: 201 },
    );
  } catch (cause) {
    logAppEvent("error", "[project-research] update failed", {
      errorId: "PROJECT_RESEARCH_FAILED",
      stage,
      errorName: cause instanceof Error ? cause.name : typeof cause,
      ...(cause instanceof Error &&
      [
        "unknown_reference",
        "altered_quotation",
        "duplicate_reference",
        "missing_external_evidence",
        "literature_provider_unavailable",
        "literature_no_abstracts",
        "research_generation_too_large",
        "research_reservation_unavailable",
        "research_save_unavailable",
      ].includes(cause.message)
        ? { reason: cause.message }
        : {}),
    });
    return error(
      503,
      "Research could not finish. Your previous judgment is preserved. Please try again.",
    );
  } finally {
    if (reservation && !completed) {
      await failResearch(reservation.projectId, reservation.id).catch(() => {
        logAppEvent("error", "[project-research] release failed", {
          errorId: "PROJECT_RESEARCH_RELEASE_FAILED",
        });
      });
    }
  }
}
