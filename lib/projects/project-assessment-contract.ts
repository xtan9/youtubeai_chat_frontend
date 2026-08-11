import { z } from "zod";

import type { ProjectAnswerArtifacts } from "./project-grounded-answer-contract";
import { findCanonicalProjectCitationTokens } from "./project-grounded-citations";

export const PROJECT_ASSESSMENT_EVIDENCE_PREFIX = "ASSESSMENT_EVIDENCE ";

const PositionIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u);
const IssueKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u);
const SourceIdSchema = z.string().regex(/^S\d{1,2}$/u);
const CitationSchema = z
  .string()
  .regex(/^\[S\d{1,2} @ (?:\d{2}:)?\d{2}:\d{2}\]$/u);
const RelationSchema = z.enum(["supports", "opposes"]);

const EvidencePositionSchema = z
  .object({
    positionId: PositionIdSchema,
    sourceId: SourceIdSchema,
    issueKey: IssueKeySchema,
    relation: RelationSchema,
    citation: CitationSchema,
    exactQuote: z.string().min(1).max(2_400),
    supportWeight: z.number().int().min(1).max(5),
  })
  .strict();

const CandidateSchema = z
  .object({
    kind: z.literal("assessment"),
    positions: z
      .array(
        z
          .object({
            positionId: PositionIdSchema,
            relation: RelationSchema,
            citation: CitationSchema,
          })
          .strict(),
      )
      .min(2)
      .max(10),
    winnerPositionId: PositionIdSchema,
  })
  .strict();

const AssessmentEvidenceSchema = z
  .object({
    evidence: z.array(EvidencePositionSchema).min(2).max(10),
    candidate: CandidateSchema,
  })
  .strict();

type AssessmentEvidence = z.infer<typeof AssessmentEvidenceSchema>;

export type ProjectAssessmentContractResult =
  | { readonly valid: true; readonly visibleContent: string }
  | { readonly valid: false };

/**
 * Consume the model's hidden, relation-aware Assessment record and bind every
 * position back to one immutable Evidence Snapshot passage. The record is
 * never emitted or persisted; only the validated visible Assessment survives.
 */
export function consumeProjectAssessmentEvidence(
  content: string,
  artifacts: ProjectAnswerArtifacts,
): ProjectAssessmentContractResult {
  const newlineIndex = content.indexOf("\n");
  if (newlineIndex < 0) return { valid: false };
  const controlLine = content.slice(0, newlineIndex).replace(/\r$/u, "");
  if (!controlLine.startsWith(PROJECT_ASSESSMENT_EVIDENCE_PREFIX)) {
    return { valid: false };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(controlLine.slice(PROJECT_ASSESSMENT_EVIDENCE_PREFIX.length));
  } catch {
    return { valid: false };
  }
  const parsed = AssessmentEvidenceSchema.safeParse(raw);
  if (!parsed.success || !evidenceMatchesSnapshot(parsed.data, artifacts)) {
    return { valid: false };
  }
  if (!evaluateProjectAssessmentEvidence(parsed.data)) return { valid: false };

  const visibleContent = content.slice(newlineIndex + 1);
  return visibleContent.trim().length > 0
    ? { valid: true, visibleContent }
    : { valid: false };
}

function evidenceMatchesSnapshot(
  value: AssessmentEvidence,
  artifacts: ProjectAnswerArtifacts,
) {
  const positionIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (const position of value.evidence) {
    if (positionIds.has(position.positionId) || sourceIds.has(position.sourceId)) {
      return false;
    }
    positionIds.add(position.positionId);
    sourceIds.add(position.sourceId);

    const [citation] = findCanonicalProjectCitationTokens(position.citation);
    if (!citation || citation.raw !== position.citation || citation.endTimestamp) {
      return false;
    }
    const source = artifacts.sourceManifest.sources.find(
      (candidate) => candidate.sourceId === position.sourceId,
    );
    const manifestPassage = source?.passages.find(
      (passage) =>
        Math.floor(passage.startSeconds) === timestampSeconds(citation.timestamp),
    );
    const snapshotPassage = manifestPassage
      ? artifacts.evidenceSnapshot.passages.find(
          (passage) => passage.passageId === manifestPassage.passageId,
        )
      : undefined;
    if (
      citation.sourceId !== position.sourceId ||
      !snapshotPassage ||
      snapshotPassage.text !== position.exactQuote
    ) {
      return false;
    }
  }

  return artifacts.sourceManifest.sources.every((source) =>
    sourceIds.has(source.sourceId),
  );
}

function evaluateProjectAssessmentEvidence(value: AssessmentEvidence) {
  const issueKeys = new Set(value.evidence.map(({ issueKey }) => issueKey));
  const relations = new Set(value.evidence.map(({ relation }) => relation));
  if (issueKeys.size !== 1 || relations.size !== 2) return false;

  const strongestWeight = Math.max(
    ...value.evidence.map(({ supportWeight }) => supportWeight),
  );
  const strongest = value.evidence.filter(
    ({ supportWeight }) => supportWeight === strongestWeight,
  );
  // Equal strongest support is exactly the unresolved state. A supported
  // provider response must not choose a winner in that case.
  if (strongest.length !== 1) return false;

  const candidateById = new Map(
    value.candidate.positions.map((position) => [position.positionId, position]),
  );
  if (
    candidateById.size !== value.evidence.length ||
    value.candidate.positions.length !== value.evidence.length
  ) {
    return false;
  }
  for (const evidence of value.evidence) {
    const candidate = candidateById.get(evidence.positionId);
    if (
      !candidate ||
      candidate.relation !== evidence.relation ||
      candidate.citation !== evidence.citation
    ) {
      return false;
    }
  }
  return value.candidate.winnerPositionId === strongest[0]?.positionId;
}

function timestampSeconds(value: string) {
  const components = value.split(":").map(Number);
  return components.length === 2
    ? components[0]! * 60 + components[1]!
    : components[0]! * 3_600 + components[1]! * 60 + components[2]!;
}
