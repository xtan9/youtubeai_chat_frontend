import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listAuditLog,
  listUsersWithStats,
  getDashboardKPIs,
  getPerformanceStats,
  getUserSummaries,
  lastNDays,
  QueryError,
} from "../queries";
import type { SupabaseClient } from "@supabase/supabase-js";

interface SelectScript {
  table: string;
  /** Final response — returned when the chain awaits. */
  response: { data: unknown; error: unknown };
  /** Optional: assert which filters were applied. */
  expect?: (calls: ChainCall[]) => void;
}

interface ChainCall {
  method: string;
  args: unknown[];
}

/**
 * Build a minimal supabase client whose `.from(table).select(...)...`
 * chain resolves to the next scripted response in `scripts`. Each call to
 * `client.from(...)` consumes one script entry, in order. Any chain method
 * (eq, in, gte, lte, or, order, limit, range) is recorded for assertions.
 */
function buildClient(
  scripts: SelectScript[],
  authResponses: {
    listUsers?: { data: unknown; error: unknown };
    getUserById?: (id: string) => { data: unknown; error: unknown };
  } = {},
): SupabaseClient {
  let i = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[i++];
    if (!script) {
      throw new Error(
        `unexpected from('${table}') call — no scripted response remaining`,
      );
    }
    if (script.table !== table) {
      throw new Error(
        `expected from('${script.table}'), got from('${table}')`,
      );
    }
    const calls: ChainCall[] = [];
    const proxy: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) => {
        script.expect?.(calls);
        resolve(script.response);
      },
    };
    const chain = (name: string) =>
      (...args: unknown[]) => {
        calls.push({ method: name, args });
        return proxy;
      };
    proxy.select = chain("select");
    proxy.eq = chain("eq");
    proxy.in = chain("in");
    proxy.gte = chain("gte");
    proxy.lte = chain("lte");
    proxy.or = chain("or");
    proxy.order = chain("order");
    proxy.limit = chain("limit");
    proxy.range = chain("range");
    return proxy;
  });
  return {
    from,
    auth: {
      admin: {
        listUsers: vi.fn(async () => authResponses.listUsers ?? { data: { users: [], total: 0 }, error: null }),
        getUserById: vi.fn(async (id: string) =>
          authResponses.getUserById?.(id) ?? { data: { user: null }, error: null },
        ),
      },
    },
  } as unknown as SupabaseClient;
}

