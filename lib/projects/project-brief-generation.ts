import "server-only";

import type { ChatGatewayMessage } from "@/lib/prompts/chat";
import type { ChatTokenUsage } from "@/lib/services/llm-chat-client";
import type { ProjectAnswerSourceManifest, ProjectEvidenceSnapshot } from "./project-grounded-answer-contract";
import { buildProjectBriefResearchMessages, projectBriefResearchEvidence, validateProjectBriefResearch } from "./project-brief-research";

const REPAIR_GUIDANCE: Readonly<Record<string, string>> = {
  invalid_structure: "Return exactly the requested JSON object and bounded text/evidence arrays, without Markdown fences or extra fields.",
  untrusted_presentation: "Keep each text field plain prose without citations, source IDs, links, HTML, headings, or newlines; the server adds citations.",
  duplicate_evidence: "Reference each evidenceId at most once within an observation.",
  unknown_evidence: "Use only evidenceId values supplied in IMMUTABLE_CONTEXTUAL_EVIDENCE.",
  altered_quotation: "Copy each quotation exactly as a contiguous excerpt of its referenced passage, preserving negation and qualifications. Do not translate, paraphrase, or repair quotations.",
  comparison_requires_distinct_sources: "Each agreement or disagreement must cite at least two distinct sources on the same issue. Use an empty array when the excerpts do not establish that comparison.",
  missing_source: "Represent every distinct source in at least one supported observation, explicitly limiting its claim when the selected evidence is thin.",
};

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
  const messages = buildProjectBriefResearchMessages({ projectName: args.projectName, goal: args.goal, evidence });
  return {
    generationMetadata: { normalizationAudit: { version: "project-brief-context-v3", recordSetHash } },
    messages,
    repairMessages(reason: string): readonly ChatGatewayMessage[] | null {
      if (!Object.hasOwn(REPAIR_GUIDANCE, reason)) return null;
      return [...messages, { role: "user", content: `Regenerate the complete brief using exactly the same immutable evidence and research rules. The previous attempt failed validation: ${reason}. ${REPAIR_GUIDANCE[reason]} Do not add external facts or invent evidence to satisfy the format. Return only the corrected JSON object.` }];
    },
    validate: (content: string) => validateProjectBriefResearch(content, evidence),
  };
}
