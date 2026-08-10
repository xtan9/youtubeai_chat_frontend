import {
  ProjectAnswerArtifactsSchema,
  PROJECT_GROUNDED_PASSAGE_LIMIT,
} from "./project-grounded-answer-contract";
import type {
  ProjectPassageSearchResolution,
  ProjectTranscriptPassage,
} from "./project-passage-search-contract";
import type { z } from "zod";

type AnswerArtifacts = z.infer<typeof ProjectAnswerArtifactsSchema>;

const WORD_PATTERN = /[\p{L}\p{N}_-]+/gu;

function relevanceTerms(value: string | null): ReadonlySet<string> {
  if (!value) return new Set();
  const terms = value
    .normalize("NFC")
    .toLocaleLowerCase()
    .match(WORD_PATTERN);
  return new Set((terms ?? []).filter((term) => Array.from(term).length > 1));
}

/**
 * Goal can guide which already-retrieved passages enter the prompt, but can
 * never create passage text or identity. Stable source-search order breaks
 * ties, so a missing or unrelated Goal is a no-op.
 */
export function selectProjectEvidencePassages(
  passages: readonly ProjectTranscriptPassage[],
  goal: string | null,
  limit = PROJECT_GROUNDED_PASSAGE_LIMIT,
  balanceSources = false,
): readonly ProjectTranscriptPassage[] {
  const goalTerms = relevanceTerms(goal);
  const ranked = passages
    .map((passage, originalIndex) => {
      const passageTerms = relevanceTerms(passage.text);
      let goalOverlap = 0;
      for (const term of goalTerms) {
        if (passageTerms.has(term)) goalOverlap += 1;
      }
      return { passage, originalIndex, goalOverlap };
    })
    .toSorted(
      (left, right) =>
        right.goalOverlap - left.goalOverlap ||
        left.originalIndex - right.originalIndex,
    );
  if (!balanceSources) {
    return ranked.slice(0, limit).map(({ passage }) => passage);
  }

  const bestByVideo = new Map<string, (typeof ranked)[number]>();
  for (const candidate of ranked) {
    if (!bestByVideo.has(candidate.passage.videoId)) {
      bestByVideo.set(candidate.passage.videoId, candidate);
    }
  }
  const selected = [...bestByVideo.values()].slice(0, limit);
  const selectedPassageIds = new Set(
    selected.map(({ passage }) => passage.passageId),
  );
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedPassageIds.has(candidate.passage.passageId)) continue;
    selected.push(candidate);
    selectedPassageIds.add(candidate.passage.passageId);
  }
  return selected.map(({ passage }) => passage);
}

type SearchWithCoverage = Extract<
  ProjectPassageSearchResolution,
  { status: "ready" | "no_results" | "not_ready" }
>;

export function buildProjectAnswerArtifacts(args: {
  readonly projectId: string;
  readonly search: SearchWithCoverage;
  readonly goal: string | null;
  readonly balanceSources?: boolean;
}): AnswerArtifacts {
  const selected =
    args.search.status === "ready"
      ? selectProjectEvidencePassages(
          args.search.passages,
          args.goal,
          PROJECT_GROUNDED_PASSAGE_LIMIT,
          args.balanceSources,
        )
      : [];
  const sourcesByVideo = new Map<
    string,
    {
      sourceId: string;
      videoId: string;
      youtubeVideoId: string;
      title: string | null;
      channelName: string | null;
      passages: Array<{
        passageId: string;
        startSeconds: number;
        endSeconds: number | null;
      }>;
    }
  >();

  for (const passage of selected) {
    let source = sourcesByVideo.get(passage.videoId);
    if (!source) {
      source = {
        sourceId: `S${sourcesByVideo.size + 1}`,
        videoId: passage.videoId,
        youtubeVideoId: passage.youtubeVideoId,
        title: passage.title,
        channelName: passage.channelName,
        passages: [],
      };
      sourcesByVideo.set(passage.videoId, source);
    }
    source.passages.push({
      passageId: passage.passageId,
      startSeconds: passage.startSeconds,
      endSeconds: passage.endSeconds,
    });
  }

  const artifacts = {
    sourceManifest: {
      projectId: args.projectId,
      sourceSetRevision: args.search.sourceSetRevision,
      sources: [...sourcesByVideo.values()],
    },
    sourceCoverage: {
      ...args.search.coverage,
      usedVideos: sourcesByVideo.size,
      passagesUsed: selected.length,
    },
    evidenceSnapshot: {
      projectId: args.projectId,
      sourceSetRevision: args.search.sourceSetRevision,
      passages: selected,
    },
  };

  return ProjectAnswerArtifactsSchema.parse(artifacts);
}
