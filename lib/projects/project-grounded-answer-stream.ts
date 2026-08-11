import "server-only";

import type { ChatGatewayMessage } from "@/lib/prompts/chat";
import {
  streamChatCompletion,
  type ChatTokenUsage,
} from "@/lib/services/llm-chat-client";
import {
  PROJECT_GROUNDED_ANSWER_MAX_LENGTH,
  type ProjectAnswerArtifacts,
  type ProjectAnswerClassification,
  type ProjectGroundedAnswerCapability,
  type ProjectGroundedSseEvent,
  type ProjectQuestionReservation,
} from "./project-grounded-answer-contract";
import { inspectProjectCitations } from "./project-grounded-citations";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  validateProjectSynthesisResponse,
  type ProjectConversationMode,
} from "./project-grounded-synthesis";
import { consumeProjectAssessmentEvidence } from "./project-assessment-contract";

const MAX_CLASSIFICATION_LINE_LENGTH = 32;
const SAFE_ABSTENTION =
  "The Evidence Snapshot does not support a confident answer to this question.";

type AnswerMode =
  | {
      readonly kind: "provider";
      readonly messages: readonly ChatGatewayMessage[];
      readonly abstentionContent?: string;
    }
  | {
      readonly kind: "unsupported";
      readonly content: string;
    };

export type ProjectGroundedAnswerStreamResult =
  | { readonly outcome: "completed"; readonly generation?: ProjectGenerationAccounting }
  | { readonly outcome: "aborted"; readonly generation?: ProjectGenerationAccounting }
  | {
      readonly outcome: "failed";
      readonly stage: "generation" | "persistence";
      readonly errorClass: string;
      readonly generation?: ProjectGenerationAccounting;
    };

export type ProjectGenerationAccounting = Readonly<{
  usage?: ChatTokenUsage;
  durationMs: number;
}>;

type StreamInput = Readonly<{
  mode: AnswerMode;
  conversationMode?: ProjectConversationMode;
  artifacts: ProjectAnswerArtifacts;
  reservation: ProjectQuestionReservation;
  groundedAnswers: Pick<ProjectGroundedAnswerCapability, "beginPersistence">;
  signal: AbortSignal;
  emit: (event: ProjectGroundedSseEvent) => void;
}>;

