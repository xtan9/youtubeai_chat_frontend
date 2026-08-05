import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPerformanceReport } from "../performance-report";

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
    for (const method of ["select", "gte", "lte", "not", "limit"]) {
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
      },
    },
  } as unknown as SupabaseClient;
}

function summary(
  id: string,
  videoId: string,
  processing: number,
  createdAt = new Date().toISOString(),
) {
  return {
    id,
    video_id: videoId,
    transcript_source: "auto_captions",
    processing_time_seconds: processing,
    transcribe_time_seconds: processing - 1,
    summarize_time_seconds: 1,
    created_at: createdAt,
  };
}

describe("loadPerformanceReport", () => {
  it("returns a serializable empty report with null metrics and filled daily buckets", async () => {
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
    ]);

    const report = await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(report.p50Seconds).toBeNull();
    expect(report.p95Seconds).toBeNull();
    expect(report.transcribeP95Seconds).toBeNull();
    expect(report.summarizeP95Seconds).toBeNull();
    expect(report.prev).toEqual({
      p50Seconds: null,
      p95Seconds: null,
      transcribeP95Seconds: null,
      summarizeP95Seconds: null,
    });
    expect(report.latencyByBucket).toHaveLength(7);
    expect(report.latencyByBucket.every((point) => point.p95Seconds === null)).toBe(
      true,
    );
    expect(report.warnings).toEqual([]);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("keeps Smoke Accounts excluded even when administrator activity is included", async () => {
    const expectSmokeExclusion = (calls: ChainCall[]) => {
      expect(calls.find((call) => call.method === "not")?.args).toEqual([
        "user_id",
        "in",
        "(smoke)",
      ]);
    };
    const client = buildClient(
      [
        { table: "summaries", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
        {
          table: "user_video_history",
          response: { data: [], error: null },
          expect: expectSmokeExclusion,
        },
        {
          table: "user_video_history",
          response: { data: [], error: null },
          expect: expectSmokeExclusion,
        },
      ],
      {
        listUsers: {
          data: {
            users: [
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
      },
    );

    await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });
  });

  it("throws the recognized admin data error when the primary summary dataset fails", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: { data: null, error: { message: "summaries unavailable" } },
      },
      { table: "summaries", response: { data: [], error: null } },
    ]);

    await expect(
      loadPerformanceReport(client, {
        windowDays: 7,
        includeAdministrators: true,
      }),
    ).rejects.toMatchObject({
      name: "QueryError",
      message: expect.stringContaining("summaries unavailable"),
    });
  });

  it("preserves percentile calculations, comparison values, and daily p95 values", async () => {
    const currentDay = new Date().toISOString();
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: [
            summary("current-1", "v1", 1, currentDay),
            summary("current-2", "v2", 2, currentDay),
            summary("current-3", "v3", 3, currentDay),
            summary("current-10", "v10", 10, currentDay),
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [summary("previous-4", "vp4", 4), summary("previous-8", "vp8", 8)],
          error: null,
        },
      },
    ]);

    const report = await loadPerformanceReport(client, {
      windowDays: 1,
      includeAdministrators: true,
    });

    expect(report.p50Seconds).toBe(2);
    expect(report.p95Seconds).toBe(10);
    expect(report.transcribeP95Seconds).toBe(9);
    expect(report.summarizeP95Seconds).toBe(1);
    expect(report.prev).toEqual({
      p50Seconds: 4,
      p95Seconds: 8,
      transcribeP95Seconds: 7,
      summarizeP95Seconds: 1,
    });
    expect(report.latencyByBucket).toEqual([
      { day: currentDay.slice(0, 10), p95Seconds: 10 },
    ]);
  });

  it.each([1, 7, 14, 30, 90])(
    "retains the supported %i-day window shape and derives the comparison period",
    async (windowDays) => {
      let currentWindow: { start: string; end: string } | undefined;
      let previousWindow: { start: string; end: string } | undefined;
      const client = buildClient([
        {
          table: "summaries",
          response: { data: [], error: null },
          expect: (calls) => {
            currentWindow = {
              start: String(calls.find((call) => call.method === "gte")?.args[1]),
              end: String(calls.find((call) => call.method === "lte")?.args[1]),
            };
          },
        },
        {
          table: "summaries",
          response: { data: [], error: null },
          expect: (calls) => {
            previousWindow = {
              start: String(calls.find((call) => call.method === "gte")?.args[1]),
              end: String(calls.find((call) => call.method === "lte")?.args[1]),
            };
          },
        },
      ]);

      const report = await loadPerformanceReport(client, {
        windowDays,
        includeAdministrators: true,
      });

      expect(report.latencyByBucket).toHaveLength(windowDays);
      expect(currentWindow).toEqual(report.window);
      expect(previousWindow?.end).toBe(
        new Date(new Date(report.window.start).getTime() - 86_400_000).toISOString(),
      );
      const comparisonDays =
        Math.round(
          (new Date(report.window.end).getTime() -
            new Date(report.window.start).getTime()) /
            86_400_000,
        ) + 1;
      expect(previousWindow?.start).toBe(
        new Date(
          new Date(report.window.start).getTime() - comparisonDays * 86_400_000,
        ).toISOString(),
      );
    },
  );

  it("includes all summary activity when administrators are included", async () => {
    const client = buildClient([
      {
        table: "summaries",
        response: { data: [summary("s-admin", "v-admin", 100)], error: null },
      },
      { table: "summaries", response: { data: [], error: null } },
    ]);

    const report = await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: true,
    });

    expect(report.p95Seconds).toBe(100);
    expect(client.auth.admin.listUsers).toHaveBeenCalledWith({
      page: 1,
      perPage: 200,
    });
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("excludes administrator-only activity while retaining a shared Video", async () => {
    const today = new Date().toISOString();
    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              summary("s-admin", "v-admin", 100, today),
              summary("s-shared", "v-shared", 7, today),
              summary("s-real", "v-real", 5, today),
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
              { user_id: "u-real", video_id: "v-real", created_at: today },
            ],
            error: null,
          },
          expect: (calls) => {
            expect(calls.find((call) => call.method === "not")?.args).toEqual([
              "user_id",
              "in",
              "(u-admin,smoke)",
            ]);
          },
        },
        { table: "user_video_history", response: { data: [], error: null } },
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
      },
    );

    const report = await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(report.p50Seconds).toBe(5);
    expect(report.p95Seconds).toBe(7);
    expect(report.latencyByBucket.find((point) => point.day === today.slice(0, 10))).toEqual(
      { day: today.slice(0, 10), p95Seconds: 7 },
    );
    expect(report.warnings).toEqual([]);
  });

  it("keeps usable data and warns when administrator enumeration fails", async () => {
    const client = buildClient(
      [
        {
          table: "summaries",
          response: { data: [summary("s1", "v1", 5)], error: null },
        },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        listUsers: {
          data: null,
          error: { message: "auth service unavailable" },
        },
      },
    );

    const report = await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(report.p95Seconds).toBe(5);
    expect(report.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
        description: expect.any(String),
      },
    ]);
    expect(report.warnings[0].description).not.toContain("auth service");
  });

  it("keeps usable data and warns when administrator enumeration is truncated", async () => {
    const users = Array.from({ length: 5_001 }, (_, index) => ({
      id: index === 0 ? "u-admin" : `u-${index}`,
      email: `${index}@example.com`,
      app_metadata: { is_admin: index === 0 },
    }));
    const client = buildClient(
      [
        {
          table: "summaries",
          response: { data: [summary("s1", "v1", 5)], error: null },
        },
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

    const report = await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(report.p95Seconds).toBeNull();
    expect(report.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_TRUNCATED",
        description: expect.any(String),
      },
    ]);
    expect(report.warnings[0].description).not.toContain("5001");
  });

  it("keeps usable data and warns when administrator-exclusion activity lookup fails", async () => {
    const client = buildClient(
      [
        {
          table: "summaries",
          response: { data: [summary("s1", "v1", 5)], error: null },
        },
        { table: "summaries", response: { data: [], error: null } },
        {
          table: "user_video_history",
          response: { data: null, error: { message: "activity unavailable" } },
        },
        { table: "user_video_history", response: { data: [], error: null } },
      ],
      {
        listUsers: {
          data: {
            users: [
              { id: "u-admin", app_metadata: { is_admin: true } },
            ],
            total: 1,
          },
          error: null,
        },
      },
    );

    const report = await loadPerformanceReport(client, {
      windowDays: 7,
      includeAdministrators: false,
    });

    expect(report.p95Seconds).toBe(5);
    expect(report.warnings).toEqual([
      {
        code: "PERFORMANCE_ACTIVITY_UNAVAILABLE",
        description: expect.any(String),
      },
    ]);
    expect(report.warnings[0].description).not.toContain("activity unavailable");
  });
});
