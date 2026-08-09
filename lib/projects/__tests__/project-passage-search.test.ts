import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProjectPassageSearchCapability } from "../project-passage-search";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_ID = "b0000000-0000-4000-8000-000000000001";
const TARGET = { projectId: PROJECT_ID, ownerId: "owner-1" };

const COVERAGE = {
  totalVideos: 1,
  readyVideos: 1,
  unavailableVideos: [],
  passagesExamined: 4,
};

const PASSAGE = {
  passageId: `${VIDEO_ID}:2:0:30`,
  videoId: VIDEO_ID,
  youtubeVideoId: "aaaaaaa0001",
  title: "Evidence title",
  channelName: "Evidence channel",
  text: "Exact renewable energy passage",
  segmentOrdinal: 2,
  excerptStartCharacter: 0,
  excerptEndCharacter: 30,
  startSeconds: 42,
  endSeconds: 47,
  language: "en",
  truncatedStart: false,
  truncatedEnd: false,
};

function client(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("Project passage-search capability", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns a validated, bounded exact passage and hides ranking scores", async () => {
    const supabase = client({
      data: {
        outcome: "ready",
        sourceSetRevision: 7,
        coverage: COVERAGE,
        passages: [PASSAGE],
      },
      error: null,
    });
    const capability = createProjectPassageSearchCapability(
      supabase as never,
      TARGET,
    );

    await expect(
      capability.search({ query: "renewable energy", limit: 8 }),
    ).resolves.toEqual({
      status: "ready",
      sourceSetRevision: 7,
      coverage: COVERAGE,
      passages: [PASSAGE],
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "search_project_transcript_passages",
      {
        p_project_id: PROJECT_ID,
        p_query: "renewable energy",
        p_limit: 8,
      },
    );
    expect(PASSAGE).not.toHaveProperty("rank");
  });

  it("uses the source-balanced RPC only for Project Assessment retrieval", async () => {
    const supabase = client({
      data: {
        outcome: "ready",
        sourceSetRevision: 7,
        coverage: COVERAGE,
        passages: [PASSAGE],
      },
      error: null,
    });
    const capability = createProjectPassageSearchCapability(
      supabase as never,
      TARGET,
    );

    await expect(
      capability.search({ query: "which position", limit: 10, balanceSources: true }),
    ).resolves.toMatchObject({ status: "ready", passages: [PASSAGE] });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "search_project_transcript_passages_balanced",
      {
        p_project_id: PROJECT_ID,
        p_query: "which position",
        p_limit: 10,
      },
    );
  });

  it.each([
    [
      "no_results",
      {
        totalVideos: 2,
        readyVideos: 1,
        unavailableVideos: [
          {
            videoId: "c0000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: "Still processing",
            channelName: null,
            status: "processing",
            failureCode: null,
          },
        ],
        passagesExamined: 9,
      },
    ],
    [
      "not_ready",
      {
        totalVideos: 1,
        readyVideos: 0,
        unavailableVideos: [
          {
            videoId: "c0000000-0000-4000-8000-000000000002",
            youtubeVideoId: "bbbbbbb0002",
            title: null,
            channelName: null,
            status: "failed",
            failureCode: "transcription_failed",
          },
        ],
        passagesExamined: 0,
      },
    ],
  ] as const)("preserves the classified %s state and coverage", async (outcome, coverage) => {
    const supabase = client({
      data: {
        outcome,
        sourceSetRevision: 2,
        coverage,
        passages: [],
      },
      error: null,
    });

    await expect(
      createProjectPassageSearchCapability(supabase as never, TARGET).search({
        query: "absent term",
        limit: 8,
      }),
    ).resolves.toEqual({
      status: outcome,
      sourceSetRevision: 2,
      coverage,
      passages: [],
    });
  });

  it("returns the same missing classification the database uses for foreign and absent Projects", async () => {
    for (const data of [{ outcome: "missing" }, { outcome: "missing" }]) {
      const supabase = client({ data, error: null });
      await expect(
        createProjectPassageSearchCapability(supabase as never, TARGET).search({
          query: "evidence",
          limit: 8,
        }),
      ).resolves.toEqual({ status: "missing" });
    }
  });

  it("classifies malformed adapter data without logging query or content", async () => {
    const supabase = client({
      data: {
        outcome: "ready",
        sourceSetRevision: 1,
        coverage: COVERAGE,
        passages: [{ ...PASSAGE, text: "private passage", rank: 99 }],
      },
      error: null,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createProjectPassageSearchCapability(supabase as never, TARGET).search({
        query: "private query",
        limit: 8,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    const serialized = JSON.stringify(error.mock.calls);
    expect(serialized).not.toContain("private query");
    expect(serialized).not.toContain("private passage");
    expect(serialized).not.toContain("Evidence title");
  });

  it("keeps database messages private and classifies thrown adapters", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = client({
      data: null,
      error: { code: "08006", message: "query and private passage" },
    });
    await expect(
      createProjectPassageSearchCapability(failed as never, TARGET).search({
        query: "secret",
        limit: 8,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    const thrown = { rpc: vi.fn().mockRejectedValue(new Error("secret query")) };
    await expect(
      createProjectPassageSearchCapability(thrown as never, TARGET).search({
        query: "secret",
        limit: 8,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret query");
    expect(JSON.stringify(error.mock.calls)).not.toContain("private passage");
  });
});
