import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { SUMMARIES_ROW_CAP } from "../admin-constants";
import { loadDashboardReport } from "../dashboard-report";

interface ChainCall {
  method: string;
  args: unknown[];
}

interface SelectScript {
  table: string;
  response: { data: unknown; error: unknown };
  expect?: (calls: ChainCall[]) => void;
}

function buildClient(
  scripts: SelectScript[],
  authResponses: {
    listUsers?: { data: unknown; error: unknown };
    getUserById?: (id: string) => { data: unknown; error: unknown };
  } = {},
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
      "eq",
      "in",
      "gte",
      "lte",
      "not",
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
        listUsers: vi.fn(async () =>
          authResponses.listUsers ?? {
            data: { users: [], total: 0 },
            error: null,
          },
        ),
        getUserById: vi.fn(async (id: string) =>
          authResponses.getUserById?.(id) ?? {
            data: { user: null },
            error: null,
          },
        ),
      },
    },
  } as unknown as SupabaseClient;
}

describe("loadDashboardReport", () => {
  it("returns a stable serializable empty report", async () => {
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(client.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      summaries: { current: 0, previous: 0 },
      whisper: { current: 0, previous: 0 },
      p95Seconds: { current: null, previous: null },
      transcribeP95Seconds: null,
      summarizeP95Seconds: null,
      cacheHitRatePct: { current: null, previous: null },
      sourceMix: [
        { source: "manual_captions", count: 0 },
        { source: "auto_captions", count: 0 },
        { source: "whisper", count: 0 },
      ],
      topUsers: [],
      warnings: [],
    });
    expect(result.window.start).toEqual(expect.any(String));
    expect(result.window.end).toEqual(expect.any(String));
    expect(result.summariesPerDay).toHaveLength(7);
    expect(result.dauPerDay).toHaveLength(7);
    expect(result.cacheHitPerDay).toHaveLength(7);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("preserves current and comparison aggregation and stable User-Account mapping", async () => {
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setUTCHours(0, 0, 0, 0);
    currentStart.setUTCDate(currentStart.getUTCDate() - 6);
    const previousDay = new Date(currentStart);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const today = now.toISOString();
    const previous = previousDay.toISOString();
    let currentSummaryWindow: { start: string; end: string } | undefined;
    let previousSummaryWindow: { start: string; end: string } | undefined;

    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              {
                id: "s1",
                video_id: "v1",
                transcript_source: "whisper",
                processing_time_seconds: 10,
                transcribe_time_seconds: 8,
                summarize_time_seconds: 2,
                created_at: today,
              },
              {
                id: "s2",
                video_id: "v2",
                transcript_source: "auto_captions",
                processing_time_seconds: 5,
                transcribe_time_seconds: 3,
                summarize_time_seconds: 2,
                created_at: today,
              },
            ],
            error: null,
          },
          expect: (calls) => {
            currentSummaryWindow = {
              start: String(calls.find((call) => call.method === "gte")?.args[1]),
              end: String(calls.find((call) => call.method === "lte")?.args[1]),
            };
            expect(calls.find((call) => call.method === "gte")?.args[0]).toBe(
              "created_at",
            );
            expect(calls.find((call) => call.method === "lte")?.args[0]).toBe(
              "created_at",
            );
          },
        },
        {
          table: "summaries",
          response: {
            data: [
              {
                id: "p1",
                video_id: "v3",
                transcript_source: "manual_captions",
                processing_time_seconds: 3,
                transcribe_time_seconds: 1,
                summarize_time_seconds: 2,
                created_at: previous,
              },
            ],
            error: null,
          },
          expect: (calls) => {
            previousSummaryWindow = {
              start: String(calls.find((call) => call.method === "gte")?.args[1]),
              end: String(calls.find((call) => call.method === "lte")?.args[1]),
            };
            expect(calls.find((call) => call.method === "gte")?.args[0]).toBe(
              "created_at",
            );
            expect(calls.find((call) => call.method === "lte")?.args[0]).toBe(
              "created_at",
            );
          },
        },
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "v1", created_at: today },
              { user_id: "u1", video_id: "v2", created_at: today },
              { user_id: "u2", video_id: "v1", created_at: today },
            ],
            error: null,
          },
        },
        { table: "user_video_history", response: { data: [], error: null } },
        {
          table: "summaries",
          response: {
            data: [
              { video_id: "v1", created_at: "2026-01-01T00:00:00Z" },
              { video_id: "v2", created_at: today },
            ],
            error: null,
          },
        },
      ],
      {
        getUserById: (id) => ({
          data: {
            user: { email: `${id}@example.com` },
          },
          error: null,
        }),
      },
    );

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(currentSummaryWindow).toEqual(result.window);
    expect(previousSummaryWindow?.end).toBe(
      new Date(new Date(result.window.start).getTime() - 86_400_000).toISOString(),
    );
    const comparisonDays =
      Math.round(
        (new Date(result.window.end).getTime() -
          new Date(result.window.start).getTime()) /
          86_400_000,
      ) + 1;
    expect(previousSummaryWindow?.start).toBe(
      new Date(
        new Date(result.window.start).getTime() - comparisonDays * 86_400_000,
      ).toISOString(),
    );
    expect(result.summaries).toEqual({ current: 2, previous: 1 });
    expect(result.whisper).toEqual({ current: 1, previous: 0 });
    expect(result.p95Seconds).toEqual({ current: 10, previous: 3 });
    expect(result.transcribeP95Seconds).toBe(8);
    expect(result.summarizeP95Seconds).toBe(2);
    expect(result.cacheHitRatePct).toEqual({ current: 67, previous: null });
    expect(result.sourceMix).toEqual([
      { source: "manual_captions", count: 0 },
      { source: "auto_captions", count: 1 },
      { source: "whisper", count: 1 },
    ]);
    expect(result.topUsers).toEqual([
      {
        userId: "u1",
        email: "u1@example.com",
        emailLookupOk: true,
        summaries: 2,
        whisperPct: 50,
        p95Seconds: 10,
        lastSeen: today,
        flagged: true,
      },
      {
        userId: "u2",
        email: "u2@example.com",
        emailLookupOk: true,
        summaries: 1,
        whisperPct: 100,
        p95Seconds: 10,
        lastSeen: today,
        flagged: true,
      },
    ]);
    expect(result.summariesPerDay.find((point) => point.day === today.slice(0, 10)))
      .toEqual({ day: today.slice(0, 10), value: 2 });
    expect(result.dauPerDay.find((point) => point.day === today.slice(0, 10)))
      .toEqual({ day: today.slice(0, 10), value: 2 });
    expect(result.cacheHitPerDay.find((point) => point.day === today.slice(0, 10)))
      .toEqual({ day: today.slice(0, 10), value: 67 });
    expect(result.warnings).toEqual([]);
  });

  it("throws the recognized admin data error when the primary dataset fails", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: { data: null, error: { message: "summaries unavailable" } },
      },
      { table: "summaries", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);

    await expect(
      loadDashboardReport(client, {
        windowDays: 7,
        includeAdministrators: true,
      }),
    ).rejects.toMatchObject({
      name: "QueryError",
      message: expect.stringContaining("summaries unavailable"),
    });
  });

  it("throws the recognized admin data error when the activity dataset fails", async () => {
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      {
        table: "user_video_history",
        response: { data: null, error: { message: "history unavailable" } },
      },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);

    await expect(
      loadDashboardReport(client, {
        windowDays: 7,
        includeAdministrators: true,
      }),
    ).rejects.toMatchObject({
      name: "QueryError",
      message: expect.stringContaining("history unavailable"),
    });
  });

  it("returns a warning when cache-hit enrichment is unavailable", async () => {
    const today = new Date().toISOString();
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      {
        table: "user_video_history",
        response: {
          data: [{ user_id: "u1", video_id: "v1", created_at: today }],
          error: null,
        },
      },
      { table: "user_video_history", response: { data: [], error: null } },
      {
        table: "summaries",
        response: { data: null, error: { message: "cache lookup unavailable" } },
      },
    ]);

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(result.cacheHitRatePct.current).toBeNull();
    expect(result.warnings).toEqual([
      {
        code: "DASHBOARD_CACHE_HIT_UNAVAILABLE",
        description: expect.any(String),
      },
    ]);
    expect(result.warnings[0].description).not.toContain("cache lookup unavailable");
  });

  it("returns usable data with a warning when the summary row cap is reached", async () => {
    const today = new Date().toISOString();
    const summaries = Array.from({ length: SUMMARIES_ROW_CAP }, (_, index) => ({
      id: `s-${index}`,
      video_id: `v-${index}`,
      transcript_source: "auto_captions",
      processing_time_seconds: 1,
      transcribe_time_seconds: 1,
      summarize_time_seconds: 0,
      created_at: today,
    }));
    const client = buildClient([
      { table: "summaries", response: { data: summaries, error: null } },
      { table: "summaries", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(result.summaries.current).toBe(SUMMARIES_ROW_CAP);
    expect(result.warnings).toEqual([
      {
        code: "DASHBOARD_SUMMARIES_TRUNCATED",
        description: expect.any(String),
      },
    ]);
  });

  it("excludes administrator activity while retaining a shared Video", async () => {
    const today = new Date().toISOString();
    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              {
                id: "s-admin",
                video_id: "v-admin",
                transcript_source: "whisper",
                processing_time_seconds: 100,
                transcribe_time_seconds: 90,
                summarize_time_seconds: 10,
                created_at: today,
              },
              {
                id: "s-shared",
                video_id: "v-shared",
                transcript_source: "auto_captions",
                processing_time_seconds: 7,
                transcribe_time_seconds: 5,
                summarize_time_seconds: 2,
                created_at: today,
              },
            ],
            error: null,
          },
        },
        { table: "summaries", response: { data: [], error: null } },
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u-real", video_id: "v-shared", created_at: today },
            ],
            error: null,
          },
          expect: (calls) => {
            expect(calls.find((call) => call.method === "select")?.args).toEqual([
              "user_id, video_id, created_at:accessed_at",
            ]);
            expect(calls.find((call) => call.method === "gte")?.args[0]).toBe(
              "accessed_at",
            );
            expect(calls.find((call) => call.method === "lte")?.args[0]).toBe(
              "accessed_at",
            );
            expect(calls.find((call) => call.method === "not")?.args).toEqual([
              "user_id",
              "in",
              "(u-admin)",
            ]);
          },
        },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        listUsers: {
          data: {
            users: [
              {
                id: "u-admin",
                email: "admin@example.com",
                app_metadata: { is_admin: true },
              },
            ],
            total: 1,
          },
          error: null,
        },
        getUserById: () => ({
          data: { user: { email: "learner@example.com" } },
          error: null,
        }),
      },
    );

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(client.auth.admin.listUsers).toHaveBeenCalledWith({
      page: 1,
      perPage: 200,
    });
    expect(result.summaries.current).toBe(1);
    expect(result.whisper.current).toBe(0);
    expect(result.p95Seconds.current).toBe(7);
    expect(result.topUsers.map((user) => user.userId)).toEqual(["u-real"]);
    expect(result.warnings).toEqual([]);
  });

  it("returns usable data with a machine-readable warning when administrator enumeration fails", async () => {
    const client = buildClient(
      [
        { table: "summaries", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "user_video_history", response: { data: [], error: null } },
      ],
      {
        listUsers: {
          data: null,
          error: { message: "auth service unavailable" },
        },
      },
    );

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(result.summaries.current).toBe(0);
    expect(result.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
        description: expect.any(String),
      },
    ]);
    expect(result.warnings[0].description).not.toContain("auth service");
  });

  it("returns usable data and a truncation warning for a capped administrator enumeration", async () => {
    const users = Array.from({ length: 5_001 }, (_, index) => ({
      id: index === 0 ? "u-admin" : `u-${index}`,
      email: `${index}@example.com`,
      app_metadata: { is_admin: index === 0 },
    }));
    const client = buildClient(
      [
        { table: "summaries", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "user_video_history", response: { data: [], error: null } },
      ],
      {
        listUsers: {
          data: { users, total: users.length },
          error: null,
        },
      },
    );

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(result.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_TRUNCATED",
        description: expect.any(String),
      },
    ]);
    expect(result.warnings[0].description).not.toContain("5001");
  });

  it("keeps the report usable and warns when a top User-Account lookup fails", async () => {
    const today = new Date().toISOString();
    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              {
                id: "s1",
                video_id: "v1",
                transcript_source: "auto_captions",
                processing_time_seconds: 5,
                transcribe_time_seconds: 3,
                summarize_time_seconds: 2,
                created_at: today,
              },
            ],
            error: null,
          },
        },
        { table: "summaries", response: { data: [], error: null } },
        {
          table: "user_video_history",
          response: {
            data: [{ user_id: "u1", video_id: "v1", created_at: today }],
            error: null,
          },
        },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({
          data: { user: null },
          error: { message: "account lookup unavailable" },
        }),
      },
    );

    const result = await loadDashboardReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(result.summaries.current).toBe(1);
    expect(result.topUsers[0]).toMatchObject({
      userId: "u1",
      email: null,
      emailLookupOk: false,
    });
    expect(result.warnings).toEqual([
      {
        code: "TOP_USER_ACCOUNT_LOOKUP_UNAVAILABLE",
        description: expect.any(String),
      },
    ]);
  });
});
