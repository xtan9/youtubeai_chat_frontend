import { describe, expect, it } from "vitest";
import {
  buildProjectAnswerArtifacts,
  selectProjectEvidencePassages,
} from "../project-grounded-evidence";
import {
  PROJECT_ID,
  VIDEO_TWO_ID,
  passage,
} from "./project-grounded-test-fixtures";

describe("Project Grounded Answer evidence selection", () => {
  it("lets Goal reorder only passages already returned by bounded retrieval", () => {
    const first = passage({ text: "General project context." });
    const goalMatch = passage({
      videoId: VIDEO_TWO_ID,
      youtubeVideoId: "bbbbbbb0002",
      segmentOrdinal: 2,
      text: "Private roadmap launch evidence.",
      startSeconds: 84,
    });

    const selected = selectProjectEvidencePassages(
      [first, goalMatch],
      "Focus on roadmap launch. Invented goal claim.",
      1,
    );

    expect(selected).toEqual([goalMatch]);
    expect(selected[0]?.text).not.toContain("Invented goal claim");
  });

  it("preserves one query-relevant passage per Video when balanced evidence is requested", () => {
    const dominantSource = Array.from({ length: 8 }, (_, index) =>
      passage({
        segmentOrdinal: index + 1,
        text: `Roadmap launch evidence ${index + 1}.`,
        startSeconds: index * 10,
      }),
    );
    const secondSource = passage({
      videoId: VIDEO_TWO_ID,
      youtubeVideoId: "bbbbbbb0002",
      segmentOrdinal: 1,
      text: "A customer interview challenges launch readiness.",
      startSeconds: 84,
    });

    const selected = selectProjectEvidencePassages(
      [...dominantSource, secondSource],
      "Focus on roadmap launch.",
      8,
      true,
    );

    expect(selected).toHaveLength(8);
    expect(selected.some((candidate) => candidate.videoId === VIDEO_TWO_ID)).toBe(
      true,
    );
  });

  it("builds a bounded, exact manifest/snapshot/coverage trio", () => {
    const passages = Array.from({ length: 10 }, (_, index) =>
      passage({
        segmentOrdinal: index + 1,
        text: `Passage ${index + 1} grounded text.`,
        startSeconds: index * 10,
        endSeconds: index * 10 + 5,
      }),
    );
    const artifacts = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: null,
      search: {
        status: "ready",
        sourceSetRevision: 3,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 25,
        },
        passages,
      },
    });

    expect(artifacts.evidenceSnapshot.passages).toHaveLength(8);
    expect(artifacts.sourceManifest.sources).toHaveLength(1);
    expect(artifacts.sourceManifest.sources[0]?.passages).toHaveLength(8);
    expect(artifacts.sourceCoverage).toMatchObject({
      totalVideos: 1,
      readyVideos: 1,
      usedVideos: 1,
      passagesExamined: 25,
      passagesUsed: 8,
    });
  });

  it("reports exact readiness with no evidence for a not-ready Project", () => {
    const artifacts = buildProjectAnswerArtifacts({
      projectId: PROJECT_ID,
      goal: "This cannot become evidence",
      search: {
        status: "not_ready",
        sourceSetRevision: 7,
        coverage: {
          totalVideos: 2,
          readyVideos: 0,
          passagesExamined: 0,
          unavailableVideos: [
            {
              videoId: VIDEO_TWO_ID,
              youtubeVideoId: "bbbbbbb0002",
              title: "Pending",
              channelName: null,
              status: "processing",
              failureCode: null,
            },
            {
              videoId: "20000000-0000-4000-8000-000000000003",
              youtubeVideoId: null,
              title: null,
              channelName: null,
              status: "unavailable",
              failureCode: "TRANSCRIPT_UNAVAILABLE",
            },
          ],
        },
        passages: [],
      },
    });

    expect(artifacts.sourceManifest.sources).toEqual([]);
    expect(artifacts.evidenceSnapshot.passages).toEqual([]);
    expect(artifacts.sourceCoverage).toMatchObject({
      totalVideos: 2,
      readyVideos: 0,
      usedVideos: 0,
      passagesExamined: 0,
      passagesUsed: 0,
    });
  });
});
