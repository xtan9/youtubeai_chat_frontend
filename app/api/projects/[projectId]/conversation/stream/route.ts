import { scheduleAnalyticsAfterResponse } from "@/lib/analytics/after";
import { captureProjectActivityEvent } from "@/lib/analytics/server";
import {
  recordProjectAnalyticsTransition,
  recordProjectGenerationUsage,
} from "@/lib/analytics/project-server";
import { formatSseEvent } from "@/lib/services/llm-client";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { logAppEvent } from "@/lib/observability";
import {
  projectOutcomeResponse,
  projectUnavailableResponse,
} from "@/lib/projects/api-outcomes";
import {
  ProjectGroundedQuestionRequestSchema,
  PROJECT_DEFAULT_CONVERSATION_MODE,
  PROJECT_GROUNDED_RETRIEVAL_LIMIT,
  PROJECT_QUESTION_MESSAGE_ID_HEADER,
  type ProjectGroundedSseEvent,
  type ProjectQuestionReservation,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  buildProjectSynthesisAbstention,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";
import { executeProjectGroundedAnswerStream } from "@/lib/projects/project-grounded-answer-stream";
import { buildProjectAnswerArtifacts } from "@/lib/projects/project-grounded-evidence";
import { buildProjectGroundedMessages } from "@/lib/projects/project-grounded-prompt";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ projectId: string }> };

const GENERIC_ERROR =
  "Something went wrong answering your Project question. Please try again.";

type GuidedAbstentionReason = Parameters<
  typeof buildProjectSynthesisAbstention
>[1];

function guidedAbstentionReason(
  mode: ProjectConversationMode,
  noReadyEvidence: boolean,
): GuidedAbstentionReason {
  if (noReadyEvidence) return "no_ready_evidence";
  if (mode === "question") {
    throw new Error("Ordinary questions use the default abstention path.");
  }
  switch (mode) {
    case "common_themes":
      return "no_repeated_theme";
    case "compare_viewpoints":
      return "insufficient_comparison";
    case "find_gaps":
      return "no_supported_gaps";
    case "project_assessment":
      return "insufficient_assessment";
  }
}

function requiresMultipleEvidenceVideos(mode: ProjectConversationMode) {
  return (
    mode === "compare_viewpoints" ||
    mode === "common_themes" ||
    mode === "project_assessment"
  );
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

function quotaResponse(requestId: string) {
  return Response.json(
    {
      message:
        "You've used your 5 free chat messages in this Project. Upgrade for unlimited.",
      errorCode: "free_chat_exceeded",
      tier: "free",
      upgradeUrl: "/pricing",
    },
    {
      status: 402,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "X-Error-ID": "PROJECT_CHAT_QUOTA_EXCEEDED",
      },
    },
  );
}

