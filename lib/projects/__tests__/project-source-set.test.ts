import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addHistoryVideoToProject,
  loadProjectHistoryCandidates,
  loadProjectSourceSet,
  reorderProjectVideos,
} from "../project-source-set";
import type { ProjectSubject } from "../project-subject";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_ID = "10000000-0000-4000-8000-000000000001";
const SUBJECT: ProjectSubject = {
  kind: "project",
  projectId: PROJECT_ID,
  workspaceId: "b0000000-0000-4000-8000-000000000001",
  ownerId: "c0000000-0000-4000-8000-000000000001",
  name: "Evidence review",
  guidance: { goal: null },
  lastActiveAt: "2026-08-08T00:00:00.000Z",
};

const MEMBERSHIP = {
  video_id: VIDEO_ID,
  position: 1,
  status: "ready",
  failure_code: null,
  added_at: "2026-08-08T00:00:00.000Z",
  status_updated_at: "2026-08-08T00:00:00.000Z",
  videos: {
    id: VIDEO_ID,
    youtube_url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    youtube_video_id: "aaaaaaaaaaa",
    title: "Canonical source",
    channel_name: "Evidence Lab",
  },
};

function loadClient(
  sourceSetData: unknown = { revision: 2, project_videos: [MEMBERSHIP] },
  sourceSetError: unknown = null,
  mutationData: unknown = { outcome: "added", revision: 2 },
) {
  const sourceSetQuery = {
    data:
      sourceSetData === null
        ? { outcome: "resolved", revision: 0, project_videos: [] }
        : {
            outcome: "resolved",
            ...(sourceSetData as Record<string, unknown>),
          },
    error: sourceSetError,
  };
  const rpc = vi.fn((functionName: string) =>
    Promise.resolve(
      functionName === "load_project_source_set"
        ? sourceSetQuery
        : { data: mutationData, error: null },
    ),
  );
  return {
    rpc,
  };
}

describe("Project Source Set subject capability", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads ordered canonical memberships with readiness state", async () => {
    const client = loadClient();
    const result = await loadProjectSourceSet(client as never, SUBJECT);

    expect(result).toEqual({
      kind: "resolved",
      value: {
        projectId: PROJECT_ID,
        revision: 2,
        videos: [
          {
            videoId: VIDEO_ID,
            youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            youtubeVideoId: "aaaaaaaaaaa",
            title: "Canonical source",
            channelName: "Evidence Lab",
            position: 1,
            status: "ready",
            failureCode: null,
            addedAt: "2026-08-08T00:00:00.000Z",
            statusUpdatedAt: "2026-08-08T00:00:00.000Z",
          },
        ],
      },
    });
    expect(client.rpc).toHaveBeenCalledWith("load_project_source_set", {
      p_project_id: PROJECT_ID,
    });
  });

  it("represents a Project with no aggregate row as revision zero", async () => {
    const client = loadClient(null);
    await expect(loadProjectSourceSet(client as never, SUBJECT)).resolves.toEqual({
      kind: "resolved",
      value: { projectId: PROJECT_ID, revision: 0, videos: [] },
    });
  });

  it("classifies an RLS denial without leaking rows", async () => {
    const client = loadClient(undefined, { code: "42501", message: "denied" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadProjectSourceSet(client as never, SUBJECT)).resolves.toEqual({
      kind: "forbidden",
    });
  });

  it("adds through the atomic RPC and refreshes the canonical view", async () => {
    const client = loadClient(
      { revision: 3, project_videos: [] },
      null,
      { outcome: "added", revision: 3 },
    );
    const rpc = client.rpc;
    const result = await addHistoryVideoToProject(
      client as never,
      SUBJECT,
      VIDEO_ID,
      2,
    );

    expect(rpc).toHaveBeenCalledWith("add_project_history_video", {
      p_project_id: PROJECT_ID,
      p_video_id: VIDEO_ID,
      p_expected_revision: 2,
    });
    expect(result).toMatchObject({ kind: "added", sourceSet: { revision: 3 } });
  });

  it("returns the refreshed winning order for a stale concurrent revision", async () => {
    const client = loadClient(
      { revision: 8, project_videos: [] },
      null,
      { outcome: "conflict", revision: 8 },
    );
    const result = await reorderProjectVideos(
      client as never,
      SUBJECT,
      [VIDEO_ID],
      7,
    );

    expect(result).toMatchObject({ kind: "conflict", sourceSet: { revision: 8 } });
  });

  it("loads a server-filtered processed History candidate page", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "resolved",
        page: 2,
        pageSize: 10,
        total: 27,
        totalPages: 3,
        candidates: [
          {
            videoId: VIDEO_ID,
            youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            title: "Older evidence",
            channelName: "Archive",
            viewedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      error: null,
    });

    await expect(
      loadProjectHistoryCandidates({ rpc } as never, SUBJECT, {
        page: 2,
        search: " archive ",
      }),
    ).resolves.toEqual({
      kind: "resolved",
      value: {
        page: 2,
        pageSize: 10,
        total: 27,
        totalPages: 3,
        search: "archive",
        candidates: [
          {
            videoId: VIDEO_ID,
            youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            youtubeVideoId: "aaaaaaaaaaa",
            title: "Older evidence",
            channelName: "Archive",
            viewedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(rpc).toHaveBeenCalledWith("list_project_history_candidates", {
      p_project_id: PROJECT_ID,
      p_search: "archive",
      p_page: 2,
      p_page_size: 10,
    });
  });

  it("surfaces canonical evidence that is not ready without mutating locally", async () => {
    const client = loadClient(
      { revision: 2, project_videos: [MEMBERSHIP] },
      null,
      { outcome: "not_ready", revision: 2 },
    );

    await expect(
      addHistoryVideoToProject(
        client as never,
        SUBJECT,
        VIDEO_ID,
        2,
      ),
    ).resolves.toMatchObject({
      kind: "not_ready",
      sourceSet: { revision: 2 },
    });
  });
});
