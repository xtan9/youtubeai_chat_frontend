import "server-only";

import { z } from "zod";
import type { ChatGatewayMessage } from "@/lib/prompts/chat";
import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import { recordProjectGenerationUsage } from "@/lib/analytics/project-server";
import { logAppEvent } from "@/lib/observability";
import {
  projectOutcomeResponse,
  projectUnavailableResponse,
} from "@/lib/projects/api-outcomes";
import type {
  ProjectAnswerSourceManifest,
  ProjectCitationDiagnostic,
  ProjectEvidenceSnapshot,
} from "@/lib/projects/project-grounded-answer-contract";
import type {
  ProjectArtifactGenerationMetadataSchema,
  ProjectArtifactKind,
  ProjectArtifactReservation,
} from "@/lib/projects/project-artifact-contract";
import { buildProjectAnswerArtifacts } from "@/lib/projects/project-grounded-evidence";
import { createProjectResearchPassageSearchCapability } from "@/lib/projects/project-passage-search";
import { ProjectResearchRetrievalError, retrieveProjectResearchEvidence } from "@/lib/projects/project-research-retrieval";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import {
  streamChatCompletion,
  type ChatTokenUsage,
} from "@/lib/services/llm-chat-client";
import { ChatGatewayError } from "@/lib/services/llm-chat-error";
import { LUNA } from "@/lib/services/models";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

type ValidArtifact = {
  readonly status: "valid";
  readonly content: string;
  readonly citationDiagnostics: readonly ProjectCitationDiagnostic[];
};

type InvalidArtifact = {
  readonly status: "invalid";
  readonly reason: string;
};

type ProjectArtifactRouteBase = Readonly<{
  kind: ProjectArtifactKind;
  title: string;
  responseKey: string;
  promptVersion: string;
  errorPrefix: string;
  logScope: string;
  evidenceNotReadyMessage: string;
  evidenceInsufficientMessage: string;
  synthesisTimeoutMs?: number;
}>;

type ProjectArtifactGeneration = Readonly<{
  messages: readonly ChatGatewayMessage[];
  validate(content: string): ValidArtifact | InvalidArtifact;
  repairMessages?(safeReason: string): readonly ChatGatewayMessage[] | null;
  generationMetadata?: Pick<
    z.infer<typeof ProjectArtifactGenerationMetadataSchema>,
    "normalizationAudit"
  >;
}>;

type StandardProjectArtifactRouteDefinition = Readonly<{
  buildMessages(args: {
    readonly projectName: string;
    readonly goal: string | null;
    readonly sourceManifest: ProjectAnswerSourceManifest;
    readonly evidenceSnapshot: ProjectEvidenceSnapshot;
  }): readonly ChatGatewayMessage[];
  validate(
    content: string,
    sourceManifest: ProjectAnswerSourceManifest,
    evidenceSnapshot: ProjectEvidenceSnapshot,
    goal: string | null,
  ): ValidArtifact | InvalidArtifact;
  prepareGeneration?: never;
}>;

type PreparedProjectArtifactRouteDefinition = Readonly<{
  buildMessages?: never;
  validate?: never;
  prepareGeneration(args: {
    readonly projectName: string;
    readonly goal: string | null;
    readonly sourceManifest: ProjectAnswerSourceManifest;
    readonly evidenceSnapshot: ProjectEvidenceSnapshot;
    readonly signal: AbortSignal;
    readonly onUsage: (usage: ChatTokenUsage) => void;
  }): Promise<ProjectArtifactGeneration>;
}>;

export type ProjectArtifactRouteDefinition = ProjectArtifactRouteBase &
  (StandardProjectArtifactRouteDefinition | PreparedProjectArtifactRouteDefinition);

const MAX_ARTIFACT_LENGTH = 100_000;
type ArtifactFailureStage =
  | "retrieval" | "evidence_selection" | "preparation" | "generation"
  | "validation" | "persistence" | "reload";

