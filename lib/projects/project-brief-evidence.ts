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
  const candidates: ProjectBriefEvidenceCandidate[] = [];
  for (const passage of args.evidenceSnapshot.passages) {
    const sourceId = sourceIdByVideoId.get(passage.videoId);
    if (!sourceId) continue;
    const citation = `[${sourceId} @ ${timestampValue(passage.startSeconds)}]`;
    for (const clause of projectBriefBoundedClauses(passage.text)) {
      candidates.push({
        candidateId: `C${candidates.length + 1}`,
        sourceId,
        citation,
        clause,
      });
    }
  }
  return candidates;
}
