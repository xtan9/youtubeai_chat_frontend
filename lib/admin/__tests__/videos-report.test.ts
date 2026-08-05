import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => {
  const objectIds = new WeakMap<object, number>();
  let nextObjectId = 1;
  return {
    cache: (fn: (...args: unknown[]) => unknown) => {
      const values = new Map<string, unknown>();
      return (...args: unknown[]) => {
        const key = args
          .map((arg) => {
            if (typeof arg !== "object" || arg === null) return String(arg);
            let id = objectIds.get(arg);
            if (!id) {
              id = nextObjectId++;
              objectIds.set(arg, id);
            }
            return `object:${id}`;
          })
          .join("|");
        if (!values.has(key)) values.set(key, fn(...args));
        return values.get(key);
      };
    },
  };
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadVideosReport } from "../videos-report";
import type { VideosReportInput } from "../report-types";
import { QueryError } from "../errors";
import { HISTORY_ROW_CAP } from "../admin-constants";

interface SelectScript {
  table: string;
  response: { data: unknown; error: unknown };
  expect?: (calls: ChainCall[]) => void;
}

interface ChainCall {
  method: string;
  args: unknown[];
}

function buildClient(
  scripts: SelectScript[],
  authResponse: { data: unknown; error: unknown } = {
    data: { users: [], total: 0 },
    error: null,
  },
): SupabaseClient {
  let index = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[index++];
    if (!script) throw new Error(`unexpected from('${table}') call`);
    if (script.table !== table) {
      throw new Error(`expected from('${script.table}'), got from('${table}')`);
    }

    const calls: ChainCall[] = [];
    const proxy: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) => {
        script.expect?.(calls);
        resolve(script.response);
      },
    };
    for (const method of [
      "select",
      "in",
      "gte",
      "lte",
      "order",
      "limit",
    ]) {
      proxy[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return proxy;
      };
    }
    return proxy;
  });

  return {
    from,
    auth: {
      admin: {
        listUsers: vi.fn(async () => authResponse),
      },
    },
  } as unknown as SupabaseClient;
}

function baseInput(
  overrides: Partial<VideosReportInput> = {},
): VideosReportInput {
  return {
    mode: "all_time",
    windowDays: 30,
    search: null,
    filters: {
      language: null,
      source: null,
      channel: null,
      model: null,
    },
    dateBounds: { from: null, to: null },
    sort: "distinctUsers",
    direction: "desc",
    pagination: { page: 1, pageSize: 25 },
    flaggedOnly: false,
    expandedVideoId: null,
    ...overrides,
  };
}

function clientForScope(
  history: Array<Record<string, unknown>>,
  videos: Array<Record<string, unknown>>,
  summaries: Array<Record<string, unknown>>,
  authResponse: { data: unknown; error: unknown } = {
    data: { users: [], total: 0 },
    error: null,
  },
): SupabaseClient {
  return buildClient(
    [
      {
        table: "user_video_history",
        response: { data: history, error: null },
      },
      { table: "videos", response: { data: videos, error: null } },
      { table: "summaries", response: { data: summaries, error: null } },
    ],
    authResponse,
  );
}

const VIDEO_FIXTURE = [
  { id: "vA", title: "Alpha", channel_name: "Ch1", language: "en", duration_seconds: 100 },
  { id: "vB", title: "Beta", channel_name: "Ch2", language: "fr", duration_seconds: 200 },
  { id: "vC", title: "Gamma", channel_name: "Ch1", language: "en", duration_seconds: 300 },
];

const SUMMARY_FIXTURE = [
  {
    video_id: "vA",
    transcript_source: "auto_captions",
    model: "claude-opus-4-7",
    processing_time_seconds: 8,
    created_at: "2026-04-01T08:30:00Z",
  },
  {
    video_id: "vB",
    transcript_source: "whisper",
    model: "claude-haiku-4-5",
    processing_time_seconds: 12,
    created_at: "2026-04-02T08:30:00Z",
  },
  {
    video_id: "vC",
    transcript_source: "manual_captions",
    model: "claude-sonnet-4-6",
    processing_time_seconds: 4,
    created_at: "2026-04-03T08:30:00Z",
  },
];

function fixtureHistory() {
  return [
    { user_id: "u1", video_id: "vA", created_at: "2026-04-01T08:30:00Z" },
    { user_id: "u2", video_id: "vB", created_at: "2026-04-02T08:30:00Z" },
    { user_id: "u3", video_id: "vC", created_at: "2026-04-03T08:30:00Z" },
  ];
}

