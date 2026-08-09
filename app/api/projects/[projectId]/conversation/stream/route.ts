import { formatSseEvent } from "@/lib/services/llm-client";
import { streamChatCompletion } from "@/lib/services/llm-chat-client";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { logAppEvent } from "@/lib/observability";
import {
  projectOutcomeResponse,
  projectUnavailableResponse,
} from "@/lib/projects/api-outcomes";
import {
  ProjectGroundedQuestionRequestSchema,
  PROJECT_GROUNDED_RETRIEVAL_LIMIT,
  PROJECT_QUESTION_MESSAGE_ID_HEADER,
  type ProjectAnswerClassification,
  type ProjectGroundedSseEvent,
  type ProjectQuestionReservation,
} from "@/lib/projects/project-grounded-answer-contract";
import { inspectProjectCitations } from "@/lib/projects/project-grounded-citations";
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
const SAFE_ABSTENTION =
  "The Evidence Snapshot does not support a confident answer to this question.";

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

  const started = await subject.value.groundedAnswers.start(
    parsed.data.question,
    parsed.data.conversationId,
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

  const search = await subject.value.passageSearch.search({
    query: parsed.data.question,
    limit: PROJECT_GROUNDED_RETRIEVAL_LIMIT,
  });
  if (search.status === "missing") {
    return projectOutcomeResponse({ kind: "missing" });
  }
  if (search.status === "invalid" || search.status === "unavailable") {
    return projectUnavailableResponse(requestId);
  }

  let artifacts: ReturnType<typeof buildProjectAnswerArtifacts>;
  try {
    artifacts = buildProjectAnswerArtifacts({
      projectId: subject.value.projectId,
      search,
      goal: subject.value.guidance.goal,
    });
  } catch (error) {
    logAppEvent("error", "[project-grounded-answer] artifact assembly failed", {
      errorId: "PROJECT_GROUNDED_ARTIFACT_INVALID",
      projectId: subject.value.projectId,
      errorName: error instanceof Error ? error.name : typeof error,
      requestId,
    });
    return projectUnavailableResponse(requestId);
  }

  const reservation: ProjectQuestionReservation = {
    conversationId: started.conversationId,
    userMessageId: started.userMessageId,
    attemptToken: started.attemptToken,
    messagesUsed: started.messagesUsed,
    messagesLimit: started.messagesLimit,
    tier: started.tier,
    history: started.history,
  };

  let cancellationPromise: Promise<void> | null = null;
  const cancelReservedQuestion = () => {
    cancellationPromise ??= subject.value.groundedAnswers!
      .cancel(reservation.userMessageId)
      .then((result) => {
        if (result.status === "unavailable") {
          logAppEvent("error", "[project-grounded-answer] cancellation failed", {
            errorId: "PROJECT_GROUNDED_CANCELLATION_FAILED",
            projectId: subject.value.projectId,
            requestId,
          });
        }
      });
    return cancellationPromise;
  };

  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ProjectGroundedSseEvent) => {
        if (closed || request.signal.aborted) return;
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
      const persist = async (
        content: string,
        classification: ProjectAnswerClassification,
      ) => {
        if (closed || request.signal.aborted) return false;
        const citationInspection = inspectProjectCitations(
          content,
          artifacts.sourceManifest,
        );
        send({
          type: "citation_diagnostics",
          diagnostics: citationInspection.diagnostics,
        });
        if (
          classification === "supported" &&
          (citationInspection.validCitationCount === 0 ||
            !citationInspection.allClaimsCited)
        ) {
          throw new Error(
            "Every supported Grounded Answer claim needs a valid citation.",
          );
        }
        if (request.signal.aborted) return false;
        const completion = await subject.value.groundedAnswers!.complete({
          reservation,
          assistantContent: content,
          classification,
          artifacts,
          citationDiagnostics: citationInspection.diagnostics,
        });
        if (closed || request.signal.aborted) {
          await cancelReservedQuestion();
          return false;
        }
        if (
          completion.outcome !== "completed" &&
          completion.outcome !== "already_completed"
        ) {
          logAppEvent("error", "[project-grounded-answer] terminal persist failed", {
            errorId: "PROJECT_GROUNDED_PERSIST_FAILED",
            projectId: subject.value.projectId,
            errorClass: completion.outcome,
            requestId,
          });
          send({
            type: "error",
            message:
              "Your question was saved, but the answer could not be saved. Try again.",
          });
          return false;
        }
        send({
          type: "done",
          assistantMessageId: completion.assistantMessageId,
        });
        return true;
      };

      try {
        // These two events are always first, so coverage is visible and stable
        // before any generated assistant text can arrive.
        send({
          type: "source_manifest",
          manifest: artifacts.sourceManifest,
        });
        send({
          type: "source_coverage",
          coverage: artifacts.sourceCoverage,
        });

        if (artifacts.evidenceSnapshot.passages.length === 0) {
          const content =
            search.status === "not_ready"
              ? "This Project has no ready Transcript evidence yet, so I can't answer from its Project Videos."
              : "The available Project passages do not support an answer to this question.";
          send({ type: "answer_start", classification: "unsupported" });
          send({ type: "delta", text: content });
          await persist(content, "unsupported");
          return;
        }

        const messages = buildProjectGroundedMessages({
          projectName: subject.value.name,
          goal: subject.value.guidance.goal,
          question: parsed.data.question,
          history: started.history,
          sourceManifest: artifacts.sourceManifest,
          evidenceSnapshot: artifacts.evidenceSnapshot,
        });
        let classification: ProjectAnswerClassification | null = null;
        let protocolBuffer = "";
        let assistantBuffer = "";

        for await (const event of streamChatCompletion({
          messages,
          signal: request.signal,
        })) {
          if (closed || request.signal.aborted) return;
          if (event.type !== "delta") continue;
          if (classification === null) {
            protocolBuffer += event.text;
            const newlineIndex = protocolBuffer.indexOf("\n");
            if (newlineIndex < 0) {
              if (protocolBuffer.length > 32) {
                throw new Error("Grounded answer classification line is invalid.");
              }
              continue;
            }
            const controlLine = protocolBuffer
              .slice(0, newlineIndex)
              .replace(/\r$/, "");
            if (controlLine === "SUPPORTED") classification = "supported";
            else if (controlLine === "ABSTAINED") classification = "abstained";
            else throw new Error("Grounded answer classification line is invalid.");

            send({ type: "answer_start", classification });
            const visibleRemainder = protocolBuffer.slice(newlineIndex + 1);
            protocolBuffer = "";
            if (visibleRemainder.length > 0) {
              assistantBuffer += visibleRemainder;
              if (classification === "supported") {
                send({ type: "delta", text: visibleRemainder });
              }
            }
            continue;
          }
          assistantBuffer += event.text;
          if (assistantBuffer.length > 20_000) {
            throw new Error("Grounded answer exceeded its technical limit.");
          }
          if (classification === "supported") {
            send({ type: "delta", text: event.text });
          }
        }

        if (classification === null) {
          throw new Error("Grounded answer was empty.");
        }
        if (
          /(?:^|\r?\n)(?:SUPPORTED|ABSTAINED)(?:\r?\n|$)/u.test(
            assistantBuffer,
          )
        ) {
          throw new Error("Grounded answer contained an extra control line.");
        }
        if (classification === "abstained") {
          assistantBuffer = SAFE_ABSTENTION;
          send({ type: "delta", text: assistantBuffer });
        } else if (assistantBuffer.trim().length === 0) {
          throw new Error("Grounded answer was empty.");
        }
        await persist(assistantBuffer, classification);
      } catch (error) {
        if (!request.signal.aborted) {
          logAppEvent("error", "[project-grounded-answer] generation failed", {
            errorId: "PROJECT_GROUNDED_GENERATION_FAILED",
            projectId: subject.value.projectId,
            errorName: error instanceof Error ? error.name : typeof error,
            requestId,
          });
          send({ type: "error", message: GENERIC_ERROR });
        }
      } finally {
        if (request.signal.aborted) {
          await cancelReservedQuestion();
        }
        finish();
      }
    },
    async cancel() {
      closed = true;
      await cancelReservedQuestion();
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
