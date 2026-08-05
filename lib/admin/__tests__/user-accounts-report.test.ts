import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => fn }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadUserAccountsReport } from "../user-accounts-report";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

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
  users: Array<Record<string, unknown>> = [],
  scripts: SelectScript[] = [],
  authPages?: Array<{ users: Array<Record<string, unknown>>; total: number }>,
): SupabaseClient {
  let scriptIndex = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[scriptIndex++];
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
      "order",
      "limit",
      "or",
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
        listUsers: vi.fn(async ({ page = 1 }: { page?: number } = {}) => {
          const pageData = authPages?.[page - 1] ?? {
            users,
            total: users.length,
          };
          return {
          data: pageData,
          error: null,
          };
        }),
      },
    },
  } as unknown as SupabaseClient;
}

describe("loadUserAccountsReport", () => {
  it("returns a serializable empty report with the default page shape", async () => {
    const report = await loadUserAccountsReport(buildClient(), {
      search: null,
      tab: "exclude_anon",
      sort: "createdAt",
      direction: "desc",
      page: 1,
      expandedAccountId: null,
    });

    expect(report).toEqual({
      rows: [],
      total: 0,
      truncated: false,
      page: 1,
      pageCount: 1,
      activeOnPage: 0,
      expanded: null,
      warnings: [],
    });
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("preserves account mapping and status precedence", async () => {
    const report = await loadUserAccountsReport(
      buildClient(
        [
          {
            id: "ordinary",
            email: "ordinary@example.com",
            created_at: "2026-04-01T00:00:00Z",
            email_confirmed_at: "2026-04-01T00:00:00Z",
            identities: [{ provider: "google" }, { provider: "google" }],
            is_anonymous: false,
          },
          {
            id: "anonymous",
            email: null,
            created_at: "2026-04-02T00:00:00Z",
            is_anonymous: true,
          },
          {
            id: "administrator",
            email: "admin@example.com",
            created_at: "2026-04-03T00:00:00Z",
            email_confirmed_at: "2026-04-03T00:00:00Z",
            app_metadata: { is_admin: true },
            is_anonymous: false,
          },
          {
            id: "smoke",
            email: "smoke@example.com",
            created_at: "2026-04-03T12:00:00Z",
            email_confirmed_at: "2026-04-03T12:00:00Z",
            app_metadata: { is_smoke_account: true },
            user_metadata: { is_smoke_account: true },
            is_anonymous: false,
          },
          {
            id: "banned",
            email: "banned@example.com",
            created_at: "2026-04-04T00:00:00Z",
            email_confirmed_at: "2026-04-04T00:00:00Z",
            banned_until: "2099-01-01T00:00:00Z",
            is_anonymous: false,
          },
          {
            id: "deleted",
            email: "deleted@example.com",
            created_at: "2026-04-05T00:00:00Z",
            email_confirmed_at: "2026-04-05T00:00:00Z",
            banned_until: "2099-01-01T00:00:00Z",
            deleted_at: "2026-04-06T00:00:00Z",
            is_anonymous: false,
          },
          {
            id: "unverified",
            email: "unverified@example.com",
            created_at: "2026-04-06T00:00:00Z",
            is_anonymous: false,
          },
        ],
        [{ table: "user_video_history", response: { data: [], error: null } }],
      ),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "asc",
        page: 1,
        expandedAccountId: null,
      },
    );

    const byId = new Map(report.rows.map((row) => [row.userId, row]));
    expect(byId.get("ordinary")).toMatchObject({
      email: "ordinary@example.com",
      providers: ["google"],
      status: "active",
    });
    expect(byId.get("anonymous")).toMatchObject({
      email: null,
      status: "anonymous",
    });
    expect(byId.get("administrator")).toMatchObject({
      status: "active",
      appMetadata: { is_admin: true },
    });
    expect(byId.get("smoke")).toMatchObject({
      status: "active",
      isSmokeAccount: true,
    });
    expect(byId.get("banned")?.status).toBe("banned");
    expect(byId.get("deleted")?.status).toBe("deleted");
    expect(byId.get("unverified")?.status).toBe("unverified");
  });

  it("excludes trusted Smoke Accounts from the default human report while keeping them in all", async () => {
    const users = [
      {
        id: "human",
        email: "human@example.com",
        created_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "smoke",
        email: "smoke@example.com",
        created_at: "2026-04-02T00:00:00Z",
        app_metadata: { is_smoke_account: true },
      },
    ];
    const emptyActivity = {
      table: "user_video_history",
      response: { data: [], error: null },
    };

    const humanReport = await loadUserAccountsReport(
      buildClient(users, [emptyActivity]),
      {
        search: null,
        tab: "exclude_anon",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: null,
      },
    );
    expect(humanReport.rows.map((row) => row.userId)).toEqual(["human"]);

    const allReport = await loadUserAccountsReport(buildClient(users, [emptyActivity]), {
      search: null,
      tab: "all",
      sort: "createdAt",
      direction: "desc",
      page: 1,
      expandedAccountId: null,
    });
    expect(allReport.rows.map((row) => row.userId)).toEqual(["smoke", "human"]);
    expect(allReport.rows[0]?.isSmokeAccount).toBe(true);
  });

  it("aggregates summary counts, Whisper percentages, timestamps, and flags", async () => {
    const report = await loadUserAccountsReport(
      buildClient(
        [
          { id: "u1", email: "one@example.com", created_at: "2026-04-01" },
          { id: "u2", email: "two@example.com", created_at: "2026-04-02" },
        ],
        [
          {
            table: "user_video_history",
            response: {
              data: [
                { user_id: "u1", video_id: "v1", created_at: "2026-04-29T12:00:00Z" },
                { user_id: "u1", video_id: "v2", created_at: "2026-04-28T12:00:00Z" },
                ...Array.from({ length: 10 }, (_, index) => ({
                  user_id: "u2",
                  video_id: `u2-video-${index}`,
                  created_at: `2026-04-${String(20 - index).padStart(2, "0")}T12:00:00Z`,
                })),
              ],
              error: null,
            },
            expect: (calls) => {
              expect(String(calls.find((call) => call.method === "select")?.args[0])).toContain(
                "created_at:accessed_at",
              );
              expect(calls.find((call) => call.method === "gte")?.args[0]).toBe(
                "accessed_at",
              );
              expect(calls.find((call) => call.method === "lte")?.args[0]).toBe(
                "accessed_at",
              );
              expect(calls.find((call) => call.method === "order")?.args[0]).toBe(
                "accessed_at",
              );
            },
          },
          {
            table: "summaries",
            response: {
              data: [
                { video_id: "v1", transcript_source: "whisper" },
                { video_id: "v2", transcript_source: "auto_captions" },
                ...Array.from({ length: 10 }, (_, index) => ({
                  video_id: `u2-video-${index}`,
                  transcript_source: index < 3 ? "whisper" : "auto_captions",
                })),
              ],
              error: null,
            },
          },
        ],
      ),
      {
        search: null,
        tab: "all",
        sort: "summaries",
        direction: "desc",
        page: 1,
        expandedAccountId: null,
      },
    );

    const byId = new Map(report.rows.map((row) => [row.userId, row]));
    expect(byId.get("u1")).toMatchObject({
      summaries: 2,
      whisper: 1,
      whisperPct: 50,
      flagged: true,
      lastActivity: "2026-04-29T12:00:00Z",
    });
    expect(byId.get("u2")).toMatchObject({
      summaries: 10,
      whisper: 3,
      whisperPct: 30,
      flagged: false,
      lastActivity: "2026-04-20T12:00:00Z",
    });
  });

  it("falls back to the non-banned status for an invalid ban timestamp", async () => {
    const report = await loadUserAccountsReport(
      buildClient([
        {
          id: "u1",
          email: "one@example.com",
          created_at: "2026-04-01",
          email_confirmed_at: "2026-04-01",
          banned_until: "not-a-date",
        },
      ], [
        { table: "user_video_history", response: { data: [], error: null } },
      ]),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: null,
      },
    );

    expect(report.rows[0].status).toBe("active");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("invalid banned_until"),
      expect.objectContaining({ userId: "u1", bannedUntil: "not-a-date" }),
    );
  });

  it("retains search and tab filtering semantics", async () => {
    const users = [
      { id: "u-alice", email: "Alice@example.com", created_at: "2026-04-01" },
      { id: "u-active", email: "active@example.com", created_at: "2026-04-02" },
      { id: "u-flagged", email: "flagged@example.com", created_at: "2026-04-03" },
      { id: "u-anon", email: null, created_at: "2026-04-04", is_anonymous: true },
    ];
    const input = {
      search: null,
      tab: "exclude_anon" as const,
      sort: "email" as const,
      direction: "asc" as const,
      page: 1,
      expandedAccountId: null,
    };

    const accounts = await loadUserAccountsReport(
      buildClient(users, [
        { table: "user_video_history", response: { data: [], error: null } },
      ]),
      input,
    );
    expect(accounts.rows.map((row) => row.userId)).toEqual([
      "u-active",
      "u-alice",
      "u-flagged",
    ]);

    const anonymous = await loadUserAccountsReport(
      buildClient(users, [
        { table: "user_video_history", response: { data: [], error: null } },
      ]),
      { ...input, tab: "anon_only" },
    );
    expect(anonymous.rows.map((row) => row.userId)).toEqual(["u-anon"]);

    const active = await loadUserAccountsReport(
      buildClient(users, [
        {
          table: "user_video_history",
          response: {
            data: [
              {
                user_id: "u-active",
                video_id: "v-active",
                created_at: "2026-04-29T00:00:00Z",
              },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            data: [{ video_id: "v-active", transcript_source: "auto_captions" }],
            error: null,
          },
        },
      ]),
      { ...input, tab: "active" },
    );
    expect(active.rows.map((row) => row.userId)).toEqual(["u-active"]);

    const flagged = await loadUserAccountsReport(
      buildClient(users, [
        {
          table: "user_video_history",
          response: {
            data: [
              {
                user_id: "u-flagged",
                video_id: "v-flagged",
                created_at: "2026-04-29T00:00:00Z",
              },
            ],
            error: null,
          },
        },
        {
          table: "summaries",
          response: {
            data: [{ video_id: "v-flagged", transcript_source: "whisper" }],
            error: null,
          },
        },
      ]),
      { ...input, tab: "flagged" },
    );
    expect(flagged.rows.map((row) => row.userId)).toEqual(["u-flagged"]);

    const searched = await loadUserAccountsReport(
      buildClient(users, [
        { table: "user_video_history", response: { data: [], error: null } },
      ]),
      { ...input, tab: "all", search: " ALICE " },
    );
    expect(searched.rows.map((row) => row.userId)).toEqual(["u-alice"]);
  });

  it("sorts deterministically and paginates after filtering", async () => {
    const users = Array.from({ length: 30 }, (_, index) => ({
      id: `u-${String(index).padStart(2, "0")}`,
      email: `${String(index).padStart(2, "0")}@example.com`,
      created_at: "2026-04-01T00:00:00Z",
    }));
    const makeClient = () =>
      buildClient(users, [
        { table: "user_video_history", response: { data: [], error: null } },
      ]);
    const page1 = await loadUserAccountsReport(makeClient(), {
      search: null,
      tab: "exclude_anon",
      sort: "email",
      direction: "asc",
      page: 1,
      expandedAccountId: null,
    });
    const page2 = await loadUserAccountsReport(makeClient(), {
      search: null,
      tab: "exclude_anon",
      sort: "email",
      direction: "asc",
      page: 2,
      expandedAccountId: null,
    });

    expect(page1.rows.map((row) => row.userId)).toEqual(
      users.slice(0, 25).map((user) => user.id),
    );
    expect(page2.rows.map((row) => row.userId)).toEqual(
      users.slice(25).map((user) => user.id),
    );
    expect(page1.total).toBe(30);
    expect(page1.pageCount).toBe(2);
    expect(page2.page).toBe(2);
  });

  it("falls back to the default intent for invalid runtime values", async () => {
    const report = await loadUserAccountsReport(
      buildClient([
        { id: "older", email: "older@example.com", created_at: "2026-04-01" },
        { id: "anon", email: null, created_at: "2026-04-02", is_anonymous: true },
        { id: "newer", email: "newer@example.com", created_at: "2026-04-03" },
      ], [
        { table: "user_video_history", response: { data: [], error: null } },
      ]),
      {
        search: null,
        tab: "not-a-tab",
        sort: "not-a-sort",
        direction: "sideways",
        page: 0,
        expandedAccountId: null,
      } as never,
    );

    expect(report.rows.map((row) => row.userId)).toEqual(["newer", "older"]);
    expect(report.page).toBe(1);
  });

  it("returns usable capped directory data with a completeness warning", async () => {
    const users = Array.from({ length: 5_001 }, (_, index) => ({
      id: `u-${index}`,
      email: `${index}@example.com`,
      created_at: "2026-04-01",
    }));
    const report = await loadUserAccountsReport(
      buildClient(users, [
        { table: "user_video_history", response: { data: [], error: null } },
      ]),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "asc",
        page: 1,
        expandedAccountId: null,
      },
    );

    expect(report.rows).toHaveLength(25);
    expect(report.total).toBe(5_000);
    expect(report.truncated).toBe(true);
    expect(report.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_TRUNCATED",
        description: expect.any(String),
      },
    ]);
  });

  it("enumerates all Directory pages before applying report policy", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `page-one-${index}`,
      email: `${index}@example.com`,
      created_at: "2026-04-01",
    }));
    const client = buildClient(
      [],
      [{ table: "user_video_history", response: { data: [], error: null } }],
      [
        { users: firstPage, total: 201 },
        { users: [{ id: "page-two", email: "two@example.com" }], total: 201 },
      ],
    );
    const report = await loadUserAccountsReport(client, {
      search: "two@example.com",
      tab: "all",
      sort: "email",
      direction: "asc",
      page: 1,
      expandedAccountId: null,
    });

    expect(report.rows.map((row) => row.userId)).toEqual(["page-two"]);
    expect(
      (client.auth.admin.listUsers as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([
      [{ page: 1, perPage: 200 }],
      [{ page: 2, perPage: 200 }],
    ]);
  });

  it("keeps directory rows usable and warns when activity lookup fails", async () => {
    const report = await loadUserAccountsReport(
      buildClient(
        [{ id: "u1", email: "one@example.com", created_at: "2026-04-01" }],
        [
          {
            table: "user_video_history",
            response: { data: null, error: { message: "activity unavailable" } },
          },
        ],
      ),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: null,
      },
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      userId: "u1",
      summaries: 0,
      whisperPct: 0,
      lastActivity: null,
    });
    expect(report.warnings).toEqual([
      {
        code: "USER_ACCOUNT_ACTIVITY_UNAVAILABLE",
        description: expect.any(String),
      },
    ]);
    expect(report.warnings[0].description).not.toContain("activity unavailable");
  });

  it("throws the recognized admin data error when directory enumeration fails", async () => {
    const client = {
      from: vi.fn(),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: null,
            error: { message: "directory unavailable" },
          })),
        },
      },
    } as unknown as SupabaseClient;

    await expect(
      loadUserAccountsReport(client, {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: null,
      }),
    ).rejects.toMatchObject({
      name: "QueryError",
      message: expect.stringContaining("directory unavailable"),
    });
  });

  it("warns when the activity row cap is reached", async () => {
    const history = Array.from({ length: 100_000 }, (_, index) => ({
      user_id: "u1",
      video_id: "v1",
      created_at: `2026-04-29T${String(index % 24).padStart(2, "0")}:00:00Z`,
    }));
    const report = await loadUserAccountsReport(
      buildClient(
        [{ id: "u1", email: "one@example.com", created_at: "2026-04-01" }],
        [
          {
            table: "user_video_history",
            response: { data: history, error: null },
          },
          {
            table: "summaries",
            response: {
              data: [{ video_id: "v1", transcript_source: "whisper" }],
              error: null,
            },
          },
        ],
      ),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: null,
      },
    );

    expect(report.rows[0]).toMatchObject({
      summaries: 100_000,
      whisperPct: 100,
      flagged: true,
    });
    expect(report.warnings).toEqual([
      {
        code: "USER_ACCOUNT_ACTIVITY_TRUNCATED",
        description: expect.any(String),
      },
    ]);
  });

  it("loads bounded Summary history and relevant Audit events only for a visible expansion", async () => {
    const report = await loadUserAccountsReport(
      buildClient(
        [{ id: "u1", email: "one@example.com", created_at: "2026-04-01" }],
        [
          { table: "user_video_history", response: { data: [], error: null } },
          {
            table: "user_video_history",
            response: {
              data: [
                { video_id: "v1", created_at: "2026-04-29T12:00:00Z" },
              ],
              error: null,
            },
            expect: (calls) => {
              expect(calls.find((call) => call.method === "limit")?.args).toEqual([
                25,
              ]);
            },
          },
          {
            table: "admin_audit_log",
            response: {
              data: [
                {
                  id: "audit-1",
                  created_at: "2026-04-29T13:00:00Z",
                  admin_id: "admin-1",
                  admin_email: "admin@example.com",
                  action: "view_transcript",
                  resource_type: "user",
                  resource_id: "u1",
                  metadata: {},
                },
              ],
              error: null,
            },
            expect: (calls) => {
              expect(calls.find((call) => call.method === "limit")?.args).toEqual([
                10,
              ]);
              expect(String(calls.find((call) => call.method === "or")?.args[0])).toContain(
                "metadata->>viewed_user_id.eq.u1",
              );
            },
          },
          {
            table: "videos",
            response: {
              data: [
                { id: "v1", title: "Talk", channel_name: "Channel", language: "en" },
              ],
              error: null,
            },
          },
          {
            table: "summaries",
            response: {
              data: [
                {
                  id: "summary-1",
                  video_id: "v1",
                  transcript_source: "whisper",
                  model: "claude-opus-4-7",
                  processing_time_seconds: 12,
                },
              ],
              error: null,
            },
          },
        ],
      ),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: "u1",
      },
    );

    expect(report.expanded).toMatchObject({
      accountId: "u1",
      summaries: [
        {
          videoId: "v1",
          videoTitle: "Talk",
          source: "whisper",
          summaryId: "summary-1",
        },
      ],
      audit: [{ id: "audit-1", action: "view_transcript" }],
    });
  });

  it("ignores expansion when the requested account is not on the current page", async () => {
    const users = Array.from({ length: 30 }, (_, index) => ({
      id: `u-${String(index).padStart(2, "0")}`,
      email: `${String(index).padStart(2, "0")}@example.com`,
      created_at: "2026-04-01",
    }));
    const client = buildClient(users, [
      { table: "user_video_history", response: { data: [], error: null } },
    ]);
    const report = await loadUserAccountsReport(client, {
      search: null,
      tab: "all",
      sort: "email",
      direction: "asc",
      page: 2,
      expandedAccountId: "u-00",
    });

    expect(report.expanded).toBeNull();
    expect((client.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("keeps the expanded row usable when Audit history is unavailable", async () => {
    const report = await loadUserAccountsReport(
      buildClient(
        [{ id: "u1", email: "one@example.com", created_at: "2026-04-01" }],
        [
          { table: "user_video_history", response: { data: [], error: null } },
          { table: "user_video_history", response: { data: [], error: null } },
          {
            table: "admin_audit_log",
            response: { data: null, error: { message: "audit unavailable" } },
          },
        ],
      ),
      {
        search: null,
        tab: "all",
        sort: "createdAt",
        direction: "desc",
        page: 1,
        expandedAccountId: "u1",
      },
    );

    expect(report.expanded).toMatchObject({ accountId: "u1", summaries: [], audit: [] });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("audit history unavailable"),
      expect.objectContaining({ userId: "u1" }),
    );
  });
});