// Validators may return strings, but diagnostics must never echo model prose
// or arbitrary exception text. Unknown/new reasons stay redacted until reviewed.
const SAFE_VALIDATION_REASONS = new Set([
  "empty", "insufficient_evidence", "invalid_structure", "invalid_citation",
  "uncited_claim", "source_similarity", "structure_similarity", "goal_irrelevant",
  "unsupported_inspiration", "missing_source_representation", "untrusted_presentation",
  "duplicate_evidence", "unknown_evidence", "altered_quotation",
  "comparison_requires_distinct_sources", "missing_source",
]);
const GenerationRequestSchema = z
  .object({ attemptToken: z.uuid().optional() })
  .strict();

function accumulateChatTokenUsage(
  current: ChatTokenUsage | undefined,
  next: ChatTokenUsage,
): ChatTokenUsage {
  return {
    inputTokens: (current?.inputTokens ?? 0) + next.inputTokens,
    cachedInputTokens:
      (current?.cachedInputTokens ?? 0) + next.cachedInputTokens,
    outputTokens: (current?.outputTokens ?? 0) + next.outputTokens,
  };
}

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

export function createProjectArtifactRoute(
  definition: ProjectArtifactRouteDefinition,
) {
  async function GET(request: Request, context: RouteContext) {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const researcher = await requireRegisteredResearcher("project");
    if (researcher.kind === "error") return researcher.response;

    let subject: Awaited<ReturnType<typeof resolveProjectSubject>>;
    try {
      const supabase = await createClient();
      const { projectId } = await context.params;
      subject = await resolveProjectSubject(
        supabase,
        researcher.principal.userId,
        projectId,
      );
    } catch {
      return projectUnavailableResponse(requestId);
    }
    if (subject.kind === "unavailable") {
      return projectUnavailableResponse(requestId);
    }
    if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
    if (!subject.value.artifacts) return projectUnavailableResponse(requestId);

    const loaded = await subject.value.artifacts.load(definition.kind);
    if (loaded.status === "missing") {
      return projectOutcomeResponse({ kind: "missing" });
    }
    if (loaded.status === "unavailable") {
      return projectUnavailableResponse(requestId);
    }
    return Response.json(
      { [definition.responseKey]: loaded },
      { headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  async function POST(request: Request, context: RouteContext) {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsedBody = GenerationRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return jsonError(
        400,
        `${definition.title} generation request is not valid.`,
        requestId,
        `${definition.errorPrefix}_REQUEST_INVALID`,
      );
    }

    const researcher = await requireRegisteredResearcher("project");
    if (researcher.kind === "error") return researcher.response;

    let subject: Awaited<ReturnType<typeof resolveProjectSubject>>;
    let supabase: Awaited<ReturnType<typeof createClient>>;
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
    if (subject.kind === "unavailable") {
      return projectUnavailableResponse(requestId);
    }
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
      definition.kind,
      attemptToken,
    );
    switch (started.status) {
      case "limit_reached":
        return quotaResponse(requestId, started.generationsUsed);
      case "invalid":
        return jsonError(
          400,
          `${definition.title} generation request is not valid.`,
          requestId,
          `${definition.errorPrefix}_REQUEST_INVALID`,
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
    let generationStartedAt: number | null = null;
    let generationUsage: ChatTokenUsage | undefined;
    let plannerStarted = false;
    let plannerUsageReceived = false;
    let synthesisStarted = false;
    let synthesisUsageComplete = true;
    let activationOccurredAt: string | null = null;
    let failureStage: ArtifactFailureStage = "retrieval";
    let validationReason: string | undefined;
    let failureCode: "artifact_too_long" | "generation_timeout" | undefined;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      const result = await subject.value.artifacts!.fail(reservation);
      if (result.status === "unavailable") {
        logAppEvent(
          "error",
          `[${definition.logScope}] reservation release failed`,
          {
            errorId: "PROJECT_ARTIFACT_RELEASE_FAILED",
            projectId: subject.value.projectId,
            requestId,
          },
        );
      }
    };

    try {
      const search = await retrieveProjectResearchEvidence({
        passageSearch: createProjectResearchPassageSearchCapability(supabase, subject.value),
        question: `Prepare a ${definition.title} about ${subject.value.name}. Research goal: ${subject.value.guidance.goal ?? "Understand the topic and compare the evidence."}`,
        signal: request.signal,
        onPlanningStart: () => {
          plannerStarted = true;
          generationStartedAt ??= Date.now();
        },
        onUsage: (usage) => {
          plannerUsageReceived = true;
          generationUsage = accumulateChatTokenUsage(generationUsage, usage);
        },
      });
      if (search.status === "missing") {
        await release();
        return projectOutcomeResponse({ kind: "missing" });
      }
      if (search.status === "invalid" || search.status === "unavailable") {
        await release();
        return projectUnavailableResponse(requestId);
      }

      failureStage = "evidence_selection";
      const artifacts = buildProjectAnswerArtifacts({
        projectId: subject.value.projectId,
        search,
        // Planned research already owns relevance; keep its findings priority.
        goal: null,
        balanceSources: true,
      });
      if (artifacts.evidenceSnapshot.passages.length === 0) {
        await release();
        return jsonError(
          409,
          search.status === "not_ready"
            ? definition.evidenceNotReadyMessage
            : definition.evidenceInsufficientMessage,
          requestId,
          search.status === "not_ready"
            ? `${definition.errorPrefix}_EVIDENCE_NOT_READY`
            : `${definition.errorPrefix}_EVIDENCE_INSUFFICIENT`,
        );
      }

      generationStartedAt ??= Date.now();
      failureStage = "preparation";
      const generation: ProjectArtifactGeneration = definition.prepareGeneration
        ? await definition.prepareGeneration({
            projectName: subject.value.name,
            goal: subject.value.guidance.goal,
            sourceManifest: artifacts.sourceManifest,
            evidenceSnapshot: artifacts.evidenceSnapshot,
            signal: request.signal,
            onUsage: (usage) => {
              generationUsage = accumulateChatTokenUsage(
                generationUsage,
                usage,
              );
            },
          })
        : {
            messages: definition.buildMessages({
              projectName: subject.value.name,
              goal: subject.value.guidance.goal,
              sourceManifest: artifacts.sourceManifest,
              evidenceSnapshot: artifacts.evidenceSnapshot,
            }),
            validate: (content: string) =>
              definition.validate(
                content,
                artifacts.sourceManifest,
                artifacts.evidenceSnapshot,
                subject.value.guidance.goal,
              ),
          };
      let messages = generation.messages;
      let validated: ValidArtifact | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        request.signal.throwIfAborted();
        let generated = "";
        let attemptUsage: ChatTokenUsage | undefined;
        synthesisStarted = true;
        failureStage = "generation";
        validationReason = undefined;
        const deadline = new AbortController();
        const timer = definition.synthesisTimeoutMs === undefined ? undefined : setTimeout(
          () => deadline.abort(new DOMException("Artifact generation timed out.", "TimeoutError")),
          definition.synthesisTimeoutMs,
        );
        const signal = AbortSignal.any([request.signal, deadline.signal]);
        try {
          for await (const event of streamChatCompletion({ messages, signal })) {
            signal.throwIfAborted();
            if (event.type === "usage") {
              attemptUsage = event.usage;
              continue;
            }
            if (event.type !== "delta") continue;
            generated += event.text;
            if (generated.length > MAX_ARTIFACT_LENGTH) {
              failureCode = "artifact_too_long";
              throw new Error(`${definition.title} exceeded its technical limit.`);
            }
          }
          signal.throwIfAborted();
        } finally {
          clearTimeout(timer);
          if (deadline.signal.aborted) failureCode = "generation_timeout";
          // Usage events are totals for one provider call. Keep its last total,
          // and never present a partial aggregate as the whole operation cost.
          if (attemptUsage) generationUsage = accumulateChatTokenUsage(generationUsage, attemptUsage);
          else synthesisUsageComplete = false;
        }

        failureStage = "validation";
        const result = generation.validate(generated);
        if (result.status === "valid") {
          validated = result;
          break;
        }
        validationReason = SAFE_VALIDATION_REASONS.has(result.reason)
          ? result.reason : "unrecognized_validation_reason";
        const repair = attempt === 0 && validationReason !== "unrecognized_validation_reason"
          ? generation.repairMessages?.(validationReason) : null;
        if (!repair) throw new Error("Artifact validation failed.");
        messages = repair;
      }
      if (!validated) throw new Error("Artifact validation failed.");
      failureStage = "persistence";
      const completed = await subject.value.artifacts.complete({
        reservation,
        content: validated.content,
        artifacts,
        citationDiagnostics: validated.citationDiagnostics,
        generationMetadata: {
          model: LUNA,
          promptVersion: definition.promptVersion,
          generatedAt: new Date().toISOString(),
          ...generation.generationMetadata,
        },
      });
      if (completed.status === "conflict") {
        await release();
        return jsonError(
          409,
          `The Source Set changed while the ${definition.title} was being generated. Try again to use the latest evidence.`,
          requestId,
          `${definition.errorPrefix}_SOURCE_SET_CHANGED`,
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

      failureStage = "reload";
      const loaded = await subject.value.artifacts.load(definition.kind);
      if (loaded.status !== "ready") {
        return projectUnavailableResponse(requestId);
      }
      activationOccurredAt =
        loaded.current?.createdAt ?? new Date().toISOString();
      return Response.json(
        { [definition.responseKey]: loaded },
        {
          status: 201,
          headers: { [REQUEST_ID_HEADER]: requestId },
        },
      );
    } catch (error) {
      await release();
      logAppEvent("error", `[${definition.logScope}] generation failed`, {
        errorId: `${definition.errorPrefix}_GENERATION_FAILED`,
        projectId: subject.value.projectId,
        errorName: error instanceof Error ? error.name : typeof error,
        stage: failureStage,
        ...(validationReason ? { reason: validationReason } : {}),
        ...(error instanceof ChatGatewayError
          ? {
              errorCode: error.failureCode,
              ...(error.httpStatus === undefined ? {} : { status: error.httpStatus }),
            }
          : error instanceof ProjectResearchRetrievalError ? {
              errorCode: error.failureCode,
              ...(error.providerHttpStatus === undefined ? {} : { status: error.providerHttpStatus }),
            } : failureCode ? { errorCode: failureCode } : {}),
        requestId,
      });
      return failureStage === "generation" || failureStage === "validation"
        ? jsonError(503, `${definition.title} could not be generated. Please try again.`, requestId, `${definition.errorPrefix}_GENERATION_FAILED`)
        : projectUnavailableResponse(requestId);
    } finally {
      if (generationStartedAt !== null) {
        const durationMs = Math.max(0, Date.now() - generationStartedAt);
        const usage = (!plannerStarted || plannerUsageReceived) &&
          (!synthesisStarted || synthesisUsageComplete) ? generationUsage : undefined;
        scheduleAnalyticsAfterResponse(async () => {
          await recordProjectGenerationUsage({
            projectId: subject.value.projectId,
            ownerId: researcher.principal.userId,
            operationId: reservation.attemptToken,
            generationKind: definition.kind,
            usage,
            durationMs,
            businessAnalyticsSuppressed:
              researcher.principal.businessAnalyticsSuppressed,
            ...(activationOccurredAt
              ? {
                  activation: {
                    trigger: "artifact" as const,
                    occurredAt: activationOccurredAt,
                  },
                }
              : {}),
          });
        });
      }
    }
  }

  return { GET, POST };
}
