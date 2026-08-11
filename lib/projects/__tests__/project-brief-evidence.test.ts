import { describe, expect, it } from "vitest";

import { buildProjectBriefEvidenceCandidates } from "../project-brief-evidence";
import {
  ProjectAnswerSourceManifestSchema,
  ProjectEvidenceSnapshotSchema,
  type ProjectAnswerSourceManifest,
  type ProjectEvidenceSnapshot,
} from "../project-grounded-answer-contract";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const VIDEO_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
] as const;

function maximumEnvelope() {
  const passages = Array.from({ length: 10 }, (_, index) => {
    const sourceIndex = index % 2;
    const videoId = VIDEO_IDS[sourceIndex];
    const segmentOrdinal = index + 1;
    const text = Array.from(
      { length: 11 },
      (_, clauseIndex) =>
        `Source ${sourceIndex + 1} passage ${index + 1} claim ${clauseIndex + 1}`,
    ).join("; ");
    const excerptEndCharacter = Array.from(text).length;
    const passageId = `${videoId}:${segmentOrdinal}:0:${excerptEndCharacter}`;
    return {
      passageId,
      videoId,
      youtubeVideoId: sourceIndex === 0 ? "aaaaaaa0001" : "bbbbbbb0002",
      title: null,
      channelName: null,
      text,
      segmentOrdinal,
      excerptStartCharacter: 0,
      excerptEndCharacter,
      startSeconds: index * 10,
      endSeconds: index * 10 + 9,
      language: "en",
      truncatedStart: false,
      truncatedEnd: false,
    };
  });
  const sourceManifest: ProjectAnswerSourceManifest = {
    projectId: PROJECT_ID,
    sourceSetRevision: 1,
    sources: VIDEO_IDS.map((videoId, sourceIndex) => ({
      sourceId: `S${sourceIndex + 1}`,
      videoId,
      youtubeVideoId: sourceIndex === 0 ? "aaaaaaa0001" : "bbbbbbb0002",
      title: null,
      channelName: null,
      passages: passages
        .filter((passage) => passage.videoId === videoId)
        .map((passage) => ({
          passageId: passage.passageId,
          startSeconds: passage.startSeconds,
          endSeconds: passage.endSeconds,
        })),
    })),
  };
  const evidenceSnapshot: ProjectEvidenceSnapshot = {
    projectId: PROJECT_ID,
    sourceSetRevision: 1,
    passages,
  };
  return {
    sourceManifest: ProjectAnswerSourceManifestSchema.parse(sourceManifest),
    evidenceSnapshot: ProjectEvidenceSnapshotSchema.parse(evidenceSnapshot),
  };
}

describe("Project Brief evidence candidate envelope", () => {
  it("source-balances and caps the maximum valid envelope before assigning IDs", () => {
    const candidates = buildProjectBriefEvidenceCandidates(maximumEnvelope());

    expect(candidates).toHaveLength(100);
    expect(candidates.map((candidate) => candidate.candidateId)).toEqual(
      Array.from({ length: 100 }, (_, index) => `C${index + 1}`),
    );
    expect(candidates.slice(0, 6).map((candidate) => candidate.sourceId)).toEqual([
      "S1",
      "S2",
      "S1",
      "S2",
      "S1",
      "S2",
    ]);
    expect(candidates.filter((candidate) => candidate.sourceId === "S1")).toHaveLength(50);
    expect(candidates.filter((candidate) => candidate.sourceId === "S2")).toHaveLength(50);
  });

  it("is deterministic for the same governed evidence snapshot", () => {
    const envelope = maximumEnvelope();

    expect(buildProjectBriefEvidenceCandidates(envelope)).toEqual(
      buildProjectBriefEvidenceCandidates(envelope),
    );
  });
});