describe("listAuditLog", () => {
  it("returns rows in newest-first order with no cursor when page fits", async () => {
    const client = buildClient([
      {
        table: "admin_audit_log",
        response: {
          data: [
            {
              id: "row-1",
              created_at: "2026-04-29T12:00:00Z",
              admin_id: "admin-1",
              admin_email: "alice@example.com",
              action: "view_transcript",
              resource_type: "summary",
              resource_id: "sum-1",
              metadata: { user_id: "u1" },
            },
          ],
          error: null,
        },
      },
    ]);
    const result = await listAuditLog(client, { pageSize: 50 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].adminEmail).toBe("alice@example.com");
    expect(result.rows[0].metadata).toEqual({ user_id: "u1" });
    expect(result.nextCursor).toBeNull();
  });

  it("emits nextCursor when one extra row is returned", async () => {
    const rows = Array.from({ length: 3 }, (_, idx) => ({
      id: `r${idx}`,
      created_at: `2026-04-29T12:00:0${idx}Z`,
      admin_id: "a",
      admin_email: "a@x",
      action: "view_transcript",
      resource_type: "summary",
      resource_id: "s",
      metadata: {},
    }));
    const client = buildClient([
      { table: "admin_audit_log", response: { data: rows, error: null } },
    ]);
    const result = await listAuditLog(client, { pageSize: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("propagates DB errors as QueryError", async () => {
    const client = buildClient([
      {
        table: "admin_audit_log",
        response: { data: null, error: { message: "table missing" } },
      },
    ]);
    await expect(listAuditLog(client)).rejects.toBeInstanceOf(QueryError);
  });
});

describe("listUsersWithStats", () => {
  it("returns rows joined with per-user activity aggregates", async () => {
    const window = lastNDays(30);
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "v1", created_at: window.end.toISOString() },
              { user_id: "u1", video_id: "v2", created_at: window.end.toISOString() },
              { user_id: "u2", video_id: "v3", created_at: window.end.toISOString() },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            data: [
              {
                video_id: "v1",
                transcript_source: "whisper",
                processing_time_seconds: 10,
              },
              {
                video_id: "v2",
                transcript_source: "auto_captions",
                processing_time_seconds: 5,
              },
              {
                video_id: "v3",
                transcript_source: "manual_captions",
                processing_time_seconds: 3,
              },
            ],
            error: null,
          },
        },
      ],
      {
        listUsers: {
          data: {
            users: [
              {
                id: "u1",
                email: "u1@example.com",
                created_at: "2026-01-01T00:00:00Z",
                last_sign_in_at: "2026-04-15T00:00:00Z",
              },
              {
                id: "u2",
                email: "u2@example.com",
                created_at: "2026-02-01T00:00:00Z",
                last_sign_in_at: null,
              },
              {
                id: "u3",
                email: "u3@example.com",
                created_at: "2026-03-01T00:00:00Z",
                last_sign_in_at: "2026-04-20T00:00:00Z",
              },
            ],
            total: 3,
          },
          error: null,
        },
      },
    );

    const result = await listUsersWithStats(client, { pageSize: 25, window });
    expect(result.rows).toHaveLength(3);
    const u1 = result.rows.find((r) => r.userId === "u1");
    expect(u1?.summaries).toBe(2);
    expect(u1?.whisper).toBe(1);
    expect(u1?.whisperPct).toBe(50);
    expect(u1?.flagged).toBe(true); // > 30%

    const u3 = result.rows.find((r) => r.userId === "u3");
    expect(u3?.summaries).toBe(0); // no history rows
    expect(u3?.flagged).toBe(false);
  });

  it("falls back to last_sign_in_at when no history rows exist", async () => {
    const window = lastNDays(30);
    const client = buildClient(
      [
        { table: "user_video_history", response: { data: [], error: null } },
      ],
      {
        listUsers: {
          data: {
            users: [
              {
                id: "u1",
                email: "u1@example.com",
                created_at: "2026-01-01T00:00:00Z",
                last_sign_in_at: "2026-04-20T00:00:00Z",
              },
            ],
            total: 1,
          },
          error: null,
        },
      },
    );
    // Even with no history, the activity step is skipped only when userIds
    // is empty. We have one user, so the function will issue the history
    // query but get an empty result back.
    const result = await listUsersWithStats(client, { pageSize: 25, window });
    expect(result.rows[0].lastSeen).toBe("2026-04-20T00:00:00Z");
    expect(result.rows[0].summaries).toBe(0);
  });

  it("filters by search term against email and id", async () => {
    const window = lastNDays(30);
    const client = buildClient(
      [{ table: "user_video_history", response: { data: [], error: null } }],
      {
        listUsers: {
          data: {
            users: [
              {
                id: "u1",
                email: "alice@example.com",
                created_at: "2026-01-01",
                last_sign_in_at: null,
              },
              {
                id: "u2",
                email: "bob@example.com",
                created_at: "2026-01-02",
                last_sign_in_at: null,
              },
            ],
            total: 2,
          },
          error: null,
        },
      },
    );
    const result = await listUsersWithStats(client, {
      pageSize: 25,
      search: "alice",
      window,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe("alice@example.com");
  });

  it("emits nextCursor when page is full", async () => {
    const users = Array.from({ length: 25 }, (_, idx) => ({
      id: `u${idx}`,
      email: `u${idx}@example.com`,
      created_at: "2026-01-01",
      last_sign_in_at: null,
    }));
    const client = buildClient(
      [{ table: "user_video_history", response: { data: [], error: null } }],
      { listUsers: { data: { users, total: 100 }, error: null } },
    );
    const result = await listUsersWithStats(client, { pageSize: 25 });
    expect(result.nextCursor).not.toBeNull();
  });
});

describe("getDashboardKPIs", () => {
  it("aggregates summaries, deltas, source mix, and top users", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const yesterday = new Date(window.start.getTime()).toISOString();
    const client = buildClient(
      [
        // current summaries
        {
          table: "summaries",
          response: {
            data: [
              { id: "s1", video_id: "v1", transcript_source: "whisper", processing_time_seconds: 10, transcribe_time_seconds: 8, summarize_time_seconds: 2, created_at: today },
              { id: "s2", video_id: "v2", transcript_source: "auto_captions", processing_time_seconds: 5, transcribe_time_seconds: 3, summarize_time_seconds: 2, created_at: today },
            ],
            error: null,
          },
        },
        // previous summaries
        {
          table: "summaries",
          response: {
            data: [
              { id: "p1", video_id: "v3", transcript_source: "manual_captions", processing_time_seconds: 3, transcribe_time_seconds: 1, summarize_time_seconds: 2, created_at: yesterday },
            ],
            error: null,
          },
        },
        // current history (fetchHistoryIn)
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
        // current history → cache-hit summary lookup
        {
          table: "summaries",
          response: {
            data: [
              { video_id: "v1", created_at: yesterday },
              { video_id: "v2", created_at: today },
            ],
            error: null,
          },
        },
        // previous history (fetchHistoryIn for prev window)
        { table: "user_video_history", response: { data: [], error: null } },
      ],
      {
        getUserById: (id: string) => {
          const map: Record<string, string> = {
            u1: "user1@example.com",
            u2: "user2@example.com",
          };
          return { data: { user: { email: map[id] } }, error: null };
        },
      },
    );

    const kpis = await getDashboardKPIs(client, window);
    expect(kpis.summaries.current).toBe(2);
    expect(kpis.summaries.previous).toBe(1);
    expect(kpis.whisper.current).toBe(1);
    expect(kpis.sourceMix.find((m) => m.source === "whisper")?.count).toBe(1);
    expect(kpis.topUsers).toHaveLength(2);
    expect(kpis.topUsers[0].userId).toBe("u1"); // 2 history rows beats u2's 1
    expect(kpis.topUsers[0].email).toBe("user1@example.com");
    expect(kpis.cacheHitRatePct.current).toBeGreaterThanOrEqual(0);
  });
});

