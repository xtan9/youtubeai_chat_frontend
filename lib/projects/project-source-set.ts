import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractVideoId } from "@/lib/services/youtube-url";
import {
  PROJECT_HISTORY_CANDIDATE_PAGE_SIZE,
  PROJECT_VIDEO_LIMIT,
  type ProjectHistoryCandidate,
  type ProjectHistoryCandidatePage,
  type ProjectSourceSet,
  type ProjectVideo,
  type ProjectVideoStatus,
} from "./project-source-set-contract";
import type { ProjectOutcome, ProjectSubject } from "./project-subject";

export { PROJECT_HISTORY_CANDIDATE_PAGE_SIZE, PROJECT_VIDEO_LIMIT };
export type {
  ProjectHistoryCandidate,
  ProjectHistoryCandidatePage,
  ProjectSourceSet,
  ProjectVideo,
  ProjectVideoStatus,
};

export type SourceSetMutationKind =
  | "added"
  | "removed"
  | "reordered"
  | "unchanged"
  | "duplicate"
  | "limit_reached"
  | "conflict"
  | "not_in_history"
  | "not_ready"
  | "membership_missing"
  | "invalid_order"
  | "missing"
  | "forbidden"
  | "unavailable";

export type SourceSetMutationOutcome = Readonly<{
  kind: SourceSetMutationKind;
  sourceSet?: ProjectSourceSet;
}>;

type ProjectVideoRow = {
  video_id: string;
  position: number;
  status: ProjectVideoStatus;
  failure_code: string | null;
  added_at: string;
  status_updated_at: string;
  videos: {
    id: string;
    youtube_url: string;
    title: string | null;
    channel_name: string | null;
  } | null;
};
type SourceSetRow = {
  revision: number;
  project_videos: ProjectVideoRow[] | null;
};

type RpcResult = {
  outcome?: unknown;
  revision?: unknown;
};

type CandidateRpcResult = {
  outcome?: unknown;
  page?: unknown;
  pageSize?: unknown;
  total?: unknown;
  totalPages?: unknown;
  candidates?: unknown;
};

type CandidateRpcRow = {
  videoId: string;
  youtubeUrl: string;
  title: string | null;
  channelName: string | null;
  viewedAt: string;
};

const PROJECT_SOURCE_SET_SELECT =
  "revision,project_videos(video_id,position,status,failure_code,added_at,status_updated_at,videos!inner(id,youtube_url,title,channel_name))";

function logFailure(operation: string, subject: ProjectSubject, error: unknown) {
  const safeError = error as { code?: string; message?: string } | null;
  console.error(`[project-source-set] ${operation} failed`, {
    projectId: subject.projectId,
    ownerId: subject.ownerId,
    code: safeError?.code,
    message: safeError?.message,
  });
}

function mapVideo(row: ProjectVideoRow): ProjectVideo | null {
  if (!row.videos) return null;
  return {
    videoId: row.video_id,
    youtubeUrl: row.videos.youtube_url,
    youtubeVideoId: extractVideoId(row.videos.youtube_url),
    title: row.videos.title,
    channelName: row.videos.channel_name,
    position: row.position,
    status: row.status,
    failureCode: row.failure_code,
    addedAt: row.added_at,
    statusUpdatedAt: row.status_updated_at,
  };
}

export async function loadProjectSourceSet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
): Promise<ProjectOutcome<ProjectSourceSet>> {
  try {
    // Keep revision and membership in one PostgREST statement so a refresh
    // cannot combine snapshots from opposite sides of a concurrent mutation.
    const sourceSetResult = await supabase
      .from("project_source_sets")
      .select(PROJECT_SOURCE_SET_SELECT)
      .eq("project_id", subject.projectId)
      .maybeSingle();

    if (sourceSetResult.error) {
      logFailure("load", subject, sourceSetResult.error);
      return sourceSetResult.error.code === "42501"
        ? { kind: "forbidden" }
        : { kind: "unavailable" };
    }

    const sourceSet = sourceSetResult.data as unknown as SourceSetRow | null;
    const videos = (sourceSet?.project_videos ?? [])
      .map(mapVideo)
      .filter((video): video is ProjectVideo => video !== null)
      .sort((left, right) => left.position - right.position);

    return {
      kind: "resolved",
      value: {
        projectId: subject.projectId,
        revision: sourceSet?.revision ?? 0,
        videos,
      },
    };
  } catch (error) {
    logFailure("load", subject, error);
    return { kind: "unavailable" };
  }
}

