import type {
  ProjectAnswerSourceManifest,
  ProjectEvidenceSnapshot,
} from "./project-grounded-answer-contract";

export function timestampValue(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function buildProjectPromptEvidence(
  sourceManifest: ProjectAnswerSourceManifest,
  evidenceSnapshot: ProjectEvidenceSnapshot,
) {
  const sourceByVideo = new Map(
    sourceManifest.sources.map((source) => [source.videoId, source]),
  );
  return evidenceSnapshot.passages.map((passage) => {
    const source = sourceByVideo.get(passage.videoId);
    if (!source) throw new TypeError("Evidence Snapshot source is missing.");
    return {
      sourceId: source.sourceId,
      timestamp: timestampValue(passage.startSeconds),
      endTimestamp:
        passage.endSeconds === null
          ? null
          : timestampValue(passage.endSeconds),
      truncatedStart: passage.truncatedStart,
      truncatedEnd: passage.truncatedEnd,
      passageId: passage.passageId,
      text: passage.text,
    };
  });
}
