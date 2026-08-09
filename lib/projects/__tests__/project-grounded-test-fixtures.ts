import type {
  ProjectAnswerSourceManifest,
  ProjectConversationMessage,
} from "../project-grounded-answer-contract";
import type { ProjectTranscriptPassage } from "../project-passage-search-contract";

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
export const VIDEO_ONE_ID = "20000000-0000-4000-8000-000000000001";
export const VIDEO_TWO_ID = "20000000-0000-4000-8000-000000000002";

export function passage(overrides: Partial<ProjectTranscriptPassage> = {}) {
  const videoId = overrides.videoId ?? VIDEO_ONE_ID;
  const segmentOrdinal = overrides.segmentOrdinal ?? 1;
  const excerptStartCharacter = overrides.excerptStartCharacter ?? 0;
  const text = overrides.text ?? "The source says the launch happened in April.";
  const excerptEndCharacter =
    overrides.excerptEndCharacter ?? Array.from(text).length;
  return {
    passageId:
      overrides.passageId ??
      `${videoId}:${segmentOrdinal}:${excerptStartCharacter}:${excerptEndCharacter}`,
    videoId,
    youtubeVideoId: overrides.youtubeVideoId ?? "aaaaaaa0001",
    title: overrides.title ?? "Launch notes",
    channelName: overrides.channelName ?? "Research channel",
    text,
    segmentOrdinal,
    excerptStartCharacter,
    excerptEndCharacter,
    startSeconds: overrides.startSeconds ?? 42,
    endSeconds: overrides.endSeconds ?? 58,
    language: overrides.language ?? "en",
    truncatedStart:
      overrides.truncatedStart ?? excerptStartCharacter > 0,
    truncatedEnd: overrides.truncatedEnd ?? false,
  } satisfies ProjectTranscriptPassage;
}

export function manifest(): ProjectAnswerSourceManifest {
  const evidence = passage();
  return {
    projectId: PROJECT_ID,
    sourceSetRevision: 3,
    sources: [
      {
        sourceId: "S1",
        videoId: evidence.videoId,
        youtubeVideoId: evidence.youtubeVideoId,
        title: evidence.title,
        channelName: evidence.channelName,
        passages: [
          {
            passageId: evidence.passageId,
            startSeconds: evidence.startSeconds,
            endSeconds: evidence.endSeconds,
          },
        ],
      },
    ],
  };
}

export function priorAssistant(content: string): ProjectConversationMessage {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    inReplyToMessageId: "30000000-0000-4000-8000-000000000002",
    role: "assistant",
    content,
    createdAt: "2026-08-09T12:00:00.000Z",
    answerClassification: "supported",
    sourceSetRevision: 3,
    sourceManifest: manifest(),
    sourceCoverage: {
      totalVideos: 1,
      readyVideos: 1,
      usedVideos: 1,
      unavailableVideos: [],
      passagesExamined: 1,
      passagesUsed: 1,
    },
    citationDiagnostics: [],
  };
}
