import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listAuditLog,
  listAllUsers,
  listUsersWithStats,
  getDashboardKPIs,
  getPerformanceStats,
  getUserSummaries,
  lastNDays,
  WHISPER_FLAG_THRESHOLD,
  QueryError,
} from "../queries";
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

// ─── listUsersWithStats ──────────────────────────────────────────────────

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
              { video_id: "v1", transcript_source: "whisper", processing_time_seconds: 10 },
              { video_id: "v2", transcript_source: "auto_captions", processing_time_seconds: 5 },
              { video_id: "v3", transcript_source: "manual_captions", processing_time_seconds: 3 },
            ],
            error: null,
          },
        },
      ],
      {
        listUsers: {
          data: {
            users: [
              { id: "u1", email: "u1@example.com", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: "2026-04-15T00:00:00Z" },
              { id: "u2", email: "u2@example.com", created_at: "2026-02-01T00:00:00Z", last_sign_in_at: null },
              { id: "u3", email: "u3@example.com", created_at: "2026-03-01T00:00:00Z", last_sign_in_at: "2026-04-20T00:00:00Z" },
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
    expect(u1?.flagged).toBe(true); // 50% > WHISPER_FLAG_THRESHOLD (30)

    const u3 = result.rows.find((r) => r.userId === "u3");
    expect(u3?.summaries).toBe(0);
    expect(u3?.flagged).toBe(false);
  });

  it("falls back to last_sign_in_at when no history rows exist", async () => {
    const window = lastNDays(30);
    const client = buildClient(
      [{ table: "user_video_history", response: { data: [], error: null } }],
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
              { id: "u1", email: "alice@example.com", created_at: "2026-01-01", last_sign_in_at: null },
              { id: "u2", email: "bob@example.com", created_at: "2026-01-02", last_sign_in_at: null },
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

  it("emits nextCursor only when the +1 peek returns an extra row", async () => {
    // pageSize = 25 ⇒ +1 peek requests 26.
    const users = Array.from({ length: 26 }, (_, idx) => ({
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
    expect(result.rows).toHaveLength(25);
    expect(result.nextCursor).not.toBeNull();
  });

  it("does NOT emit nextCursor when the last page is exactly full", async () => {
    // 25 returned (pageSize) means no more — peek would have brought 26.
    const users = Array.from({ length: 25 }, (_, idx) => ({
      id: `u${idx}`,
      email: `u${idx}@example.com`,
      created_at: "2026-01-01",
      last_sign_in_at: null,
    }));
    const client = buildClient(
      [{ table: "user_video_history", response: { data: [], error: null } }],
      { listUsers: { data: { users, total: 25 }, error: null } },
    );
    const result = await listUsersWithStats(client, { pageSize: 25 });
    expect(result.nextCursor).toBeNull();
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
              enable_thinking: false,
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

  it("prefers enable_thinking=false when both variants exist for a video", async () => {
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
            // thinking-enabled comes first; the canonical (enable_thinking=false)
            // is second. The function must still pick the canonical.
            { id: "sum-thinking", video_id: "v1", transcript_source: "auto_captions", model: "claude-opus-4-7", processing_time_seconds: 12, enable_thinking: true },
            { id: "sum-canonical", video_id: "v1", transcript_source: "auto_captions", model: "claude-haiku-4-5", processing_time_seconds: 4, enable_thinking: false },
          ],
          error: null,
        },
      },
    ]);
    const rows = await getUserSummaries(client, "u1", 10);
    expect(rows[0].summaryId).toBe("sum-canonical");
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
  it("aggregateUserActivity (via listUsersWithStats) filters on accessed_at", async () => {
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
    await listUsersWithStats(client, { pageSize: 25, window });
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
    const big = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      email: `${i}@x`,
      created_at: "2026-04-29T00:00:00Z",
      is_anonymous: false,
    }));
    const client = buildAuthClient(
      Array.from({ length: 30 }, () => ({ users: big, total: 6000 })),
    );
    const out = await listAllUsers(client, { rowCap: 5000 });
    expect(out.users).toHaveLength(5000);
    expect(out.truncated).toBe(true);
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
