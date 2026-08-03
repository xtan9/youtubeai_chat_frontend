import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadAuditReport } from "../audit-report";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ChainCall {
  method: string;
  args: unknown[];
}

interface SelectScript {
  response: { data: unknown; error: unknown };
  expect?: (calls: ChainCall[]) => void;
}

function buildClient(
  scripts: SelectScript[],
): SupabaseClient {
  let index = 0;
  const from = vi.fn(() => {
    const script = scripts[index++];
    if (!script) throw new Error("unexpected Supabase query");

    const calls: ChainCall[] = [];
    const proxy: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) => {
        script.expect?.(calls);
        resolve(script.response);
      },
    };
    for (const method of ["select", "or", "order", "limit"]) {
      proxy[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return proxy;
      };
    }
    return proxy;
  });

  return { from } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadAuditReport", () => {
  it("returns the empty operational report when no events exist", async () => {
    const client = buildClient([{ response: { data: [], error: null } }]);

    await expect(loadAuditReport(client)).resolves.toEqual({
      rows: [],
      nextCursor: null,
    });
  });

  it("maps rows newest-first and caps the page-size query with a peek row", async () => {
    const rows = [
      {
        id: "new",
        created_at: "2026-04-29T12:00:01Z",
        admin_id: "admin-1",
        admin_email: "alice@example.com",
        action: "view_transcript",
        resource_type: "summary",
        resource_id: "sum-1",
        metadata: { viewed_user_id: "user-1" },
      },
      {
        id: "old",
        created_at: "2026-04-29T12:00:00Z",
        admin_id: "admin-2",
        admin_email: "bob@example.com",
        action: "reset_rate_limit",
        resource_type: "rate_limit",
        resource_id: "user-2",
        metadata: {},
      },
      {
        id: "peek",
        created_at: "2026-04-29T11:59:00Z",
        admin_id: "admin-3",
        admin_email: "carol@example.com",
        action: "suspend_user",
        resource_type: "user",
        resource_id: "user-3",
        metadata: {},
      },
    ];
    const client = buildClient([
      {
        response: { data: rows, error: null },
        expect: (calls) => {
          expect(
            calls
              .filter((call) => call.method === "order")
              .map((call) => call.args),
          ).toEqual([
            ["created_at", { ascending: false }],
            ["id", { ascending: false }],
          ]);
          expect(calls.find((call) => call.method === "limit")?.args).toEqual([
            201,
          ]);
        },
      },
    ]);

    const result = await loadAuditReport(client, { pageSize: 500 });

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      id: "new",
      createdAt: "2026-04-29T12:00:01Z",
      adminId: "admin-1",
      adminEmail: "alice@example.com",
      action: "view_transcript",
      resourceType: "summary",
      resourceId: "sum-1",
      metadata: { viewed_user_id: "user-1" },
    });
    expect(result.nextCursor).toBeNull();
  });

  it("round-trips the next cursor into a keyset filter", async () => {
    const firstPage = buildClient([
      {
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
              metadata: {},
            },
            {
              id: "row-2",
              created_at: "2026-04-29T11:59:00Z",
              admin_id: "admin-2",
              admin_email: "bob@example.com",
              action: "view_summary_text",
              resource_type: "summary",
              resource_id: "sum-2",
              metadata: {},
            },
            {
              id: "row-3",
              created_at: "2026-04-29T11:58:00Z",
              admin_id: "admin-3",
              admin_email: "carol@example.com",
              action: "suspend_user",
              resource_type: "user",
              resource_id: "user-3",
              metadata: {},
            },
          ],
          error: null,
        },
      },
    ]);

    const first = await loadAuditReport(firstPage, { pageSize: 2 });
    expect(first.nextCursor).not.toBeNull();

    let capturedFilter = "";
    const secondPage = buildClient([
      {
        response: { data: [], error: null },
        expect: (calls) => {
          capturedFilter = String(
            calls.find((call) => call.method === "or")?.args[0] ?? "",
          );
        },
      },
    ]);

    await expect(
      loadAuditReport(secondPage, {
        pageSize: 2,
        cursor: first.nextCursor,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    expect(capturedFilter).toContain("created_at.lt.2026-04-29T11:59:00Z");
    expect(capturedFilter).toContain("id.lt.row-2");
  });

  it("falls back to the first page when the cursor is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let receivedCursorFilter = false;
    const client = buildClient([
      {
        response: { data: [], error: null },
        expect: (calls) => {
          receivedCursorFilter = calls.some((call) => call.method === "or");
        },
      },
    ]);

    await expect(
      loadAuditReport(client, { cursor: "not-base64-at-all" }),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    expect(receivedCursorFilter).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps unknown persisted action and resource vocabulary visible", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = buildClient([
      {
        response: {
          data: [
            {
              id: "row-1",
              created_at: "2026-04-29T12:00:00Z",
              admin_id: "admin-1",
              admin_email: "alice@example.com",
              action: "future_action",
              resource_type: "future_resource",
              resource_id: "resource-1",
              metadata: "not-an-object",
            },
          ],
          error: null,
        },
      },
    ]);

    const result = await loadAuditReport(client);

    expect(result.rows[0]).toMatchObject({
      action: "future_action",
      resourceType: "future_resource",
      metadata: {},
    });
    expect(error.mock.calls.filter(([message]) =>
      String(message).includes("unknown persisted"),
    )).toHaveLength(2);
  });

  it("throws the recognized admin data error for a primary dataset failure", async () => {
    const client = buildClient([
      { response: { data: null, error: { message: "table missing" } } },
    ]);

    await expect(loadAuditReport(client)).rejects.toMatchObject({
      name: "QueryError",
      message: expect.stringContaining("table missing"),
    });
  });
});
