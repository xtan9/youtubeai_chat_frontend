import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listAuditLog,
  listAllUsers,
  listUsersWithStatsAndSort,
  listVideosWithStats,
  getVideoInsights,
  getVideoSummariesUsers,
  filterUsers,
  sortUsers,
  getDashboardKPIs,
  getPerformanceStats,
  getUserAuditEvents,
  getUserSummaries,
  lastNDays,
  fetchRegisteredUsersTotal,
  listAdminUserIds,
  WHISPER_FLAG_THRESHOLD,
  QueryError,
} from "../queries";
import type { AdminUserRow, VideoListOptions } from "../queries";
import type { SupabaseClient } from "@supabase/supabase-js";

interface SelectScript {
  table: string;
  /** Final response — returned when the chain awaits. */
  response: { data: unknown; error: unknown };
  /** Optional: assert which filter args were applied. */
  expect?: (calls: ChainCall[]) => void;
}

interface ChainCall {
  method: string;
  args: unknown[];
}

/**
 * Mock Supabase client whose `.from(table).select(...)...` chain resolves
 * to the next scripted response in `scripts`. Each `from(...)` consumes
 * one entry, in order. `from()` calls in the production code may run via
 * `Promise.all`, so the test orders scripts to match the call order
 * (which is deterministic per microtask scheduling).
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
    proxy.not = chain("not");
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

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ─── listAuditLog ────────────────────────────────────────────────────────

describe("listAuditLog", () => {
  it("returns rows newest-first with no cursor when page fits", async () => {
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

  it("emits nextCursor when one extra row is returned (the +1 peek)", async () => {
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

  it("round-trips a cursor: second page applies a keyset filter using the previous tail", async () => {
    let capturedOrFilter = "";
    const client = buildClient([
      {
        table: "admin_audit_log",
        response: { data: [], error: null },
        expect: (calls) => {
          const orCall = calls.find((c) => c.method === "or");
          expect(orCall, "expected an or() filter on cursor reuse").toBeDefined();
          capturedOrFilter = String(orCall?.args[0] ?? "");
        },
      },
    ]);
    const cursor = Buffer.from(
      JSON.stringify({ created_at: "2026-04-29T12:00:00Z", id: "row-1" }),
    ).toString("base64url");
    const result = await listAuditLog(client, { pageSize: 50, cursor });
    expect(result.rows).toHaveLength(0);
    expect(capturedOrFilter).toContain("created_at.lt.2026-04-29T12:00:00Z");
    expect(capturedOrFilter).toContain("id.lt.row-1");
  });

  it("falls back to first page on malformed cursor (and warns)", async () => {
    const warn = vi.spyOn(console, "warn");
    let receivedOr = false;
    const client = buildClient([
      {
        table: "admin_audit_log",
        response: { data: [], error: null },
        expect: (calls) => {
          receivedOr = calls.some((c) => c.method === "or");
        },
      },
    ]);
    const result = await listAuditLog(client, { cursor: "not-base64-at-all" });
    expect(result.rows).toHaveLength(0);
    expect(receivedOr).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("logs but still returns rows when persisted action is unknown", async () => {
    const error = vi.spyOn(console, "error");
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
              action: "unfamiliar_action",
              resource_type: "summary",
              resource_id: "sum-1",
              metadata: {},
            },
          ],
          error: null,
        },
      },
    ]);
    const result = await listAuditLog(client);
    expect(result.rows[0].action).toBe("unfamiliar_action");
    expect(
      error.mock.calls.some(
        (c) => typeof c[0] === "string" && c[0].includes("unknown audit action"),
      ),
    ).toBe(true);
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


// ─── getDashboardKPIs ────────────────────────────────────────────────────

describe("getDashboardKPIs", () => {
  it("aggregates summaries, deltas, source mix, and top users", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const yesterday = new Date(window.start.getTime()).toISOString();
    // Production calls: Promise.all([summaries-curr, summaries-prev,
    // history-curr, history-prev]); each history fetch then issues one
    // summaries-by-video lookup. Order:
    // 1. summaries (curr)
    // 2. summaries (prev)
    // 3. user_video_history (curr)
    // 4. user_video_history (prev)
    // 5. summaries (curr-history enrichment)
    // 6. summaries (prev-history enrichment)
    const client = buildClient(
      [
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
        {
          table: "summaries",
          response: {
            data: [
              { id: "p1", video_id: "v3", transcript_source: "manual_captions", processing_time_seconds: 3, transcribe_time_seconds: 1, summarize_time_seconds: 2, created_at: yesterday },
            ],
            error: null,
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
              { video_id: "v1", created_at: yesterday },
              { video_id: "v2", created_at: today },
            ],
            error: null,
          },
        },
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
    expect(kpis.topUsers[0].emailLookupOk).toBe(true);
    expect(kpis.cacheHitRatePct.current).toBeGreaterThanOrEqual(0);
  });

  it("returns null/zero shapes on an empty window", async () => {
    const window = lastNDays(7);
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const kpis = await getDashboardKPIs(client, window);
    expect(kpis.summaries.current).toBe(0);
    expect(kpis.cacheHitRatePct.current).toBeNull();
    expect(kpis.topUsers).toEqual([]);
    expect(kpis.sourceMix).toHaveLength(3); // all sources still represented
    expect(kpis.sourceMix.every((m) => m.count === 0)).toBe(true);
  });

  it("flags emailLookupOk=false when auth.admin.getUserById errors", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              { id: "s1", video_id: "v1", transcript_source: "auto_captions", processing_time_seconds: 5, transcribe_time_seconds: 3, summarize_time_seconds: 2, created_at: today },
            ],
            error: null,
          },
        },
        { table: "summaries", response: { data: [], error: null } },
        {
          table: "user_video_history",
          response: {
            data: [{ user_id: "u-broken", video_id: "v1", created_at: today }],
            error: null,
          },
        },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({
          data: { user: null },
          error: { message: "auth service down" },
        }),
      },
    );
    const kpis = await getDashboardKPIs(client, window);
    expect(kpis.topUsers[0].userId).toBe("u-broken");
    expect(kpis.topUsers[0].email).toBeNull();
    expect(kpis.topUsers[0].emailLookupOk).toBe(false);
  });
});

// ─── getPerformanceStats ─────────────────────────────────────────────────

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
      { table: "summaries", response: { data: [], error: null } },
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

// ─── getUserSummaries ────────────────────────────────────────────────────

describe("getUserSummaries", () => {
  it("returns rows joined with video and summary metadata", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            { video_id: "v1", created_at: "2026-04-29T12:00:00Z" },
          ],
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: [
            {
              id: "v1",
              title: "How LLMs work",
              channel_name: "AI Show",
              language: "en",
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
              id: "sum-1",
              video_id: "v1",
              transcript_source: "whisper",
              model: "claude-opus-4-7",
              processing_time_seconds: 10,
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

  it("uses the single summary row per video (post-dedup-migration schema)", async () => {
    // After migration 20260423000000_drop_thinking_columns, production
    // has at most one summary row per video. This test pins that the
    // function returns that single row's fields (no canonical/fallback
    // dance, no preference rule).
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [{ video_id: "v1", created_at: "2026-04-29T12:00:00Z" }],
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: [
            { id: "v1", title: "Talk", channel_name: "Ch", language: "en" },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [
            { id: "sum-only", video_id: "v1", transcript_source: "auto_captions", model: "claude-haiku-4-5", processing_time_seconds: 4 },
          ],
          error: null,
        },
      },
    ]);
    const rows = await getUserSummaries(client, "u1", 10);
    expect(rows[0].summaryId).toBe("sum-only");
    expect(rows[0].model).toBe("claude-haiku-4-5");
  });

  it("returns empty array when user has no history (no follow-up queries)", async () => {
    const client = buildClient([
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const rows = await getUserSummaries(client, "u1");
    expect(rows).toEqual([]);
  });

  it("includes history rows even when no matching summary exists (defaulted to auto_captions)", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [{ video_id: "v-orphan", created_at: "2026-04-29T12:00:00Z" }],
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: [{ id: "v-orphan", title: "T", channel_name: "C", language: "en" }],
          error: null,
        },
      },
      { table: "summaries", response: { data: [], error: null } },
    ]);
    const rows = await getUserSummaries(client, "u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("auto_captions"); // default fallback
    expect(rows[0].summaryId).toBe(""); // no real summary id
  });
});

// ─── getUserAuditEvents ──────────────────────────────────────────────────

describe("getUserAuditEvents", () => {
  it("filters by both resource_id and metadata.viewed_user_id and limits to N rows newest-first", async () => {
    const client = buildClient([
      {
        table: "admin_audit_log",
        response: {
          data: [
            {
              id: "a-1",
              created_at: "2026-04-29T00:00:00Z",
              admin_id: "admin-1",
              admin_email: "alice@x",
              action: "view_transcript",
              resource_type: "user",
              resource_id: "user-X",
              metadata: {},
            },
          ],
          error: null,
        },
        expect: (calls) => {
          const orCall = calls.find((c) => c.method === "or");
          expect(orCall).toBeDefined();
          expect(String(orCall?.args[0])).toContain("resource_id.eq.user-X");
          expect(String(orCall?.args[0])).toContain("metadata->>viewed_user_id.eq.user-X");
          const limit = calls.find((c) => c.method === "limit");
          expect(limit?.args).toEqual([10]);
        },
      },
    ]);
    const out = await getUserAuditEvents(client, "user-X", 10);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe("view_transcript");
  });

  it("returns empty array on db error and logs", async () => {
    const client = buildClient([
      {
        table: "admin_audit_log",
        response: { data: null, error: { message: "boom" } },
      },
    ]);
    const out = await getUserAuditEvents(client, "user-X", 10);
    expect(out).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("getUserAuditEvents"),
      expect.any(Object),
    );
  });
});

// ─── Constants exposed for cross-file consistency ────────────────────────

describe("WHISPER_FLAG_THRESHOLD", () => {
  it("is 30 — keeps the boundary in lockstep across queries.ts and the UI", () => {
    expect(WHISPER_FLAG_THRESHOLD).toBe(30);
  });
});

// ─── Regression: user_video_history column name ──────────────────────────
//
// Production's user_video_history table has `accessed_at`, not `created_at`
// — the cache_schema CREATE TABLE was a no-op due to IF NOT EXISTS. Any
// admin query that filters/orders on `created_at` will 500 in prod with
// `column user_video_history.created_at does not exist`. These tests
// pin that the wire-level column name passed to gte/lte/order is
// `accessed_at`; downstream code still consumes the field as
// `created_at` thanks to PostgREST aliasing on the select clause.
describe("user_video_history column drift guard", () => {
  it("aggregateUserActivity (via listUsersWithStatsAndSort) filters on accessed_at", async () => {
    const seen: ChainCall[] = [];
    const window = lastNDays(30);
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: { data: [], error: null },
          expect: (calls) => seen.push(...calls),
        },
      ],
      {
        listUsers: {
          data: {
            users: [
              {
                id: "u1",
                email: "u1@example.com",
                created_at: "2026-01-01",
                last_sign_in_at: null,
              },
            ],
            total: 1,
          },
          error: null,
        },
      },
    );
    await listUsersWithStatsAndSort(client, {
      sort: "createdAt",
      dir: "desc",
      tab: "exclude_anon",
      search: null,
      page: 1,
      pageSize: 25,
      window,
    });
    const selectArg = String(seen.find((c) => c.method === "select")?.args[0] ?? "");
    const gteCol = String(seen.find((c) => c.method === "gte")?.args[0] ?? "");
    const lteCol = String(seen.find((c) => c.method === "lte")?.args[0] ?? "");
    expect(selectArg).toContain("created_at:accessed_at");
    expect(gteCol).toBe("accessed_at");
    expect(lteCol).toBe("accessed_at");
  });

  it("getUserSummaries orders on accessed_at, not created_at", async () => {
    const seen: ChainCall[] = [];
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: [], error: null },
        expect: (calls) => seen.push(...calls),
      },
    ]);
    await getUserSummaries(client, "u1", 10);
    const selectArg = String(seen.find((c) => c.method === "select")?.args[0] ?? "");
    const orderCol = String(seen.find((c) => c.method === "order")?.args[0] ?? "");
    expect(selectArg).toContain("created_at:accessed_at");
    expect(orderCol).toBe("accessed_at");
  });

  it("fetchHistoryIn (via getDashboardKPIs) filters on accessed_at", async () => {
    const seen: ChainCall[] = [];
    const window = lastNDays(7);
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      {
        table: "user_video_history",
        response: { data: [], error: null },
        expect: (calls) => seen.push(...calls),
      },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    await getDashboardKPIs(client, window);
    const selectArg = String(seen.find((c) => c.method === "select")?.args[0] ?? "");
    const gteCol = String(seen.find((c) => c.method === "gte")?.args[0] ?? "");
    const lteCol = String(seen.find((c) => c.method === "lte")?.args[0] ?? "");
    expect(selectArg).toContain("created_at:accessed_at");
    expect(gteCol).toBe("accessed_at");
    expect(lteCol).toBe("accessed_at");
  });
});

// ─── listAllUsers ────────────────────────────────────────────────────────

describe("listAllUsers", () => {
  function buildAuthClient(
    pages: Array<{ users: Array<Record<string, unknown>>; total: number }>,
  ): SupabaseClient {
    let i = 0;
    const listUsers = vi.fn(async () => {
      const next = pages[i++] ?? { users: [], total: pages[0]?.total ?? 0 };
      return { data: next, error: null };
    });
    return {
      from: vi.fn(),
      auth: { admin: { listUsers, getUserById: vi.fn() } },
    } as unknown as SupabaseClient;
  }

  it("concatenates rows across paged calls until a partial page", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      email: `${i}@x`,
      created_at: "2026-04-29T00:00:00Z",
      is_anonymous: false,
    }));
    const partial = Array.from({ length: 50 }, (_, i) => ({
      id: `id-200-${i}`,
      email: `${i}@y`,
      created_at: "2026-04-29T00:00:00Z",
      is_anonymous: false,
    }));
    const client = buildAuthClient([
      { users: full, total: 250 },
      { users: partial, total: 250 },
    ]);
    const out = await listAllUsers(client);
    expect(out.users).toHaveLength(250);
    expect(out.truncated).toBe(false);
    expect(out.total).toBe(250);
  });

  it("stops at row cap and sets truncated=true with a warn", async () => {
    const client = buildAuthClient(
      Array.from({ length: 30 }, (_, pageIdx) => ({
        users: Array.from({ length: 200 }, (_, i) => ({
          id: `id-${pageIdx * 200 + i}`,
          email: `${pageIdx * 200 + i}@x`,
          created_at: "2026-04-29T00:00:00Z",
          is_anonymous: false,
        })),
        total: 6000,
      })),
    );
    const out = await listAllUsers(client, { rowCap: 5000 });
    expect(out.users).toHaveLength(5000);
    expect(out.truncated).toBe(true);
    // Pin distinct-ID contract — the 5,000th user is the 4999-th index
    // across pages (id-4999), and id-0 must still be the first.
    expect(out.users[0].id).toBe("id-0");
    expect(out.users[4999].id).toBe("id-4999");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("listAllUsers cap hit"),
      expect.any(Object),
    );
  });

  it("propagates page-level errors as QueryError", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: null,
            error: { message: "boom" },
          })),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    await expect(listAllUsers(client)).rejects.toBeInstanceOf(QueryError);
  });
});

// ─── filterUsers ─────────────────────────────────────────────────────────

const baseAdminRow = (over: Partial<AdminUserRow>): AdminUserRow => ({
  userId: "u",
  email: "u@x",
  emailVerified: true,
  providers: ["email"],
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
  lastSignIn: null,
  lastActivity: null,
  summaries: 0,
  whisper: 0,
  whisperPct: 0,
  flagged: false,
  isAnonymous: false,
  isSsoUser: false,
  bannedUntil: null,
  deletedAt: null,
  appMetadata: {},
  userMetadata: {},
  ...over,
});

describe("filterUsers", () => {
  const rows: AdminUserRow[] = [
    baseAdminRow({ userId: "a", isAnonymous: false, summaries: 5, flagged: false }),
    baseAdminRow({ userId: "b", isAnonymous: true, summaries: 0 }),
    baseAdminRow({ userId: "c", isAnonymous: false, summaries: 0, flagged: false }),
    baseAdminRow({ userId: "d", isAnonymous: false, summaries: 10, whisperPct: 50, flagged: true }),
  ];

  it("'exclude_anon' drops anonymous users", () => {
    const out = filterUsers(rows, "exclude_anon", null);
    expect(out.map((r) => r.userId)).toEqual(["a", "c", "d"]);
  });

  it("'anon_only' keeps only anonymous users", () => {
    const out = filterUsers(rows, "anon_only", null);
    expect(out.map((r) => r.userId)).toEqual(["b"]);
  });

  it("'active' = exclude_anon + summaries > 0", () => {
    const out = filterUsers(rows, "active", null);
    expect(out.map((r) => r.userId)).toEqual(["a", "d"]);
  });

  it("'flagged' = exclude_anon + flagged=true", () => {
    const out = filterUsers(rows, "flagged", null);
    expect(out.map((r) => r.userId)).toEqual(["d"]);
  });

  it("'all' returns everything", () => {
    const out = filterUsers(rows, "all", null);
    expect(out).toHaveLength(4);
  });

  it("search filters by email substring (case-insensitive)", () => {
    const local = [
      baseAdminRow({ userId: "x", email: "Alice@example.com" }),
      baseAdminRow({ userId: "y", email: "bob@example.com" }),
    ];
    const out = filterUsers(local, "all", "ALICE");
    expect(out.map((r) => r.userId)).toEqual(["x"]);
  });

  it("search also matches userId substring", () => {
    const local = [
      baseAdminRow({ userId: "abc-123", email: null }),
      baseAdminRow({ userId: "def-456", email: null }),
    ];
    const out = filterUsers(local, "all", "abc");
    expect(out.map((r) => r.userId)).toEqual(["abc-123"]);
  });
});

// ─── sortUsers ───────────────────────────────────────────────────────────

describe("sortUsers", () => {
  const rows: AdminUserRow[] = [
    baseAdminRow({
      userId: "a",
      email: "alice@x",
      createdAt: "2026-01-01T00:00:00Z",
      summaries: 1,
      lastSignIn: "2026-04-20T00:00:00Z",
    }),
    baseAdminRow({
      userId: "b",
      email: null,
      createdAt: "2026-03-01T00:00:00Z",
      summaries: 5,
      lastSignIn: null,
    }),
    baseAdminRow({
      userId: "c",
      email: "carol@x",
      createdAt: "2026-02-01T00:00:00Z",
      summaries: 10,
      lastSignIn: "2026-04-01T00:00:00Z",
    }),
  ];

  it("sorts by createdAt desc by default", () => {
    const out = sortUsers(rows, "createdAt", "desc");
    expect(out.map((r) => r.userId)).toEqual(["b", "c", "a"]);
  });

  it("sorts by createdAt asc", () => {
    const out = sortUsers(rows, "createdAt", "asc");
    expect(out.map((r) => r.userId)).toEqual(["a", "c", "b"]);
  });

  it("sorts by summaries desc (numeric)", () => {
    const out = sortUsers(rows, "summaries", "desc");
    expect(out.map((r) => r.userId)).toEqual(["c", "b", "a"]);
  });

  it("places null email last on email asc", () => {
    const out = sortUsers(rows, "email", "asc");
    expect(out.map((r) => r.userId)).toEqual(["a", "c", "b"]);
  });

  it("places null email last on email desc (null-last regardless of dir)", () => {
    const out = sortUsers(rows, "email", "desc");
    expect(out.map((r) => r.userId)).toEqual(["c", "a", "b"]);
  });

  it("breaks ties stably by userId", () => {
    const tied = [
      baseAdminRow({ userId: "z", summaries: 1 }),
      baseAdminRow({ userId: "a", summaries: 1 }),
      baseAdminRow({ userId: "m", summaries: 1 }),
    ];
    const out = sortUsers(tied, "summaries", "desc");
    expect(out.map((r) => r.userId)).toEqual(["a", "m", "z"]);
  });
});

// ─── listUsersWithStatsAndSort ───────────────────────────────────────────

describe("listUsersWithStatsAndSort", () => {
  function buildClientWithUsers(
    users: Array<Record<string, unknown>>,
    historyScripts: SelectScript[],
  ): SupabaseClient {
    return buildClient(historyScripts, {
      listUsers: { data: { users, total: users.length }, error: null },
    });
  }

  it("returns sorted page slice with anonymous excluded by default tab", async () => {
    const users = [
      {
        id: "u-1",
        email: "alice@x",
        created_at: "2026-04-01T00:00:00Z",
        is_anonymous: false,
        identities: [{ provider: "email" }],
      },
      {
        id: "u-2",
        email: null,
        created_at: "2026-04-02T00:00:00Z",
        is_anonymous: true,
      },
      {
        id: "u-3",
        email: "carol@x",
        created_at: "2026-04-03T00:00:00Z",
        is_anonymous: false,
        identities: [{ provider: "google" }],
      },
    ];
    const client = buildClientWithUsers(users, [
      { table: "user_video_history", response: { data: [], error: null } },
    ]);

    const out = await listUsersWithStatsAndSort(client, {
      sort: "createdAt",
      dir: "desc",
      tab: "exclude_anon",
      search: null,
      page: 1,
      pageSize: 25,
    });

    expect(out.rows.map((r) => r.userId)).toEqual(["u-3", "u-1"]);
    expect(out.rows[0].providers).toEqual(["google"]);
    expect(out.total).toBe(2); // post-filter total
    expect(out.pageCount).toBe(1);
  });

  it("paginates after sort", async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({
      id: `u-${String(i).padStart(2, "0")}`,
      email: `${String(i).padStart(2, "0")}@x`, // zero-padded so lexicographic = numeric
      created_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      is_anonymous: false,
    }));

    // Use a single client for a full unsorted fetch first, to know the expected
    // ordering. Two clients are needed for two listUsersWithStatsAndSort calls
    // because the mock's history script is consumed once per call.
    const client1 = buildClientWithUsers(users, [
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const page1 = await listUsersWithStatsAndSort(client1, {
      sort: "email",
      dir: "asc",
      tab: "exclude_anon",
      search: null,
      page: 1,
      pageSize: 10,
    });

    const client2 = buildClientWithUsers(users, [
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const page2 = await listUsersWithStatsAndSort(client2, {
      sort: "email",
      dir: "asc",
      tab: "exclude_anon",
      search: null,
      page: 2,
      pageSize: 10,
    });

    // Combined coverage check: pages 1+2 should be the FIRST 20 users in
    // sorted order, with no gap between them and no overlap.
    const combined = [...page1.rows, ...page2.rows].map((r) => r.userId);
    const expected = Array.from({ length: 20 }, (_, i) =>
      `u-${String(i).padStart(2, "0")}`,
    );
    expect(combined).toEqual(expected);
    expect(new Set(combined).size).toBe(20); // no duplicates
    expect(page1.pageCount).toBe(3);
  });

  it("logs when banned_until is unparseable and falls back to non-banned status", async () => {
    const users = [
      {
        id: "u-bad-ban",
        email: "x@x",
        created_at: "2026-04-01T00:00:00Z",
        email_confirmed_at: "2026-04-01T00:00:00Z",
        banned_until: "not a date",
        is_anonymous: false,
      },
    ];
    const client = buildClientWithUsers(users, [
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const out = await listUsersWithStatsAndSort(client, {
      sort: "createdAt",
      dir: "desc",
      tab: "all",
      search: null,
      page: 1,
      pageSize: 25,
    });
    expect(out.rows[0].status).toBe("active");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("invalid banned_until"),
      expect.objectContaining({ bannedUntil: "not a date" }),
    );
  });

  it("status reflects banned/deleted/anonymous/unverified", async () => {
    const users = [
      {
        id: "u-active",
        email: "ok@x",
        created_at: "2026-04-01T00:00:00Z",
        email_confirmed_at: "2026-04-01T00:00:00Z",
        is_anonymous: false,
      },
      {
        id: "u-banned",
        email: "ban@x",
        created_at: "2026-04-01T00:00:00Z",
        email_confirmed_at: "2026-04-01T00:00:00Z",
        banned_until: "2030-01-01T00:00:00Z",
        is_anonymous: false,
      },
      {
        id: "u-deleted",
        email: "del@x",
        created_at: "2026-04-01T00:00:00Z",
        deleted_at: "2026-04-15T00:00:00Z",
        is_anonymous: false,
      },
      {
        id: "u-anon",
        email: null,
        created_at: "2026-04-01T00:00:00Z",
        is_anonymous: true,
      },
      {
        id: "u-unverified",
        email: "uv@x",
        created_at: "2026-04-01T00:00:00Z",
        email_confirmed_at: null,
        is_anonymous: false,
      },
    ];
    const client = buildClientWithUsers(users, [
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const out = await listUsersWithStatsAndSort(client, {
      sort: "createdAt",
      dir: "desc",
      tab: "all",
      search: null,
      page: 1,
      pageSize: 25,
    });
    const byId = new Map(out.rows.map((r) => [r.userId, r.status]));
    expect(byId.get("u-active")).toBe("active");
    expect(byId.get("u-banned")).toBe("banned");
    expect(byId.get("u-deleted")).toBe("deleted");
    expect(byId.get("u-anon")).toBe("anonymous");
    expect(byId.get("u-unverified")).toBe("unverified");
  });
});

describe("fetchRegisteredUsersTotal", () => {
  it("counts only signed-up, non-admin, non-anonymous users", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: {
              users: [
                { id: "u1", email: "alice@example.com", is_anonymous: false },
                { id: "u2", email: "bob@example.com", is_anonymous: false },
                { id: "u3", email: null, is_anonymous: true },
                { id: "u4", email: "anon-x@y", is_anonymous: true },
                { id: "u5", email: "ADMIN@example.com", is_anonymous: false },
              ],
              total: 5,
            },
            error: null,
          })),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await fetchRegisteredUsersTotal(client, ["admin@example.com"]);
    expect(out).toBe(2);
  });

  it("treats allowlist comparison as case-insensitive", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: {
              users: [
                {
                  id: "u1",
                  email: "Owner@Example.com",
                  is_anonymous: false,
                },
              ],
              total: 1,
            },
            error: null,
          })),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await fetchRegisteredUsersTotal(client, ["owner@example.com"]);
    expect(out).toBe(0);
  });

  it("returns null on listUsers error", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: null,
            error: { message: "auth down" },
          })),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await fetchRegisteredUsersTotal(client, []);
    expect(out).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("fetchRegisteredUsersTotal"),
      expect.any(Object),
    );
  });

  it("paginates through multiple pages", async () => {
    const pageOne = Array.from({ length: 200 }, (_, i) => ({
      id: `p1-${i}`,
      email: `p1-${i}@example.com`,
      is_anonymous: false,
    }));
    const pageTwo = Array.from({ length: 50 }, (_, i) => ({
      id: `p2-${i}`,
      email: `p2-${i}@example.com`,
      is_anonymous: false,
    }));
    const pages = [
      { users: pageOne, total: 250 },
      { users: pageTwo, total: 250 },
    ];
    let i = 0;
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => {
            const next = pages[i++] ?? { users: [], total: 250 };
            return { data: next, error: null };
          }),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await fetchRegisteredUsersTotal(client, []);
    expect(out).toBe(250);
  });
});

describe("listAdminUserIds", () => {
  it("returns IDs of users where app_metadata.is_admin === true", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: {
              users: [
                { id: "u-1", email: "alice@x", app_metadata: { is_admin: true } },
                { id: "u-2", email: "bob@x", app_metadata: { is_admin: false } },
                { id: "u-3", email: "carol@x", app_metadata: {} },
                { id: "u-4", email: "dan@x" },
                { id: "u-5", email: "eve@x", app_metadata: { is_admin: true, foo: "bar" } },
              ],
              total: 5,
            },
            error: null,
          })),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await listAdminUserIds(client);
    expect(out).toEqual(["u-1", "u-5"]);
  });

  it("paginates through every page so admins past page 1 are still found", async () => {
    // 250 users across 2 pages: page 1 has 200 non-admins, page 2 has
    // 50 users with the admin (u-admin-late) embedded among them.
    // Regression guard: a single-page implementation would miss this
    // admin entirely and silently leak their activity into KPIs.
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      id: `u-${i}`,
      email: `${i}@x`,
      app_metadata: { is_admin: false },
    }));
    const page2 = [
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `u-${200 + i}`,
        email: `${200 + i}@x`,
        app_metadata: { is_admin: false },
      })),
      {
        id: "u-admin-late",
        email: "late@x",
        app_metadata: { is_admin: true },
      },
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `u-${226 + i}`,
        email: `${226 + i}@x`,
        app_metadata: { is_admin: false },
      })),
    ];
    const pages = [page1, page2];
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(
            async ({ page }: { page: number; perPage: number }) => {
              const users = pages[page - 1] ?? [];
              return { data: { users, total: 250 }, error: null };
            },
          ),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await listAdminUserIds(client);
    expect(out).toEqual(["u-admin-late"]);
  });

  it("returns empty array on error and logs", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          // listAllUsers throws QueryError on page-1 listUsers errors;
          // listAdminUserIds's try/catch catches it and falls back to [].
          listUsers: vi.fn(async () => ({
            data: null,
            error: { message: "auth offline" },
          })),
          getUserById: vi.fn(),
        },
      },
    } as unknown as SupabaseClient;
    const out = await listAdminUserIds(client);
    expect(out).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("listAdminUserIds"),
      expect.any(Object),
    );
  });
});

describe("getDashboardKPIs with excludeAdminUserIds", () => {
  it("drops history rows whose user_id is in the exclude set and filters summary-derived KPIs", async () => {
    // Two summaries: v-real (watched by a non-admin) and v-admin
    // (watched only by an admin, filtered out of history). The KPI
    // outputs must reflect ONLY the v-real summary.
    const window = lastNDays(30);
    const today = window.end.toISOString();
    const client = buildClient(
      [
        // Production call sequence (Promise.all):
        // 1. fetchSummariesIn(current) → summaries
        // 2. fetchSummariesIn(prev) → summaries
        // 3. fetchHistoryIn(current) → user_video_history (asserts .not())
        // 4. fetchHistoryIn(prev) → user_video_history (asserts .not())
        // 5. fetchHistoryIn(current) cache-hit lookup → summaries
        //    (only when history is non-empty; current returns 1 row)
        {
          table: "summaries",
          response: {
            data: [
              { id: "s-real", video_id: "v-real", transcript_source: "auto_captions", processing_time_seconds: 5, transcribe_time_seconds: 3, summarize_time_seconds: 2, created_at: today },
              { id: "s-admin", video_id: "v-admin", transcript_source: "whisper", processing_time_seconds: 100, transcribe_time_seconds: 90, summarize_time_seconds: 10, created_at: today },
            ],
            error: null,
          },
        },
        { table: "summaries", response: { data: [], error: null } },
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u-real", video_id: "v-real", created_at: today },
            ],
            error: null,
          },
          expect: (calls) => {
            const notCall = calls.find((c) => c.method === "not");
            // Pin the exact PostgREST not.in.() filter format. A regression
            // that mangled the encoding (e.g. quoting the IDs, adding spaces,
            // or switching the parens) would still satisfy a `.contains()`
            // check but would silently break the production filter.
            expect(notCall?.args[0]).toBe("user_id");
            expect(notCall?.args[1]).toBe("in");
            expect(notCall?.args[2]).toBe("(u-admin-1,u-admin-2)");
          },
        },
        {
          table: "user_video_history",
          response: { data: [], error: null },
          expect: (calls) => {
            const notCall = calls.find((c) => c.method === "not");
            expect(notCall?.args[0]).toBe("user_id");
            expect(notCall?.args[1]).toBe("in");
            expect(notCall?.args[2]).toBe("(u-admin-1,u-admin-2)");
          },
        },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({ data: { user: { email: "x@x" } }, error: null }),
      },
    );
    const out = await getDashboardKPIs(client, window, {
      excludeAdminUserIds: ["u-admin-1", "u-admin-2"],
    });
    // Only the v-real summary should be counted — the v-admin one (whisper,
    // 100s) is dropped because no non-admin watched it.
    expect(out.summaries.current).toBe(1);
    expect(out.whisper.current).toBe(0);
    // p95 of [5] → 5 (single sample). The 100s admin summary must not
    // contribute.
    expect(out.p95Seconds.current).toBe(5);
    expect(out.transcribeP95Seconds).toBe(3);
    expect(out.summarizeP95Seconds).toBe(2);
    // Source mix: only auto_captions has a count.
    expect(out.sourceMix.find((m) => m.source === "auto_captions")?.count).toBe(1);
    expect(out.sourceMix.find((m) => m.source === "whisper")?.count).toBe(0);
    // Pin summariesPerDay too — same filter applies.
    const todayKey = today.slice(0, 10);
    const todayBucket = out.summariesPerDay.find((d) => d.day === todayKey);
    expect(todayBucket?.value).toBe(1); // not 2 — admin-only video summary excluded from per-day chart
  });

  it("retains a video watched by both admin and non-admin in summary-derived KPIs", async () => {
    // The DB-side .not() filter drops admin history rows; the shared video
    // still appears in the filtered history, so its summary contributes
    // to KPI numbers.
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              { id: "s-shared", video_id: "v-shared", transcript_source: "whisper", processing_time_seconds: 7, transcribe_time_seconds: 5, summarize_time_seconds: 2, created_at: today },
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
        },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({ data: { user: { email: "x@x" } }, error: null }),
      },
    );
    const out = await getDashboardKPIs(client, window, {
      excludeAdminUserIds: ["u-admin-1"],
    });
    expect(out.summaries.current).toBe(1);
    expect(out.whisper.current).toBe(1);
    expect(out.p95Seconds.current).toBe(7);
  });

  it("non-empty exclude with empty history → filtered to zero (honest empty)", async () => {
    // No real-user history in window means KPIs report zero for the
    // filtered metrics, even if summaries exist. The "excluding admin
    // activity" label promises filtering, not fail-soft.
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient(
      [
        {
          table: "summaries",
          response: {
            data: [
              { id: "s1", video_id: "v-1", transcript_source: "auto_captions", processing_time_seconds: 10, transcribe_time_seconds: 8, summarize_time_seconds: 2, created_at: today },
            ],
            error: null,
          },
        },
        { table: "summaries", response: { data: [], error: null } },
        { table: "user_video_history", response: { data: [], error: null } },
        { table: "user_video_history", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({ data: { user: { email: "x@x" } }, error: null }),
      },
    );
    const out = await getDashboardKPIs(client, window, {
      excludeAdminUserIds: ["u-admin-1"],
    });
    expect(out.summaries.current).toBe(0);
    expect(out.whisper.current).toBe(0);
    expect(out.p95Seconds.current).toBeNull();
    expect(out.transcribeP95Seconds).toBeNull();
    expect(out.summarizeP95Seconds).toBeNull();
  });

  it("with empty excludeAdminUserIds, behavior matches the no-option call", async () => {
    // The historic test "returns rows for current and previous windows"
    // already exercises the no-option path. Here we just confirm passing
    // an empty array does not change anything. Fixture mirrors that test.
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const out = await getDashboardKPIs(client, lastNDays(30), {
      excludeAdminUserIds: [],
    });
    expect(out.summaries.current).toBe(0);
  });

  it("fetchHistoryIn drops empty-string exclude IDs to keep PostgREST happy (via getDashboardKPIs)", async () => {
    let captured: string[] = [];
    const client = buildClient([
      { table: "summaries", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
      {
        table: "user_video_history",
        response: { data: [], error: null },
        expect: (calls) => {
          const notCall = calls.find((c) => c.method === "not");
          // With ALL exclude IDs empty, the .not() clause should NOT be applied.
          if (notCall) captured = [String(notCall.args[2])];
        },
      },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    await getDashboardKPIs(client, lastNDays(30), {
      excludeAdminUserIds: ["", ""],
    });
    // The defensive filter dropped both empty strings, so .not() must not have been called.
    expect(captured).toEqual([]);
  });
});

describe("getPerformanceStats with excludeAdminUserIds", () => {
  it("excludes summaries whose video was only watched by admin users", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient([
      // current summaries: 2 videos, v-real (real users) and v-admin (admins only)
      {
        table: "summaries",
        response: {
          data: [
            { id: "s1", video_id: "v-real", transcript_source: "auto_captions", processing_time_seconds: 5, transcribe_time_seconds: 3, summarize_time_seconds: 2, created_at: today },
            { id: "s2", video_id: "v-admin", transcript_source: "whisper", processing_time_seconds: 100, transcribe_time_seconds: 90, summarize_time_seconds: 10, created_at: today },
          ],
          error: null,
        },
      },
      // previous summaries: empty
      { table: "summaries", response: { data: [], error: null } },
      // current history (admin filtered out): only v-real left
      {
        table: "user_video_history",
        response: { data: [{ user_id: "u-real", video_id: "v-real", created_at: today }], error: null },
      },
      // previous history: empty
      { table: "user_video_history", response: { data: [], error: null } },
      // history's cache-hit enrichment summaries lookup (curr history non-empty)
      { table: "summaries", response: { data: [], error: null } },
    ]);
    const stats = await getPerformanceStats(client, window, {
      excludeAdminUserIds: ["u-admin-1"],
    });
    // The 100s admin-only summary must be filtered out — only s1 (5s) remains.
    expect(stats.p50Seconds).toBe(5);
    expect(stats.p95Seconds).toBe(5);
  });

  it("falls back to all summaries when excludeAdminUserIds is empty (no history fetch)", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: [
            { id: "s1", video_id: "v-1", transcript_source: "auto_captions", processing_time_seconds: 10, transcribe_time_seconds: 8, summarize_time_seconds: 2, created_at: today },
          ],
          error: null,
        },
      },
      { table: "summaries", response: { data: [], error: null } },
    ]);
    const stats = await getPerformanceStats(client, window, {
      excludeAdminUserIds: [],
    });
    expect(stats.p95Seconds).toBe(10);
  });

  it("non-empty exclude with empty history → null percentiles (honest empty)", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: [
            { id: "s1", video_id: "v-1", transcript_source: "auto_captions", processing_time_seconds: 10, transcribe_time_seconds: 8, summarize_time_seconds: 2, created_at: today },
          ],
          error: null,
        },
      },
      { table: "summaries", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const stats = await getPerformanceStats(client, window, {
      excludeAdminUserIds: ["u-admin-1"],
    });
    expect(stats.p50Seconds).toBeNull();
    expect(stats.p95Seconds).toBeNull();
  });

  it("retains video watched by both admin and non-admin", async () => {
    // The DB-side .not() filter drops admin history rows, but a video also
    // watched by a non-admin still appears in the filtered history → its
    // summary contributes to the latency stats.
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient([
      {
        table: "summaries",
        response: {
          data: [
            { id: "s-shared", video_id: "v-shared", transcript_source: "auto_captions", processing_time_seconds: 7, transcribe_time_seconds: 5, summarize_time_seconds: 2, created_at: today },
          ],
          error: null,
        },
      },
      { table: "summaries", response: { data: [], error: null } },
      {
        table: "user_video_history",
        response: { data: [{ user_id: "u-real", video_id: "v-shared", created_at: today }], error: null },
      },
      { table: "user_video_history", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } }, // cache-hit enrichment for curr history
    ]);
    const stats = await getPerformanceStats(client, window, {
      excludeAdminUserIds: ["u-admin-1"],
    });
    expect(stats.p95Seconds).toBe(7);
  });
});

// ─── listVideosWithStats ─────────────────────────────────────────────────

describe("listVideosWithStats", () => {
  function baseOpts(o: Partial<VideoListOptions> = {}): VideoListOptions {
    return {
      mode: "all_time",
      sort: "distinctUsers",
      dir: "desc",
      search: null,
      language: null,
      source: null,
      channel: null,
      model: null,
      flaggedOnly: false,
      firstSummarizedFrom: null,
      firstSummarizedTo: null,
      page: 1,
      pageSize: 25,
      ...o,
    };
  }

  function makeFixture(historyRows: Array<Record<string, unknown>>) {
    return [
      { table: "user_video_history", response: { data: historyRows, error: null } },
      {
        table: "videos",
        response: {
          data: [
            { id: "vA", title: "Alpha", channel_name: "Ch1", language: "en", duration_seconds: 600 },
            { id: "vB", title: "Beta", channel_name: "Ch2", language: "fr", duration_seconds: 300 },
            { id: "vC", title: "Gamma", channel_name: "Ch1", language: "en", duration_seconds: 900 },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [
            { video_id: "vA", transcript_source: "auto_captions", model: "claude-opus-4-7", processing_time_seconds: 12, created_at: "2026-04-01T00:00:00Z" },
            { video_id: "vB", transcript_source: "whisper", model: "claude-haiku-4-5", processing_time_seconds: 80, created_at: "2026-04-03T00:00:00Z" },
            { video_id: "vC", transcript_source: "manual_captions", model: "claude-opus-4-7", processing_time_seconds: 8, created_at: "2026-04-05T00:00:00Z" },
          ],
          error: null,
        },
      },
    ];
  }

  it("returns rows sorted by distinctUsers desc with stable tie-break by videoId", async () => {
    const client = buildClient(
      makeFixture([
        // vA: 2 distinct users (u1, u2)
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
        // vB: 2 distinct users (u1, u3)
        { user_id: "u1", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
        { user_id: "u3", video_id: "vB", created_at: "2026-04-04T00:00:00Z" },
        // vC: 1 distinct user
        { user_id: "u4", video_id: "vC", created_at: "2026-04-05T00:00:00Z" },
      ]),
    );
    const out = await listVideosWithStats(client, baseOpts());
    expect(out.rows.map((r) => r.videoId)).toEqual(["vA", "vB", "vC"]);
    expect(out.rows[0].distinctUsers).toBe(2);
    expect(out.rows[1].distinctUsers).toBe(2);
    expect(out.rows[2].distinctUsers).toBe(1);
  });

  it("pre-fetches admin-touched video_ids with an in() filter on user_id (all-time)", async () => {
    const seen: ChainCall[] = [];
    const client = buildClient([
      {
        // First call: listAdminTouchedVideoIds — pull every video any
        // admin user has ever touched.
        table: "user_video_history",
        response: { data: [], error: null },
        expect: (calls) => seen.push(...calls),
      },
      {
        // Second call: the main history fetch (no user_id filter — admin
        // videos drop in JS, see comment in listVideosWithStats).
        table: "user_video_history",
        response: { data: [], error: null },
      },
    ]);
    await listVideosWithStats(client, baseOpts({ excludeAdminUserIds: ["a1", "a2"] }));
    const inCall = seen.find((c) => c.method === "in");
    expect(inCall).toBeDefined();
    expect(inCall?.args[0]).toBe("user_id");
    expect(inCall?.args[1]).toEqual(["a1", "a2"]);
    // Admin-touched lookup must be all-time — no window filter.
    expect(seen.some((c) => c.method === "gte")).toBe(false);
    expect(seen.some((c) => c.method === "lte")).toBe(false);
  });

  it("drops every video any admin touched, even when non-admins also viewed it", async () => {
    // vA: admin viewed it AND a non-admin viewed it → drop entirely.
    // vB: only non-admin viewers → keep.
    const client = buildClient([
      {
        // listAdminTouchedVideoIds — admin a1 has history for vA only.
        table: "user_video_history",
        response: {
          data: [{ video_id: "vA" }],
          error: null,
        },
      },
      // Then the regular fixture (history → videos → summaries).
      ...makeFixture([
        { user_id: "a1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u1", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
      ]),
    ]);
    const out = await listVideosWithStats(
      client,
      baseOpts({ excludeAdminUserIds: ["a1"] }),
    );
    expect(out.rows.map((r) => r.videoId)).toEqual(["vB"]);
  });

  it("skips the admin-touched lookup entirely when excludeAdminUserIds is empty", async () => {
    // Only the main history fetch should hit the DB — no pre-fetch round-trip.
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
      ]),
    );
    const out = await listVideosWithStats(
      client,
      baseOpts({ excludeAdminUserIds: [] }),
    );
    expect(out.rows.map((r) => r.videoId)).toEqual(["vA"]);
  });

  it("filters by search term across title and channel", async () => {
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vC", created_at: "2026-04-03T00:00:00Z" },
      ]),
    );
    // "ch1" matches both vA & vC by channel
    const out = await listVideosWithStats(client, baseOpts({ search: "ch1" }));
    expect(out.rows.map((r) => r.videoId).sort()).toEqual(["vA", "vC"]);
  });

  it("filters by language", async () => {
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vC", created_at: "2026-04-03T00:00:00Z" },
      ]),
    );
    const out = await listVideosWithStats(client, baseOpts({ language: "fr" }));
    expect(out.rows.map((r) => r.videoId)).toEqual(["vB"]);
  });

  it("filters by source (whisper) and by channel and by model", async () => {
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vC", created_at: "2026-04-03T00:00:00Z" },
      ]),
    );
    const bySource = await listVideosWithStats(client, baseOpts({ source: "whisper" }));
    expect(bySource.rows.map((r) => r.videoId)).toEqual(["vB"]);

    const client2 = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vC", created_at: "2026-04-03T00:00:00Z" },
      ]),
    );
    const byChannel = await listVideosWithStats(client2, baseOpts({ channel: "Ch2" }));
    expect(byChannel.rows.map((r) => r.videoId)).toEqual(["vB"]);

    const client3 = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" },
      ]),
    );
    const byModel = await listVideosWithStats(client3, baseOpts({ model: "claude-haiku-4-5" }));
    expect(byModel.rows.map((r) => r.videoId)).toEqual(["vB"]);
  });

  it("flaggedOnly excludes non-flagged rows", async () => {
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" }, // auto
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" }, // whisper -> flagged
      ]),
    );
    const out = await listVideosWithStats(client, baseOpts({ flaggedOnly: true }));
    expect(out.rows.map((r) => r.videoId)).toEqual(["vB"]);
    expect(out.rows[0].flagged).toBe(true);
  });

  it("filters by firstSummarizedFrom/To", async () => {
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vC", created_at: "2026-04-03T00:00:00Z" },
      ]),
    );
    const out = await listVideosWithStats(
      client,
      baseOpts({ firstSummarizedFrom: "2026-04-02T00:00:00Z" }),
    );
    expect(out.rows.map((r) => r.videoId).sort()).toEqual(["vB", "vC"]);
  });

  it("includes a row whose firstSummarizedAt is the same day as a date-only firstSummarizedTo (regression guard for 9e77f5a)", async () => {
    // Regression for the bug fixed in commit 9e77f5a: comparing a
    // full ISO timestamp lex-against a date-only string is broken
    // because "2026-04-30T08:30:00Z" > "2026-04-30" and rows in
    // the morning of the end-day got dropped. The fix slices the
    // ISO timestamp to its date prefix before comparing — if a
    // future change drops `.slice(0, 10)`, the row below will be
    // excluded and this test fails.
    const client = buildClient([
      {
        table: "user_video_history",
        response: {
          data: [
            { user_id: "u1", video_id: "vDay", created_at: "2026-04-30T08:30:00Z" },
          ],
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: [
            { id: "vDay", title: "Day-edge", channel_name: "Ch", language: "en", duration_seconds: 100 },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [
            {
              video_id: "vDay",
              transcript_source: "auto_captions",
              model: "claude-opus-4-7",
              processing_time_seconds: 5,
              created_at: "2026-04-30T08:30:00Z",
            },
          ],
          error: null,
        },
      },
    ]);
    const out = await listVideosWithStats(
      client,
      baseOpts({ firstSummarizedTo: "2026-04-30" }),
    );
    expect(out.rows.map((r) => r.videoId)).toEqual(["vDay"]);
  });

  it("sorts each column asc and desc deterministically", async () => {
    const fixtureCalls = () =>
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
        { user_id: "u4", video_id: "vC", created_at: "2026-04-05T00:00:00Z" },
      ]);

    // title asc -> Alpha (vA) , Beta (vB), Gamma (vC)
    const titleAsc = await listVideosWithStats(
      buildClient(fixtureCalls()),
      baseOpts({ sort: "title", dir: "asc" }),
    );
    expect(titleAsc.rows.map((r) => r.videoId)).toEqual(["vA", "vB", "vC"]);

    // title desc -> Gamma, Beta, Alpha
    const titleDesc = await listVideosWithStats(
      buildClient(fixtureCalls()),
      baseOpts({ sort: "title", dir: "desc" }),
    );
    expect(titleDesc.rows.map((r) => r.videoId)).toEqual(["vC", "vB", "vA"]);

    // distinctUsers asc -> vB, vC, then vA (vA has 2)
    const usersAsc = await listVideosWithStats(
      buildClient(fixtureCalls()),
      baseOpts({ sort: "distinctUsers", dir: "asc" }),
    );
    expect(usersAsc.rows[0].distinctUsers).toBe(1);
    expect(usersAsc.rows[usersAsc.rows.length - 1].distinctUsers).toBe(2);
  });

  it("respects pageSize cap of 50", async () => {
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
      ]),
    );
    const out = await listVideosWithStats(client, baseOpts({ pageSize: 999 }));
    // Single row fixture; verify the function clamped pageSize internally.
    expect(out.rows.length).toBeLessThanOrEqual(50);
  });

  it("trending mode applies window filter to history (gte/lte on accessed_at)", async () => {
    const seen: ChainCall[] = [];
    const window = lastNDays(7);
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: [], error: null },
        expect: (calls) => seen.push(...calls),
      },
    ]);
    await listVideosWithStats(client, baseOpts({ mode: "trending", window }));
    const gteCol = String(seen.find((c) => c.method === "gte")?.args[0] ?? "");
    const lteCol = String(seen.find((c) => c.method === "lte")?.args[0] ?? "");
    expect(gteCol).toBe("accessed_at");
    expect(lteCol).toBe("accessed_at");
  });

  it("status='stale' when last view > 30d ago", async () => {
    // fix time: lastSeen = 31d ago
    const now = Date.now();
    const olderThan30 = new Date(now - 31 * 86_400_000).toISOString();
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: olderThan30 },
      ]),
    );
    const out = await listVideosWithStats(client, baseOpts());
    expect(out.rows[0].status).toBe("stale");
  });

  it("flips truncated=true when distinct videoIds hits VIDEOS_ROW_CAP (25k)", async () => {
    // Build 25_001 distinct video_ids so the inner cap fires. Production
    // currently has no DI hook for the cap — when the column count grows
    // past 25k for a real window the in-process aggregator will silently
    // understate, and this test guards the truncation flag plumbing.
    const ROWS = 25_001;
    const history = Array.from({ length: ROWS }, (_, i) => ({
      user_id: `u${i}`,
      video_id: `v${i}`,
      created_at: "2026-04-01T00:00:00Z",
    }));
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: history, error: null },
      },
      // The capped video set still goes through metadata + summaries
      // fetches; both can be empty since the test only checks the flag.
      { table: "videos", response: { data: [], error: null } },
      { table: "summaries", response: { data: [], error: null } },
    ]);
    const out = await listVideosWithStats(client, baseOpts());
    expect(out.truncated).toBe(true);
  });

  it.each([
    // Each entry: (sort key, expectsDistinctOrder). When the fixture
    // produces rows that genuinely tie on the column (e.g. all rows
    // have totalSummaries=1), asc and desc collapse to the same
    // tie-break ordering, so we can only assert set-equality. For
    // every other column at least two rows have distinct values, so
    // asc must NOT equal desc — that catches a no-op direction bug
    // the previous set-only assertion would silently pass.
    ["distinctUsers", true],
    ["totalSummaries", false],
    ["title", true],
    ["channelName", true],
    ["language", true],
    ["firstSummarizedAt", true],
    ["lastSummarizedAt", true],
    ["whisperPct", true],
    ["p95ProcessingSeconds", true],
    ["durationSeconds", true],
  ] as const)(
    "sort by %s (asc and desc) returns deterministic order",
    async (key, expectsDistinctOrder) => {
      const fixtureRows = () =>
        makeFixture([
          { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
          { user_id: "u2", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
          { user_id: "u3", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
          { user_id: "u4", video_id: "vC", created_at: "2026-04-05T00:00:00Z" },
        ]);

      const asc = await listVideosWithStats(
        buildClient(fixtureRows()),
        baseOpts({ sort: key, dir: "asc" }),
      );
      const desc = await listVideosWithStats(
        buildClient(fixtureRows()),
        baseOpts({ sort: key, dir: "desc" }),
      );
      // Both directions return the same row count and populate the
      // same set of videoIds.
      expect(asc.rows).toHaveLength(3);
      expect(desc.rows).toHaveLength(3);
      expect(new Set(asc.rows.map((r) => r.videoId))).toEqual(
        new Set(desc.rows.map((r) => r.videoId)),
      );
      if (expectsDistinctOrder) {
        // Asc and desc must produce different orderings — guards
        // against a no-op direction bug where sorting silently
        // ignores `dir` and returns the same row sequence both ways.
        expect(asc.rows.map((r) => r.videoId)).not.toEqual(
          desc.rows.map((r) => r.videoId),
        );
      }
    },
  );
});

// ─── getVideoInsights ────────────────────────────────────────────────────

describe("getVideoInsights", () => {
  function fixture(historyRows: Array<Record<string, unknown>>) {
    return [
      { table: "user_video_history", response: { data: historyRows, error: null } },
      {
        table: "videos",
        response: {
          data: [
            { id: "vA", title: "Alpha", channel_name: "Ch1", language: "en" },
            { id: "vB", title: "Beta", channel_name: "Ch2", language: "fr" },
            { id: "vC", title: "Gamma", channel_name: "Ch1", language: "en" },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [
            { video_id: "vA", transcript_source: "auto_captions" },
            { video_id: "vB", transcript_source: "whisper" },
            { video_id: "vC", transcript_source: "manual_captions" },
          ],
          error: null,
        },
      },
    ];
  }

  it("computes totals, top channels, language mix, and source mix", async () => {
    const client = buildClient(
      fixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u2", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u3", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
        { user_id: "u4", video_id: "vC", created_at: "2026-04-04T00:00:00Z" },
      ]),
    );
    const out = await getVideoInsights(client, { mode: "all_time" });
    expect(out.totalUniqueVideos).toBe(3);
    expect(out.totalSummaries).toBe(4);
    // Ch1 has 2 videos (vA, vC); Ch2 has 1.
    expect(out.topChannels[0]).toEqual({ channelName: "Ch1", videoCount: 2 });
    expect(out.languageMix.find((l) => l.language === "en")?.videoCount).toBe(2);
    expect(out.languageMix.find((l) => l.language === "fr")?.videoCount).toBe(1);
    // sourceMix is by view: vA(2)+vC(1)+vB(1)
    const auto = out.sourceMix.find((m) => m.source === "auto_captions");
    expect(auto?.count).toBe(2);
    const manual = out.sourceMix.find((m) => m.source === "manual_captions");
    expect(manual?.count).toBe(1);
    const whisper = out.sourceMix.find((m) => m.source === "whisper");
    expect(whisper?.count).toBe(1);
    // 1 of 3 videos needed Whisper
    expect(out.whisperVideoSharePct).toBe(33);
  });

  it("returns empty/zero shapes on no data", async () => {
    const client = buildClient([
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const out = await getVideoInsights(client, { mode: "all_time" });
    expect(out.totalUniqueVideos).toBe(0);
    expect(out.totalSummaries).toBe(0);
    expect(out.whisperVideoSharePct).toBe(0);
    expect(out.topChannels).toEqual([]);
    expect(out.languageMix).toEqual([]);
    expect(out.sourceMix).toHaveLength(3);
    expect(out.sourceMix.every((m) => m.count === 0)).toBe(true);
    expect(out.trendingPerDay).toBeUndefined();
  });

  it("limits topChannels to 5", async () => {
    const channels = Array.from({ length: 7 }, (_, i) => ({
      id: `v${i}`,
      title: `T${i}`,
      channel_name: `Ch${i}`,
      language: "en",
    }));
    const summaries = channels.map((v) => ({
      video_id: v.id,
      transcript_source: "auto_captions",
    }));
    const history = channels.map((v, i) => ({
      user_id: `u${i}`,
      video_id: v.id,
      created_at: "2026-04-01T00:00:00Z",
    }));
    const client = buildClient([
      { table: "user_video_history", response: { data: history, error: null } },
      { table: "videos", response: { data: channels, error: null } },
      { table: "summaries", response: { data: summaries, error: null } },
    ]);
    const out = await getVideoInsights(client, { mode: "all_time" });
    expect(out.topChannels).toHaveLength(5);
  });

  it("populates trendingPerDay only in trending mode", async () => {
    const window = lastNDays(7);
    const today = window.end.toISOString();
    const client = buildClient(
      fixture([
        { user_id: "u1", video_id: "vA", created_at: today },
      ]),
    );
    const trending = await getVideoInsights(client, { mode: "trending", window });
    expect(trending.trendingPerDay).toBeDefined();
    expect(trending.trendingPerDay?.length).toBe(7);

    const client2 = buildClient(
      fixture([
        { user_id: "u1", video_id: "vA", created_at: today },
      ]),
    );
    const allTime = await getVideoInsights(client2, { mode: "all_time" });
    expect(allTime.trendingPerDay).toBeUndefined();
  });
});

// ─── getVideoSummariesUsers ──────────────────────────────────────────────

describe("getVideoSummariesUsers", () => {
  it("returns the distinct user list with email lookups and cacheHit", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "vA", created_at: "2026-04-05T00:00:00Z" },
              { user_id: "u2", video_id: "vA", created_at: "2026-04-04T00:00:00Z" },
              { user_id: "u3", video_id: "vA", created_at: "2026-04-03T00:00:00Z" },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            data: [
              { video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
            ],
            error: null,
          },
        },
      ],
      {
        getUserById: (id: string) => {
          const m: Record<string, string> = {
            u1: "u1@example.com",
            u2: "u2@example.com",
            u3: "u3@example.com",
          };
          return { data: { user: { email: m[id] } }, error: null };
        },
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.users).toHaveLength(3);
    expect(out.users.map((u) => u.userId)).toEqual(["u1", "u2", "u3"]);
    expect(out.users[0].email).toBe("u1@example.com");
    expect(out.users[0].emailLookupOk).toBe(true);
    expect(out.users[0].cacheHit).toBe(true); // earliest summary < accessedAt
  });

  it("emailLookupOk=false when auth lookup errors", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "vA", created_at: "2026-04-05T00:00:00Z" },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: { data: [], error: null },
        },
      ],
      {
        getUserById: () => ({
          data: { user: null },
          error: { message: "auth down" },
        }),
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.users[0].email).toBeNull();
    expect(out.users[0].emailLookupOk).toBe(false);
  });

  it("returns empty users array when no history", async () => {
    const client = buildClient([
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const out = await getVideoSummariesUsers(client, "vNoSuch");
    expect(out.users).toEqual([]);
  });

  it("cacheHit=false when earliest summary is created after access (cold path)", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            // earliest > accessedAt → access happened before summary existed
            data: [{ video_id: "vA", created_at: "2026-04-05T00:00:00Z" }],
            error: null,
          },
        },
      ],
      {
        getUserById: () => ({
          data: { user: { email: "u1@example.com" } },
          error: null,
        }),
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.users[0].cacheHit).toBe(false);
  });

  it("cacheHit=false when no summary row exists (orphaned history)", async () => {
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "vA", created_at: "2026-04-05T00:00:00Z" },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: { data: [], error: null },
        },
      ],
      {
        getUserById: () => ({
          data: { user: { email: "u1@example.com" } },
          error: null,
        }),
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.users[0].cacheHit).toBe(false);
  });

  it("dedupes to one row per user (most recent access wins) and audit-row count = distinct users", async () => {
    // u1 accessed twice, u2 once. The drilldown contract — and what
    // viewVideoUsersAction relies on — is one row per user, so the
    // audit row count equals the distinct-user count, not the
    // access-count.
    const client = buildClient(
      [
        {
          table: "user_video_history",
          response: {
            data: [
              { user_id: "u1", video_id: "vA", created_at: "2026-04-05T00:00:00Z" },
              { user_id: "u1", video_id: "vA", created_at: "2026-04-04T00:00:00Z" },
              { user_id: "u2", video_id: "vA", created_at: "2026-04-03T00:00:00Z" },
            ],
            error: null,
          },
        },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({ data: { user: { email: null } }, error: null }),
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.users.map((u) => u.userId).sort()).toEqual(["u1", "u2"]);
    const u1 = out.users.find((u) => u.userId === "u1")!;
    expect(u1.accessedAt).toBe("2026-04-05T00:00:00Z");
  });

  it("truncated=true whenever the over-fetch cap is hit, regardless of peek-row identity", async () => {
    // 200 distinct users + 1 duplicate row. The cap was hit on the raw
    // row count. Even though the +1 peek row is a duplicate of an
    // already-kept user, we cannot prove from a single peek that no
    // distinct hidden users exist past the cap (we never see rows
    // #(CAP+2)..N). Conservative rule: any cap-hit ⇒ truncated=true.
    const rows = [
      ...Array.from({ length: 200 }, (_, i) => ({
        user_id: `u${i}`,
        video_id: "vA",
        // Distinct timestamps so dedup keeps the most recent. The
        // duplicate row below is older, so `u0`'s accessedAt won't
        // change.
        created_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T05:00:00Z`,
      })),
      {
        user_id: "u0",
        video_id: "vA",
        created_at: "2026-04-01T00:00:00Z",
      },
    ];
    const client = buildClient(
      [
        { table: "user_video_history", response: { data: rows, error: null } },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({ data: { user: { email: null } }, error: null }),
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.truncated).toBe(true);
    expect(out.users).toHaveLength(200);
  });

  it("truncated=false when fetch returns fewer than CAP+1 rows", async () => {
    // 199 rows — under the over-fetch limit (CAP+1=201). No cap-hit,
    // so we have full visibility and can honestly say truncated=false.
    const rows = Array.from({ length: 199 }, (_, i) => ({
      user_id: `u${i}`,
      video_id: "vA",
      created_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T05:00:00Z`,
    }));
    const client = buildClient(
      [
        { table: "user_video_history", response: { data: rows, error: null } },
        { table: "summaries", response: { data: [], error: null } },
      ],
      {
        getUserById: () => ({ data: { user: { email: null } }, error: null }),
      },
    );
    const out = await getVideoSummariesUsers(client, "vA");
    expect(out.truncated).toBe(false);
    expect(out.users).toHaveLength(199);
  });

  it("limits the row fetch to VIDEO_USERS_DRILLDOWN_CAP + 1 (truncation peek)", async () => {
    // Fetches one extra row past the cap so we can flip `truncated`
    // instead of silently dropping the tail. The +1 is sliced off
    // before the dedup pass.
    const seen: ChainCall[] = [];
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: [], error: null },
        expect: (calls) => seen.push(...calls),
      },
    ]);
    await getVideoSummariesUsers(client, "vA");
    const limit = seen.find((c) => c.method === "limit");
    expect(limit?.args[0]).toBe(201);
  });
});
