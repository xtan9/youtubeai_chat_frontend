import type {
  ProjectAnswerSourceManifest,
  ProjectEvidenceSnapshot,
} from "./project-grounded-answer-contract";

export type ProjectBriefEvidenceCandidate = Readonly<{
  candidateId: string;
  sourceId: string;
  citation: string;
  clause: string;
}>;

export const PROJECT_BRIEF_EVIDENCE_CANDIDATE_LIMIT = 100;

function timestampValue(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function projectBriefWords(value: string) {
  return (
    value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function projectBriefBoundedClauses(value: string) {
  return value
    .split(
      /(?:[.!?;:\u3002\uff01\uff1f\uff1b]+|\b(?:although|and|because|but|however|so|though|whereas|while|yet|aunque|pero|sin embargo|y)\b)/giu,
    )
    .map((clause) => clause.trim())
    .filter((clause) => projectBriefWords(clause).length >= 2);
}

export function buildProjectBriefEvidenceCandidates(args: {
  readonly sourceManifest: ProjectAnswerSourceManifest;
  readonly evidenceSnapshot: ProjectEvidenceSnapshot;
}) {
  const sourceIdByVideoId = new Map(
    args.sourceManifest.sources.map((source) => [source.videoId, source.sourceId]),
  );
  const clausesBySource = new Map<
    string,
    Array<Omit<ProjectBriefEvidenceCandidate, "candidateId">>
  >(args.sourceManifest.sources.map((source) => [source.sourceId, []]));
  const uncapped: Array<Omit<ProjectBriefEvidenceCandidate, "candidateId">> = [];
  for (const passage of args.evidenceSnapshot.passages) {
    const sourceId = sourceIdByVideoId.get(passage.videoId);
    if (!sourceId) continue;
    const citation = `[${sourceId} @ ${timestampValue(passage.startSeconds)}]`;
    for (const clause of projectBriefBoundedClauses(passage.text)) {
      const candidate = {
        sourceId,
        citation,
        clause,
      };
      clausesBySource.get(sourceId)?.push(candidate);
      uncapped.push(candidate);
    }
  }
  const balanced: Array<Omit<ProjectBriefEvidenceCandidate, "candidateId">> = [];
  for (let sourceOffset = 0; ; sourceOffset += 1) {
    let added = false;
    for (const source of args.sourceManifest.sources) {
      const candidate = clausesBySource.get(source.sourceId)?.[sourceOffset];
      if (!candidate) continue;
      balanced.push(candidate);
      added = true;
      if (balanced.length === PROJECT_BRIEF_EVIDENCE_CANDIDATE_LIMIT) break;
    }
    if (!added || balanced.length === PROJECT_BRIEF_EVIDENCE_CANDIDATE_LIMIT) {
      break;
    }
  }

  const selected =
    uncapped.length <= PROJECT_BRIEF_EVIDENCE_CANDIDATE_LIMIT
      ? uncapped
      : balanced;
  return selected.map((candidate, index) => ({
    candidateId: `C${index + 1}`,
    ...candidate,
  }));
}
