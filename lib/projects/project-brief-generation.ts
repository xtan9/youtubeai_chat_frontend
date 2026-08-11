import "server-only";

import type { ChatGatewayMessage } from "@/lib/prompts/chat";
import { streamChatCompletion } from "@/lib/services/llm-chat-client";
import {
  buildProjectBriefMessages,
  validateProjectBrief,
} from "./project-brief";
import type {
  ProjectAnswerSourceManifest,
  ProjectEvidenceSnapshot,
} from "./project-grounded-answer-contract";
import {
  buildProjectBriefNormalizationMessages,
  projectBriefNormalizationAudit,
  validateProjectBriefNormalization,
} from "./project-brief-normalization";

const MAX_NORMALIZATION_LENGTH = 100_000;

async function generateNormalization(
  messages: readonly ChatGatewayMessage[],
  signal: AbortSignal,
) {
  let generated = "";
  for await (const event of streamChatCompletion({ messages, signal })) {
    if (event.type !== "delta") continue;
    generated += event.text;
    if (generated.length > MAX_NORMALIZATION_LENGTH) {
      throw new Error("Project Brief normalization exceeded its technical limit.");
    }
  }
  return generated;
}

export async function prepareProjectBriefGeneration(args: {
  readonly projectName: string;
  readonly goal: string | null;
  readonly sourceManifest: ProjectAnswerSourceManifest;
  readonly evidenceSnapshot: ProjectEvidenceSnapshot;
  readonly signal: AbortSignal;
}) {
  const normalizationMessages = buildProjectBriefNormalizationMessages({
    sourceManifest: args.sourceManifest,
    evidenceSnapshot: args.evidenceSnapshot,
  });
  const rawNormalization = await generateNormalization(
    normalizationMessages,
    args.signal,
  );
  const validated = await validateProjectBriefNormalization(
    rawNormalization,
    args.sourceManifest,
    args.evidenceSnapshot,
  );
  if (validated.status !== "valid") {
    throw new Error(
      `Project Brief evidence normalization failed: ${validated.reason}`,
    );
  }

  return {
    generationMetadata: {
      normalizationAudit: projectBriefNormalizationAudit(
        validated.normalization,
      ),
    },
    messages: buildProjectBriefMessages({
      projectName: args.projectName,
      goal: args.goal,
      normalization: validated.normalization,
    }),
    validate: (content: string) =>
      validateProjectBrief(content, validated.normalization),
  };
}
