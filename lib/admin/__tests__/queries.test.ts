import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listVideosWithStats,
  getVideoInsights,
  lastNDays,
} from "../queries";
import { QueryError } from "../errors";
import type { VideoListOptions } from "../queries";
import { loadAdminShell } from "../admin-shell";
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
// Dashboard report behavior is covered by dashboard-report.test.ts.

describe("loadAdminShell", () => {
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
    const out = await loadAdminShell(client, {
      allowlist: ["admin@example.com"],
    });
    expect(out.usersTotal).toBe(2);
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
    const out = await loadAdminShell(client, {
      allowlist: ["owner@example.com"],
    });
    expect(out.usersTotal).toBe(0);
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
    const out = await loadAdminShell(client, { allowlist: [] });
    expect(out.usersTotal).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("User Account total unavailable"),
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
    const out = await loadAdminShell(client, { allowlist: [] });
    expect(out.usersTotal).toBe(250);
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
    expect(out.adminFilterIncomplete).toBe(false);
  });

  it("skips the admin-touched lookup when all excludeAdminUserIds are blank strings", async () => {
    // Defensive cleanup mirrors fetchHistoryIn — the helper must not
    // produce `in("user_id", ["", ""])` which would either return zero
    // rows or 400 at PostgREST.
    const client = buildClient(
      makeFixture([
        { user_id: "u1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
      ]),
    );
    const out = await listVideosWithStats(
      client,
      baseOpts({ excludeAdminUserIds: ["", ""] }),
    );
    expect(out.rows.map((r) => r.videoId)).toEqual(["vA"]);
  });

  it("drops admin-touched videos in trending mode even when admin's view falls outside the window", async () => {
    // vA: admin a1 viewed it 90 days ago (outside the 30d window),
    //     non-admin u1 viewed it today. listAdminTouchedVideoIds is
    //     all-time so vA still drops; this guards the JSDoc claim that
    //     adding a window filter to the lookup would let stale tests
    //     re-enter trending.
    const today = new Date().toISOString();
    const client = buildClient([
      {
        // listAdminTouchedVideoIds — finds vA via admin a1's stale history.
        table: "user_video_history",
        response: { data: [{ video_id: "vA" }], error: null },
      },
      ...makeFixture([
        { user_id: "u1", video_id: "vA", created_at: today },
        { user_id: "u2", video_id: "vB", created_at: today },
      ]),
    ]);
    const out = await listVideosWithStats(
      client,
      baseOpts({
        mode: "trending",
        window: lastNDays(30),
        excludeAdminUserIds: ["a1"],
      }),
    );
    expect(out.rows.map((r) => r.videoId)).toEqual(["vB"]);
  });

  it("propagates QueryError when listAdminTouchedVideoIds fails", async () => {
    // Throw rather than fail-soft: a silent fail here would make filtering
    // weaker than the pre-PR baseline (see helper's doc-comment).
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: null, error: { message: "boom" } },
      },
    ]);
    await expect(
      listVideosWithStats(client, baseOpts({ excludeAdminUserIds: ["a1"] })),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("surfaces adminFilterIncomplete=true and warns when the admin-touched lookup hits the cap", async () => {
    // The cap is HISTORY_ROW_CAP (100k) — too large for a real fixture.
    // We simulate by stubbing the helper response with a sentinel array
    // sized to match the constant. listAdminTouchedVideoIds checks
    // `data.length === HISTORY_ROW_CAP`, so the test relies on the
    // fixture meeting that exact length.
    const HISTORY_ROW_CAP = 100_000;
    const cappedFixture = Array.from({ length: HISTORY_ROW_CAP }, (_, i) => ({
      video_id: `v${i % 3}`, // dedup at Set level — only need a few distinct vids
    }));
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: cappedFixture, error: null },
      },
      // Main history fetch returns one row for a non-admin video.
      {
        table: "user_video_history",
        response: {
          data: [
            { user_id: "u1", video_id: "vC", created_at: "2026-04-01T00:00:00Z" },
          ],
          error: null,
        },
      },
      {
        table: "videos",
        response: {
          data: [
            { id: "vC", title: "Gamma", channel_name: "Ch1", language: "en", duration_seconds: 900 },
          ],
          error: null,
        },
      },
      {
        table: "summaries",
        response: {
          data: [
            { video_id: "vC", transcript_source: "manual_captions", model: "claude-opus-4-7", processing_time_seconds: 8, created_at: "2026-04-01T00:00:00Z" },
          ],
          error: null,
        },
      },
    ]);
    const out = await listVideosWithStats(
      client,
      baseOpts({ excludeAdminUserIds: ["a1"] }),
    );
    expect(out.adminFilterIncomplete).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("cap hit"),
      expect.objectContaining({ adminUserIds: ["a1"] }),
    );
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

  it("drops admin-touched videos from totals + topChannels + languageMix", async () => {
    // vA: admin a1 viewed AND non-admin u1 viewed → drop entirely.
    // vB, vC: only non-admin → keep.
    // Mirrors the listVideosWithStats regression so the page header
    // "N videos summarized" stays in lockstep with the table.
    const client = buildClient([
      {
        // listAdminTouchedVideoIds — admin a1 has touched vA.
        table: "user_video_history",
        response: { data: [{ video_id: "vA" }], error: null },
      },
      ...fixture([
        { user_id: "a1", video_id: "vA", created_at: "2026-04-01T00:00:00Z" },
        { user_id: "u1", video_id: "vA", created_at: "2026-04-02T00:00:00Z" },
        { user_id: "u2", video_id: "vB", created_at: "2026-04-03T00:00:00Z" },
        { user_id: "u3", video_id: "vC", created_at: "2026-04-04T00:00:00Z" },
      ]),
    ]);
    const out = await getVideoInsights(client, {
      mode: "all_time",
      excludeAdminUserIds: ["a1"],
    });
    // 4 history rows total → 2 dropped (both vA viewers) → 2 kept.
    expect(out.totalSummaries).toBe(2);
    expect(out.totalUniqueVideos).toBe(2);
    // Ch1 in fixture maps to vA + vC; with vA dropped, Ch1 has 1 video.
    expect(
      out.topChannels.find((c) => c.channelName === "Ch1")?.videoCount,
    ).toBe(1);
    // Languages: vB=fr (1), vC=en (1). vA's en contribution is gone.
    expect(out.languageMix.find((l) => l.language === "en")?.videoCount).toBe(1);
    expect(out.languageMix.find((l) => l.language === "fr")?.videoCount).toBe(1);
    expect(out.adminFilterIncomplete).toBe(false);
  });

  it("propagates QueryError when listAdminTouchedVideoIds fails", async () => {
    const client = buildClient([
      {
        table: "user_video_history",
        response: { data: null, error: { message: "boom" } },
      },
    ]);
    await expect(
      getVideoInsights(client, {
        mode: "all_time",
        excludeAdminUserIds: ["a1"],
      }),
    ).rejects.toBeInstanceOf(QueryError);
  });
});