function errorClass(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function guidedCitationsAreSufficient(
  mode: ProjectConversationMode,
  validSourceIds: readonly string[],
  manifest: ProjectAnswerArtifacts["sourceManifest"],
) {
  if (
    mode !== "compare_viewpoints" &&
    mode !== "common_themes" &&
    mode !== "project_assessment"
  ) {
    return true;
  }
  const citedSourceIds = new Set(validSourceIds);
  const citedVideoIds = new Set(
    manifest.sources
      .filter((source) => citedSourceIds.has(source.sourceId))
      .map((source) => source.videoId),
  );
  if (citedVideoIds.size < 2) return false;
  return (
    mode !== "project_assessment" ||
    manifest.sources.every((source) => citedSourceIds.has(source.sourceId))
  );
}

async function inspectAndPersist(
  input: StreamInput,
  content: string,
  classification: ProjectAnswerClassification,
): Promise<ProjectGroundedAnswerStreamResult> {
  if (input.signal.aborted) return { outcome: "aborted" };
  const contentLength = Array.from(content).length;
  if (contentLength < 1 || contentLength > PROJECT_GROUNDED_ANSWER_MAX_LENGTH) {
    throw new Error("Grounded answer exceeded its technical limit.");
  }

  const citationInspection = inspectProjectCitations(
    content,
    input.artifacts.sourceManifest,
  );
  const conversationMode =
    input.conversationMode ?? PROJECT_DEFAULT_CONVERSATION_MODE;
  const effectiveClassification =
    classification === "supported" &&
    (citationInspection.validCitationCount === 0 ||
      !citationInspection.allClaimsCited ||
      !guidedCitationsAreSufficient(
        conversationMode,
        citationInspection.validSourceIds,
        input.artifacts.sourceManifest,
      ))
      ? "unsupported"
      : classification;

  if (input.signal.aborted) return { outcome: "aborted" };

  let completion: Awaited<
    ReturnType<typeof input.groundedAnswers.beginPersistence>
  >;
  try {
    completion = await input.groundedAnswers.beginPersistence(
      {
        reservation: input.reservation,
        assistantContent: content,
        classification: effectiveClassification,
        mode: conversationMode,
        artifacts: input.artifacts,
      },
    );
  } catch (error) {
    return {
      outcome: "failed",
      stage: "persistence",
      errorClass: errorClass(error),
    };
  }
  if (
    completion.outcome !== "completed" &&
    completion.outcome !== "already_completed"
  ) {
    return {
      outcome: "failed",
      stage: "persistence",
      errorClass: completion.outcome,
    };
  }

  input.emit({
    type: "answer_start",
    classification: completion.answerClassification,
    ...(conversationMode === PROJECT_DEFAULT_CONVERSATION_MODE
      ? {}
      : { mode: conversationMode }),
  });
  input.emit({ type: "delta", text: content });
  input.emit({
    type: "persistence_started",
    userMessageId: input.reservation.userMessageId,
  });

  input.emit({
    type: "citation_diagnostics",
    diagnostics: completion.citationDiagnostics,
  });
  input.emit({
    type: "done",
    assistantMessageId: completion.assistantMessageId,
  });
  return { outcome: "completed" };
}

/**
 * Owns the hidden model protocol, final visible classification, answer text,
 * citation preflight, and one terminal persistence seam. Model output remains
 * buffered until the hidden control line and all citation claims are known, so
 * no visible classification can drift from the durable terminal record.
 */
export async function executeProjectGroundedAnswerStream(
  input: StreamInput,
): Promise<ProjectGroundedAnswerStreamResult> {
  let generationStartedAt: number | null = null;
  let usage: ChatTokenUsage | undefined;
  const withGeneration = <Result extends ProjectGroundedAnswerStreamResult>(
    result: Result,
  ): Result => {
    if (generationStartedAt === null) return result;
    return {
      ...result,
      generation: {
        ...(usage ? { usage } : {}),
        durationMs: Math.max(0, Date.now() - generationStartedAt),
      },
    };
  };
  try {
    if (input.mode.kind === "unsupported") {
      return await inspectAndPersist(input, input.mode.content, "unsupported");
    }

    let classification: ProjectAnswerClassification | null = null;
    let protocolBuffer = "";
    const assistantChunks: string[] = [];
    let answerCodePoints = 0;
    let pendingHighSurrogate = "";
    const appendAnswer = (text: string) => {
      let completeText = pendingHighSurrogate + text;
      pendingHighSurrogate = "";
      if (completeText.length === 0) return;
      const lastCodeUnit = completeText.charCodeAt(completeText.length - 1);
      if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
        pendingHighSurrogate = completeText.slice(-1);
        completeText = completeText.slice(0, -1);
      }
      if (completeText.length === 0) return;
      answerCodePoints += Array.from(completeText).length;
      if (answerCodePoints > PROJECT_GROUNDED_ANSWER_MAX_LENGTH) {
        throw new Error("Grounded answer exceeded its technical limit.");
      }
      assistantChunks.push(completeText);
    };

    generationStartedAt = Date.now();
    for await (const event of streamChatCompletion({
      messages: input.mode.messages,
      signal: input.signal,
    })) {
      if (input.signal.aborted) return withGeneration({ outcome: "aborted" });
      if (event.type === "usage") {
        usage = event.usage;
        continue;
      }
      if (event.type !== "delta") continue;

      if (classification === null) {
        protocolBuffer += event.text;
        const newlineIndex = protocolBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          if (protocolBuffer.length > MAX_CLASSIFICATION_LINE_LENGTH) {
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
        appendAnswer(protocolBuffer.slice(newlineIndex + 1));
        protocolBuffer = "";
      } else {
        appendAnswer(event.text);
      }
    }

    if (classification === null) throw new Error("Grounded answer was empty.");
    if (pendingHighSurrogate) {
      answerCodePoints += 1;
      if (answerCodePoints > PROJECT_GROUNDED_ANSWER_MAX_LENGTH) {
        throw new Error("Grounded answer exceeded its technical limit.");
      }
      assistantChunks.push(pendingHighSurrogate);
    }
    let assistantBuffer = assistantChunks.join("");
    if (
      /(?:^|\r?\n)(?:SUPPORTED|ABSTAINED)(?:\r?\n|$)/u.test(assistantBuffer)
    ) {
      throw new Error("Grounded answer contained an extra control line.");
    }
    if (classification === "abstained") {
      assistantBuffer = input.mode.abstentionContent ?? SAFE_ABSTENTION;
    } else if (assistantBuffer.trim().length === 0) {
      throw new Error("Grounded answer was empty.");
    } else {
      const conversationMode =
        input.conversationMode ?? PROJECT_DEFAULT_CONVERSATION_MODE;
      if (conversationMode === "project_assessment") {
        const assessment = consumeProjectAssessmentEvidence(
          assistantBuffer,
          input.artifacts,
        );
        if (!assessment.valid) {
          classification = "abstained";
          assistantBuffer = input.mode.abstentionContent ?? SAFE_ABSTENTION;
        } else {
          assistantBuffer = assessment.visibleContent;
        }
      }
      const synthesis = validateProjectSynthesisResponse(
        conversationMode,
        assistantBuffer,
      );
      const inspection = inspectProjectCitations(
        assistantBuffer,
        input.artifacts.sourceManifest,
      );
      if (
        !synthesis.valid ||
        !guidedCitationsAreSufficient(
          conversationMode,
          inspection.validSourceIds,
          input.artifacts.sourceManifest,
        )
      ) {
        classification = "abstained";
        assistantBuffer = input.mode.abstentionContent ?? SAFE_ABSTENTION;
      }
    }

    return withGeneration(
      await inspectAndPersist(input, assistantBuffer, classification),
    );
  } catch (error) {
    if (input.signal.aborted) return withGeneration({ outcome: "aborted" });
    return withGeneration({
      outcome: "failed",
      stage: "generation",
      errorClass: errorClass(error),
    });
  }
}