describe("getPerformanceStats", () => {
  it("computes p50/p95 plus per-day buckets", async () => {
    const window = lastNDays(2);
    const today = window.end.toISOString();
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: [
            { id: "s1", video_id: "v1", transcript_source: "whisper", processing_time_seconds: 10, transcribe_time_seconds: 8, summarize_time_seconds: 2, created_at: today },
            { id: "s2", video_id: "v2", transcript_source: "auto_captions", processing_time_seconds: 5, transcribe_time_seconds: 3, summarize_time_seconds: 2, created_at: today },
            { id: "s3", video_id: "v3", transcript_source: "auto_captions", processing_time_seconds: 12, transcribe_time_seconds: 9, summarize_time_seconds: 3, created_at: today },
          ],
          error: null,
        },
      },
      { table: "summaries", response: { data: [], error: null } }, // prev window
    ]);
    const stats = await getPerformanceStats(client, window);
    expect(stats.p50Seconds).toBeGreaterThan(0);
    expect(stats.p95Seconds).toBeGreaterThanOrEqual(stats.p50Seconds!);
    expect(stats.latencyByBucket.length).toBeGreaterThan(0);
  });

  it("returns null percentiles when there's no data", async () => {
    const window = lastNDays(2);
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
    ]);
    const stats = await getPerformanceStats(client, window);
    expect(stats.p50Seconds).toBeNull();
    expect(stats.p95Seconds).toBeNull();
  });
});

describe("getUserSummaries", () => {
  it("normalizes nested join shapes into flat rows", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            {
              video_id: "v1",
              created_at: "2026-04-29T12:00:00Z",
              videos: {
                title: "How LLMs work",
                channel_name: "AI Show",
                language: "en",
              },
              summaries: {
                summaries: [
                  {
                    id: "sum-1",
                    transcript_source: "whisper",
                    model: "claude-opus-4-7",
                    processing_time_seconds: 10,
                    enable_thinking: false,
                  },
                ],
              },
            },
          ],
          error: null,
        },
      },
    ]);
    const rows = await getUserSummaries(client, "u1", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].videoTitle).toBe("How LLMs work");
    expect(rows[0].source).toBe("whisper");
    expect(rows[0].model).toBe("claude-opus-4-7");
  });
});
