export const PROJECT_VIDEO_LIMIT = 5;
export const PROJECT_HISTORY_CANDIDATE_PAGE_SIZE = 10;

export type ProjectVideoStatus = "processing" | "ready" | "failed";

export type ProjectVideo = Readonly<{
  videoId: string;
  youtubeUrl: string;
  youtubeVideoId: string | null;
  title: string | null;
  channelName: string | null;
  position: number;
  status: ProjectVideoStatus;
  failureCode: string | null;
  addedAt: string;
  statusUpdatedAt: string;
}>;

export type ProjectSourceSet = Readonly<{
  projectId: string;
  revision: number;
  videos: readonly ProjectVideo[];
}>;

export type ProjectHistoryCandidate = Readonly<{
  videoId: string;
  youtubeUrl: string;
  youtubeVideoId: string | null;
  title: string | null;
  channelName: string | null;
  viewedAt: string;
}>;

export type ProjectHistoryCandidatePage = Readonly<{
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  search: string;
  candidates: readonly ProjectHistoryCandidate[];
}>;