function isMutationKind(value: unknown): value is Exclude<SourceSetMutationKind, "forbidden" | "unavailable"> {
  return (
    typeof value === "string" &&
    [
      "added",
      "removed",
      "reordered",
      "unchanged",
      "duplicate",
      "limit_reached",
      "conflict",
      "not_in_history",
      "not_ready",
      "membership_missing",
      "invalid_order",
      "missing",
    ].includes(value)
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isCandidateRow(value: unknown): value is CandidateRpcRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CandidateRpcRow>;
  return (
    typeof row.videoId === "string" &&
    typeof row.youtubeUrl === "string" &&
    (row.title === null || typeof row.title === "string") &&
    (row.channelName === null || typeof row.channelName === "string") &&
    typeof row.viewedAt === "string"
  );
}

export async function loadProjectHistoryCandidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  input: { page?: number; search?: string } = {},
): Promise<ProjectOutcome<ProjectHistoryCandidatePage>> {
  const page = input.page ?? 1;
  const search = input.search?.trim() ?? "";
  try {
    const result = await supabase.rpc("list_project_history_candidates", {
      p_project_id: subject.projectId,
      p_search: search,
      p_page: page,
      p_page_size: PROJECT_HISTORY_CANDIDATE_PAGE_SIZE,
    });
    if (result.error) {
      logFailure("list_project_history_candidates", subject, result.error);
      return result.error.code === "42501"
        ? { kind: "forbidden" }
        : { kind: "unavailable" };
    }

    const rpc = result.data as CandidateRpcResult | null;
    if (rpc?.outcome === "missing") return { kind: "missing" };
    if (rpc?.outcome === "unauthenticated") return { kind: "forbidden" };
    if (
      rpc?.outcome !== "resolved" ||
      !isPositiveInteger(rpc.page) ||
      !isPositiveInteger(rpc.pageSize) ||
      !isNonnegativeInteger(rpc.total) ||
      !isNonnegativeInteger(rpc.totalPages) ||
      !Array.isArray(rpc.candidates) ||
      !rpc.candidates.every(isCandidateRow)
    ) {
      logFailure("list_project_history_candidates", subject, {
        message: "Unexpected RPC result",
      });
      return { kind: "unavailable" };
    }

    return {
      kind: "resolved",
      value: {
        page: rpc.page,
        pageSize: rpc.pageSize,
        total: rpc.total,
        totalPages: rpc.totalPages,
        search,
        candidates: rpc.candidates.map((candidate) => ({
          ...candidate,
          youtubeVideoId: extractVideoId(candidate.youtubeUrl),
        })),
      },
    };
  } catch (error) {
    logFailure("list_project_history_candidates", subject, error);
    return { kind: "unavailable" };
  }
}

async function mutate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  functionName:
    | "add_project_history_video"
    | "remove_project_video"
    | "reorder_project_videos",
  args: Record<string, unknown>,
): Promise<SourceSetMutationOutcome> {
  let data: unknown;
  try {
    const result = await supabase.rpc(functionName, args);
    if (result.error) {
      logFailure(functionName, subject, result.error);
      return {
        kind: result.error.code === "42501" ? "forbidden" : "unavailable",
      };
    }
    data = result.data;
  } catch (error) {
    logFailure(functionName, subject, error);
    return { kind: "unavailable" };
  }

  const rpc = data as RpcResult | null;
  if (rpc?.outcome === "unauthenticated") return { kind: "forbidden" };
  if (!rpc || !isMutationKind(rpc.outcome)) {
    logFailure(functionName, subject, { message: "Unexpected RPC result" });
    return { kind: "unavailable" };
  }
  if (rpc.outcome === "missing") return { kind: "missing" };

  const refreshed = await loadProjectSourceSet(supabase, subject);
  if (refreshed.kind !== "resolved") {
    return { kind: refreshed.kind === "forbidden" ? "forbidden" : "unavailable" };
  }
  return { kind: rpc.outcome, sourceSet: refreshed.value };
}

export function addHistoryVideoToProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  videoId: string,
  expectedRevision: number,
) {
  return mutate(supabase, subject, "add_project_history_video", {
    p_project_id: subject.projectId,
    p_video_id: videoId,
    p_expected_revision: expectedRevision,
  });
}

export function removeVideoFromProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  videoId: string,
  expectedRevision: number,
) {
  return mutate(supabase, subject, "remove_project_video", {
    p_project_id: subject.projectId,
    p_video_id: videoId,
    p_expected_revision: expectedRevision,
  });
}

export function reorderProjectVideos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  subject: ProjectSubject,
  videoIds: readonly string[],
  expectedRevision: number,
) {
  return mutate(supabase, subject, "reorder_project_videos", {
    p_project_id: subject.projectId,
    p_video_ids: videoIds,
    p_expected_revision: expectedRevision,
  });
}
