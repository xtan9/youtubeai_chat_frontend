import "server-only";

import type { ChatTokenUsage } from "@/lib/services/llm-chat-client";
import type { ProjectAnswerSourceManifest, ProjectEvidenceSnapshot } from "./project-grounded-answer-contract";
import { buildProjectBriefResearchMessages, projectBriefResearchEvidence, validateProjectBriefResearch } from "./project-brief-research";

/** Historical briefs remain stored Markdown; only new generation uses this contract. */
export async function prepareProjectBriefGeneration(args: {
  readonly projectName: string;
  readonly goal: string | null;
  readonly sourceManifest: ProjectAnswerSourceManifest;
  readonly evidenceSnapshot: ProjectEvidenceSnapshot;
  readonly signal: AbortSignal;
  readonly onUsage: (usage: ChatTokenUsage) => void;
}) {
  const evidence = projectBriefResearchEvidence(args.sourceManifest, args.evidenceSnapshot);
  if (!evidence.length) throw new TypeError("A research brief requires contextual evidence.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence)));
  const recordSetHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    generationMetadata: { normalizationAudit: { version: "project-brief-context-v3", recordSetHash } },
    messages: buildProjectBriefResearchMessages({ projectName: args.projectName, goal: args.goal, evidence }),
    validate: (content: string) => validateProjectBriefResearch(content, evidence),
  };
}