describe("loadVideosReport", () => {
  it("returns a complete serializable empty report without follow-up dataset reads", async () => {
    const client = buildClient([
      { table: "user_video_history", response: { data: [], error: null } },
    ]);

    const report = await loadVideosReport(client, baseInput());

    expect(report.list).toEqual({
      rows: [],
      total: 0,
      truncated: false,
      page: 1,
      pageCount: 1,
      adminFilterIncomplete: false,
    });
    expect(report.insights).toMatchObject({
      totalUniqueVideos: 0,
      totalSummaries: 0,
      whisperVideoSharePct: 0,
      topChannels: [],
      languageMix: [],
      adminFilterIncomplete: false,
    });
    expect(report.insights.sourceMix).toEqual([
      { source: "manual_captions", count: 0 },
      { source: "auto_captions", count: 0 },
      { source: "whisper", count: 0 },
    ]);
    expect(report.expandedVideoId).toBeNull();
    expect(report.warnings).toEqual([]);
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("throws the recognized admin data error when history fails", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: null, error: { message: "history unavailable" } },
      },
    ]);

    await expect(loadVideosReport(client, baseInput())).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("throws the recognized admin data error when videos metadata fails", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            {
              user_id: "u-1",
              video_id: "v-1",
              created_at: "2026-04-01T00:00:00Z",
            },
          ],
          error: null,
        },
      },
      {
        table: "videos",
        response: { data: null, error: { message: "videos unavailable" } },
      },
      { table: "summaries", response: { data: [], error: null } },
    ]);

    await expect(loadVideosReport(client, baseInput())).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("throws the recognized admin data error when summaries metadata fails", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            {
              user_id: "u-1",
              video_id: "v-1",
              created_at: "2026-04-01T00:00:00Z",
            },
          ],
          error: null,
        },
      },
      { table: "videos", response: { data: [], error: null } },
      {
        table: "summaries",
        response: { data: null, error: { message: "summaries unavailable" } },
      },
    ]);

    await expect(loadVideosReport(client, baseInput())).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("keeps all-time and trending history behavior while sharing one scope", async () => {
    const calls: ChainCall[] = [];
    const allTimeClient = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            {
              user_id: "u-1",
              video_id: "v-1",
              created_at: "2026-04-01T00:00:00Z",
            },
          ],
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: [
            {
              id: "v-1",
              title: "One",
              channel_name: "Channel",
              language: "en",
              duration_seconds: 60,
            },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [
            {
              video_id: "v-1",
              transcript_source: "auto_captions",
              model: "claude-opus-4-7",
              processing_time_seconds: 4,
              created_at: "2026-04-01T00:00:00Z",
            },
          ],
          error: null,
        },
      },
    ]);
    const allTime = await loadVideosReport(allTimeClient, baseInput());
    expect(allTime.list.rows).toHaveLength(1);
    expect(allTime.insights.totalUniqueVideos).toBe(1);
    expect(allTime.insights.trendingPerDay).toBeUndefined();

    const trendingClient = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            {
              user_id: "u-1",
              video_id: "v-1",
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        },
        expect: (scriptCalls) => calls.push(...scriptCalls),
      },
      {
        table: "videos",
        response: {
          data: [
            { id: "v-1", title: "One", channel_name: "Channel", language: "en" },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [{ video_id: "v-1", transcript_source: "whisper" }],
          error: null,
        },
      },
    ]);
    const trending = await loadVideosReport(
      trendingClient,
      baseInput({ mode: "trending", windowDays: 7 }),
    );
    expect(trending.insights.trendingPerDay).toHaveLength(7);
    expect(trending.list.rows[0]?.status).toBe("active");
    expect(calls.some((call) => call.method === "gte")).toBe(true);
    expect(calls.some((call) => call.method === "lte")).toBe(true);
  });

  it("computes compatible insights and applies search, metadata, source, model, flagged, and date filters", async () => {
    const run = (overrides: Partial<VideosReportInput>) =>
      loadVideosReport(
        clientForScope(fixtureHistory(), VIDEO_FIXTURE, SUMMARY_FIXTURE),
        baseInput(overrides),
      );

    const unfiltered = await run({});
    expect(unfiltered.insights.totalUniqueVideos).toBe(3);
    expect(unfiltered.insights.totalSummaries).toBe(3);
    expect(unfiltered.insights.topChannels[0]).toEqual({
      channelName: "Ch1",
      videoCount: 2,
    });
    expect(unfiltered.insights.languageMix).toEqual([
      { language: "en", videoCount: 2 },
      { language: "fr", videoCount: 1 },
    ]);
    expect(unfiltered.insights.sourceMix).toEqual([
      { source: "manual_captions", count: 1 },
      { source: "auto_captions", count: 1 },
      { source: "whisper", count: 1 },
    ]);

    const bySearch = await run({ search: "ch1" });
    expect(bySearch.list.rows.map((row) => row.videoId)).toEqual(["vA", "vC"]);

    const byLanguage = await run({
      filters: { language: "fr", source: null, channel: null, model: null },
    });
    expect(byLanguage.list.rows.map((row) => row.videoId)).toEqual(["vB"]);

    const bySource = await run({
      filters: { language: null, source: "whisper", channel: null, model: null },
    });
    expect(bySource.list.rows.map((row) => row.videoId)).toEqual(["vB"]);

    const byChannel = await run({
      filters: { language: null, source: null, channel: "Ch2", model: null },
    });
    expect(byChannel.list.rows.map((row) => row.videoId)).toEqual(["vB"]);

    const byModel = await run({
      filters: {
        language: null,
        source: null,
        channel: null,
        model: "claude-haiku-4-5",
      },
    });
    expect(byModel.list.rows.map((row) => row.videoId)).toEqual(["vB"]);

    const flagged = await run({ flaggedOnly: true });
    expect(flagged.list.rows.map((row) => row.videoId)).toEqual(["vB"]);
    expect(flagged.list.rows[0]?.flagged).toBe(true);

    const byDate = await run({
      dateBounds: { from: "2026-04-02", to: "2026-04-02" },
    });
    expect(byDate.list.rows.map((row) => row.videoId)).toEqual(["vB"]);
  });

  it("sorts deterministically in both directions and paginates after sorting", async () => {
    const history = [
      { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
      { user_id: "u2", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
      { user_id: "u3", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
      { user_id: "u4", video_id: "vC", created_at: "2026-04-04T00:00:00Z" },
    ];
    const run = (overrides: Partial<VideosReportInput>) =>
      loadVideosReport(
        clientForScope(history, VIDEO_FIXTURE, SUMMARY_FIXTURE),
        baseInput(overrides),
      );

    const titleAsc = await run({ sort: "title", direction: "asc" });
    expect(titleAsc.list.rows.map((row) => row.videoId)).toEqual([
      "vA",
      "vB",
      "vC",
    ]);
    const titleDesc = await run({ sort: "title", direction: "desc" });
    expect(titleDesc.list.rows.map((row) => row.videoId)).toEqual([
      "vC",
      "vB",
      "vA",
    ]);

    const pageOne = await run({ pagination: { page: 1, pageSize: 2 } });
    const pageTwo = await run({ pagination: { page: 2, pageSize: 2 } });
    expect(pageOne.list.pageCount).toBe(2);
    expect(pageOne.list.rows).toHaveLength(2);
    expect(pageTwo.list.rows).toHaveLength(1);
    expect([...pageOne.list.rows, ...pageTwo.list.rows]).toHaveLength(3);
  });

  it("clamps page size and reports the Video row cap", async () => {
    const manyVideos = Array.from({ length: 55 }, (_, index) => ({
      id: `v-${index}`,
      title: `Video ${index}`,
      channel_name: "Ch",
      language: "en",
    }));
    const manyHistory = manyVideos.map((video, index) => ({
      user_id: `u-${index}`,
      video_id: video.id,
      created_at: "2026-04-01T00:00:00Z",
    }));
    const page = await loadVideosReport(
      clientForScope(manyHistory, manyVideos, []),
      baseInput({ pagination: { page: 1, pageSize: 999 } }),
    );
    expect(page.list.rows).toHaveLength(50);
    expect(page.list.pageCount).toBe(2);

    const cappedHistory = Array.from({ length: 25_001 }, (_, index) => ({
      user_id: `u-${index}`,
      video_id: `v-${index}`,
      created_at: "2026-04-01T00:00:00Z",
    }));
    const capped = await loadVideosReport(
      clientForScope(cappedHistory, [], []),
      baseInput(),
    );
    expect(capped.list.truncated).toBe(true);
    expect(capped.list.total).toBe(25_000);
    expect(capped.insights.totalUniqueVideos).toBe(25_000);
  });

  it("derives active and stale row status from the most recent view", async () => {
    const stale = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const report = await loadVideosReport(
      clientForScope(
        [{ user_id: "u-1", video_id: "v-1", created_at: stale }],
        [{ id: "v-1", title: "Old", channel_name: "Ch", language: "en" }],
        [{ video_id: "v-1", transcript_source: "auto_captions", created_at: stale }],
      ),
      baseInput(),
    );
    expect(report.list.rows[0]?.status).toBe("stale");
  });

  it("resolves expanded-Video intent only when the requested row is on the returned page", async () => {
    const expanded = await loadVideosReport(
      clientForScope(fixtureHistory(), VIDEO_FIXTURE, SUMMARY_FIXTURE),
      baseInput({ expandedVideoId: "vB" }),
    );
    expect(expanded.expandedVideoId).toBe("vB");

    const notOnPage = await loadVideosReport(
      clientForScope(fixtureHistory(), VIDEO_FIXTURE, SUMMARY_FIXTURE),
      baseInput({
        expandedVideoId: "vC",
        pagination: { page: 1, pageSize: 2 },
      }),
    );
    expect(notOnPage.expandedVideoId).toBeNull();
  });

  it("excludes an entire administrator-touched Video from both rows and insights", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: { data: [{ video_id: "vA" }], error: null },
          expect: (calls) => {
            expect(calls.find((call) => call.method === "in")?.args).toEqual([
              "user_id",
              ["a1", "smoke"],
            ]);
          },
        },
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "a1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
              { user_id: "u1", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
              { user_id: "u2", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
            ],
            error: null,
          },
        },
        {
          table: "videos",
          response: {
            data: VIDEO_FIXTURE.slice(0, 2),
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            data: SUMMARY_FIXTURE.slice(0, 2),
            error: null,
          },
        },
      ],
      {
        data: {
          users: [
            {
              id: "a1",
              email: "admin@example.com",
              app_metadata: { is_admin: true },
            },
            {
              id: "smoke",
              email: "smoke@example.com",
              app_metadata: { is_smoke_account: true },
            },
          ],
          total: 1,
        },
        error: null,
      },
    );

    const report = await loadVideosReport(client, baseInput());

    expect(report.list.rows.map((row) => row.videoId)).toEqual(["vB"]);
    expect(report.insights.totalUniqueVideos).toBe(1);
    expect(report.insights.totalSummaries).toBe(1);
    expect(report.list.adminFilterIncomplete).toBe(false);
    expect(client.from).toHaveBeenCalledTimes(4);
  });

  it("throws the recognized admin data error when administrator-touched Video detection fails", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: { data: null, error: { message: "admin history unavailable" } },
        },
      ],
      {
        data: {
          users: [{ id: "a1", email: "admin@example.com", app_metadata: { is_admin: true } }],
          total: 1,
        },
        error: null,
      },
    );

    await expect(loadVideosReport(client, baseInput())).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("returns usable data with a warning when User Account enumeration is unavailable", async () => {
    const report = await loadVideosReport(
      clientForScope(
        fixtureHistory(),
        VIDEO_FIXTURE,
        SUMMARY_FIXTURE,
        { data: null, error: { message: "auth unavailable" } },
      ),
      baseInput(),
    );

    expect(report.list.rows).toHaveLength(3);
    expect(report.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
        description:
          "User Account total is unavailable because account enumeration failed.",
      },
    ]);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("returns usable data with a warning when User Account enumeration is truncated", async () => {
    const users = Array.from({ length: 5_001 }, (_, index) => ({
      id: `u-${index}`,
      email: `user-${index}@example.com`,
    }));
    const report = await loadVideosReport(
      clientForScope(fixtureHistory(), VIDEO_FIXTURE, SUMMARY_FIXTURE, {
        data: { users, total: users.length },
        error: null,
      }),
      baseInput(),
    );

    expect(report.list.rows).toHaveLength(3);
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      "USER_ACCOUNT_DIRECTORY_TRUNCATED",
    ]);
  });

  it("returns usable data with a warning when administrator-touched Video detection reaches its cap", async () => {
    const adminTouched = Array.from({ length: HISTORY_ROW_CAP }, (_, index) => ({
      video_id: `admin-video-${index}`,
    }));
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: { data: adminTouched, error: null },
        },
        {
          table: "user_video_history",
          response: {
            data: [{ user_id: "u1", video_id: "v-real", created_at: "2026-04-01T00:00:00Z" }],
            error: null,
          },
        },
        {
          table: "videos",
          response: {
            data: [{ id: "v-real", title: "Real", channel_name: "Ch", language: "en" }],
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            data: [{ video_id: "v-real", transcript_source: "auto_captions" }],
            error: null,
          },
        },
      ],
      {
        data: {
          users: [{ id: "a1", email: "admin@example.com", app_metadata: { is_admin: true } }],
          total: 1,
        },
        error: null,
      },
    );

    const report = await loadVideosReport(client, baseInput());

    expect(report.list.rows.map((row) => row.videoId)).toEqual(["v-real"]);
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      "ADMINISTRATOR_TOUCHED_VIDEOS_TRUNCATED",
    ]);
    expect(report.list.adminFilterIncomplete).toBe(true);
    expect(report.insights.adminFilterIncomplete).toBe(true);
  });
});