function boundedDelay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = ProjectGroundedQuestionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      parsed.error.issues[0]?.message ?? "Question is not valid.",
      requestId,
      "PROJECT_QUESTION_INVALID",
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
    return jsonError(
      400,
      subject.message,
      requestId,
      "PROJECT_ID_INVALID",
    );
  }
  if (subject.kind === "unavailable") {
    return projectUnavailableResponse(requestId);
  }
  if (subject.kind !== "resolved") return projectOutcomeResponse(subject);
  if (!subject.value.groundedAnswers || !subject.value.passageSearch) {
    return projectUnavailableResponse(requestId);
  }
  const groundedAnswers = subject.value.groundedAnswers;
  const passageSearch = subject.value.passageSearch;

  // Auth and owner resolution precede the existing global abuse gate. The
  // durable question reservation happens only after every preflight passes.
  const rateLimit = await checkRateLimit(researcher.principal.userId, false);
  if (!rateLimit.allowed) {
    return jsonError(
      429,
      "Rate limit exceeded. Please try again later.",
      requestId,
      "RATE_LIMITED",
    );
  }

  const mode: ProjectConversationMode =
    parsed.data.mode ?? PROJECT_DEFAULT_CONVERSATION_MODE;
  const started = await groundedAnswers.start(
    parsed.data.questionId,
    parsed.data.question,
    parsed.data.conversationId,
    mode,
  );
  switch (started.status) {
    case "limit_reached":
      return quotaResponse(requestId);
    case "invalid":
      return jsonError(
        400,
        "Question is not valid.",
        requestId,
        "PROJECT_QUESTION_INVALID",
      );
    case "missing":
      return projectOutcomeResponse({ kind: "missing" });
    case "unavailable":
      return projectUnavailableResponse(requestId);
    case "started":
      break;
  }

  if (!started.created) {
    return Response.json(
      {
        message: "This Project question is already reserved.",
        errorCode: "project_question_exists",
        completionState: started.completionState,
        questionId: started.userMessageId,
      },
      {
        status: 409,
        headers: {
          [PROJECT_QUESTION_MESSAGE_ID_HEADER]: started.userMessageId,
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  }

  const reservation: ProjectQuestionReservation = {
    conversationId: started.conversationId,
    userMessageId: started.userMessageId,
    attemptToken: started.attemptToken,
    messageOrdinal: started.messageOrdinal,
    messagesUsed: started.messagesUsed,
    messagesLimit: started.messagesLimit,
    tier: started.tier,
    history: started.history,
    mode: started.mode ?? mode,
  };

  const messageOrdinal = reservation.messageOrdinal;
  const messageOccurredAt = new Date().toISOString();
  scheduleAnalyticsAfterResponse(async () => {
    const transition = recordProjectAnalyticsTransition({
      projectId: subject.value.projectId,
      ownerId: researcher.principal.userId,
      trigger: "message",
      occurredAt: messageOccurredAt,
      businessAnalyticsSuppressed:
        researcher.principal.businessAnalyticsSuppressed,
    });
    if (!messageOrdinal) {
      await transition;
      return;
    }
    await Promise.all([
      transition,
      captureProjectActivityEvent(
        researcher.principal.userId,
        "project_message_sent",
        {
          project_id: subject.value.projectId,
          message_ordinal: messageOrdinal,
          message_kind: messageOrdinal === 1 ? "first" : "subsequent",
          tier: reservation.tier,
          mode: reservation.mode ?? mode,
        },
        researcher.principal.businessAnalyticsSuppressed,
        `project-message:${subject.value.projectId}:${reservation.userMessageId}`,
      ),
    ]);
  });

  let cancellationPromise: ReturnType<typeof cancelWithRetry> | null = null;
  async function cancelWithRetry() {
    let result: Awaited<ReturnType<typeof groundedAnswers.cancel>> = {
      status: "unavailable",
    };
    for (const waitMilliseconds of [0, 25, 100] as const) {
      if (waitMilliseconds > 0) await boundedDelay(waitMilliseconds);
      try {
        result = await groundedAnswers.cancel(reservation);
      } catch {
        result = { status: "unavailable" };
      }
      if (result.status === "cancelled" || result.status === "completed") {
        return result;
      }
    }
    return result;
  }
  const cancelReservedQuestion = () => {
    cancellationPromise ??= cancelWithRetry()
      .then((result) => {
        if (result.status === "unavailable" || result.status === "stale") {
          logAppEvent("error", "[project-grounded-answer] cancellation failed", {
            errorId: "PROJECT_GROUNDED_CANCELLATION_FAILED",
            projectId: subject.value.projectId,
            requestId,
          });
        }
        return result;
      });
    return cancellationPromise;
  };

  let closed = false;
  let persistenceStarted = false;
  const generationController = new AbortController();
  const abortGeneration = () => generationController.abort();
  if (request.signal.aborted) abortGeneration();
  else request.signal.addEventListener("abort", abortGeneration, { once: true });
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ProjectGroundedSseEvent) => {
        if (event.type === "persistence_started") persistenceStarted = true;
        if (closed || generationController.signal.aborted) return;
        controller.enqueue(encoder.encode(formatSseEvent(event)));
      };
      const finish = () => {
        closed = true;
        try {
          controller.close();
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
        }
      };
      try {
        // The reservation identity is observable before retrieval or model work
        // begins, so cancellation and reconciliation always target this turn.
        send({
          type: "question_reserved",
          userMessageId: reservation.userMessageId,
        });

        const search = await passageSearch.search({
          query: parsed.data.question,
          limit: PROJECT_GROUNDED_RETRIEVAL_LIMIT,
          balanceSources: mode === "project_assessment",
        });
        if (
          search.status === "missing" ||
          search.status === "invalid" ||
          search.status === "unavailable"
        ) {
          throw new Error("Project passage retrieval was unavailable.");
        }

        const artifacts = buildProjectAnswerArtifacts({
          projectId: subject.value.projectId,
          search,
          goal: started.goal,
        });
        // These two events are always first, so coverage is visible and stable
        // before any generated assistant text can arrive. The reservation event
        // precedes them because it must precede retrieval itself.
        send({
          type: "source_manifest",
          manifest: artifacts.sourceManifest,
        });
        send({
          type: "source_coverage",
          coverage: artifacts.sourceCoverage,
        });

        const evidenceVideoCount = new Set(
          artifacts.evidenceSnapshot.passages.map((passage) => passage.videoId),
        ).size;
        const guidedEvidenceIsInsufficient =
          requiresMultipleEvidenceVideos(mode) && evidenceVideoCount < 2;
        const answerMode =
          artifacts.evidenceSnapshot.passages.length === 0 ||
          guidedEvidenceIsInsufficient
          ? {
              kind: "unsupported" as const,
              content:
                mode === PROJECT_DEFAULT_CONVERSATION_MODE
                  ? search.status === "not_ready"
                    ? "This Project has no ready Transcript evidence yet, so I can't answer from its Project Videos."
                    : "The available Project passages do not support an answer to this question."
                   : buildProjectSynthesisAbstention(
                       mode,
                       guidedAbstentionReason(
                         mode,
                         search.status === "not_ready",
                       ),
                    ),
            }
          : {
              kind: "provider" as const,
              messages: buildProjectGroundedMessages({
                projectName: subject.value.name,
                goal: started.goal,
                question: parsed.data.question,
                history: started.history,
                 sourceManifest: artifacts.sourceManifest,
                 evidenceSnapshot: artifacts.evidenceSnapshot,
                 mode,
               }),
               abstentionContent:
                 mode === PROJECT_DEFAULT_CONVERSATION_MODE
                   ? undefined
                    : buildProjectSynthesisAbstention(
                        mode,
                        guidedAbstentionReason(mode, false),
                     ),
             };
        const result = await executeProjectGroundedAnswerStream({
           mode: answerMode,
           conversationMode: mode,
          artifacts,
          reservation,
          groundedAnswers,
          signal: generationController.signal,
          emit: send,
        });
        if (result.generation) {
          scheduleAnalyticsAfterResponse(() =>
            recordProjectGenerationUsage({
              projectId: subject.value.projectId,
              ownerId: researcher.principal.userId,
              operationId: reservation.attemptToken,
              generationKind: "grounded_answer",
              usage: result.generation?.usage,
              durationMs: result.generation?.durationMs ?? 0,
              businessAnalyticsSuppressed:
                researcher.principal.businessAnalyticsSuppressed,
            }),
          );
        }
        if (result.outcome === "failed") {
          await cancelReservedQuestion();
          logAppEvent("error", "[project-grounded-answer] stream transaction failed", {
            errorId:
              result.stage === "persistence"
                ? "PROJECT_GROUNDED_PERSIST_FAILED"
                : "PROJECT_GROUNDED_GENERATION_FAILED",
            projectId: subject.value.projectId,
            errorClass: result.errorClass,
            requestId,
          });
          send({
            type: "error",
            message:
              result.stage === "persistence"
                ? "Your question was saved, but the answer could not be saved. Try again."
                : GENERIC_ERROR,
          });
        }
      } catch (error) {
        if (!generationController.signal.aborted) {
          await cancelReservedQuestion();
          logAppEvent("error", "[project-grounded-answer] generation failed", {
            errorId: "PROJECT_GROUNDED_GENERATION_FAILED",
            projectId: subject.value.projectId,
            errorName: error instanceof Error ? error.name : typeof error,
            requestId,
          });
          send({ type: "error", message: GENERIC_ERROR });
        }
      } finally {
        if (generationController.signal.aborted && !persistenceStarted) {
          await cancelReservedQuestion();
        }
        request.signal.removeEventListener("abort", abortGeneration);
        finish();
      }
    },
    async cancel() {
      closed = true;
      abortGeneration();
      if (!persistenceStarted) await cancelReservedQuestion();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      [PROJECT_QUESTION_MESSAGE_ID_HEADER]: reservation.userMessageId,
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
