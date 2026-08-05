import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAdminShell } from "../admin-shell";

afterEach(() => {
  vi.restoreAllMocks();
});

function buildClient(
  users: Array<{
    id: string;
    email: string | null;
    is_anonymous?: boolean;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  }>,
  error?: { message: string } | null,
): SupabaseClient {
  return {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: error ? null : { users, total: users.length },
          error: error ?? null,
        })),
      },
    },
  } as unknown as SupabaseClient;
}

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

    await expect(
      loadAdminShell(client, { allowlist: ["admin@example.com"] }),
    ).resolves.toMatchObject({ usersTotal: 2 });
  });

  it("treats allowlist comparison as case-insensitive", async () => {
    const client = buildClient([
      { id: "u1", email: "Owner@Example.com", is_anonymous: false },
    ]);

    await expect(
      loadAdminShell(client, { allowlist: ["owner@example.com"] }),
    ).resolves.toMatchObject({ usersTotal: 0 });
  });

  it("logs and returns a null count when listUsers fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = buildClient([], { message: "auth down" });
    const result = await loadAdminShell(client, { allowlist: [] });

    expect(result.usersTotal).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("User Account total unavailable"),
      expect.any(Object),
    );
  });

  it("paginates through multiple account pages", async () => {
    const pageOne = Array.from({ length: 200 }, (_, index) => ({
      id: `p1-${index}`,
      email: `p1-${index}@example.com`,
      is_anonymous: false,
    }));
    const pageTwo = Array.from({ length: 50 }, (_, index) => ({
      id: `p2-${index}`,
      email: `p2-${index}@example.com`,
      is_anonymous: false,
    }));
    const pages = [
      { users: pageOne, total: 250 },
      { users: pageTwo, total: 250 },
    ];
    let page = 0;
    const client = {
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: pages[page++] ?? { users: [], total: 250 },
            error: null,
          })),
        },
      },
    } as unknown as SupabaseClient;

    await expect(loadAdminShell(client, { allowlist: [] })).resolves.toMatchObject({
      usersTotal: 250,
    });
  });

  it("counts registered accounts while excluding anonymous, missing-email, and allowlisted admin accounts", async () => {
    const client = buildClient([
      { id: "u-1", email: "learner@example.com" },
      { id: "u-2", email: "ADMIN@EXAMPLE.COM", app_metadata: { is_admin: true } },
      { id: "u-3", email: null },
      { id: "u-4", email: "anon@example.com", is_anonymous: true },
    ]);

    await expect(
      loadAdminShell(client, { allowlist: ["admin@example.com"] }),
    ).resolves.toEqual({
      usersTotal: 1,
      warnings: [],
    });
  });

  it("excludes trusted Smoke Accounts from the human account total", async () => {
    const client = buildClient([
      { id: "human", email: "learner@example.com" },
      {
        id: "smoke",
        email: "smoke@example.com",
        app_metadata: { is_smoke_account: true },
      },
      {
        id: "user-marked",
        email: "marked@example.com",
        user_metadata: { is_smoke_account: true },
      },
    ]);

    await expect(loadAdminShell(client, { allowlist: [] })).resolves.toMatchObject({
      usersTotal: 2,
    });
  });

  it("excludes both administrator and non-administrator Smoke Accounts from the human total", async () => {
    const client = buildClient([
      { id: "human", email: "learner@example.com" },
      {
        id: "administrator",
        email: "admin@example.com",
        app_metadata: { is_admin: true },
      },
      { id: "anonymous", email: null, is_anonymous: true },
      {
        id: "administrator-smoke",
        email: "administrator-smoke@example.com",
        app_metadata: { is_admin: true, is_smoke_account: true },
      },
      {
        id: "smoke",
        email: "smoke@example.com",
        app_metadata: { is_smoke_account: true },
      },
    ]);

    await expect(
      loadAdminShell(client, { allowlist: ["admin@example.com"] }),
    ).resolves.toMatchObject({ usersTotal: 1 });
  });

  it("keeps the shell usable and reports a serializable warning when enumeration is unavailable", async () => {
    const result = await loadAdminShell(
      buildClient([], { message: "auth unavailable" }),
      { allowlist: [] },
    );

    expect(result.usersTotal).toBeNull();
    expect(result.warnings).toEqual([
      {
        code: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
        description: "User Account total is unavailable because account enumeration failed.",
      },
    ]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("retains the observed count and warns when enumeration is capped", async () => {
    const client = buildClient(
      Array.from({ length: 5_001 }, (_, i) => ({
        id: `u-${i}`,
        email: `user-${i}@example.com`,
      })),
    );

    const result = await loadAdminShell(client, {
      allowlist: [],
    });

    expect(result).toEqual({
      usersTotal: 5_000,
      warnings: [
        {
          code: "USER_ACCOUNT_DIRECTORY_TRUNCATED",
          description: "User Account total may be incomplete because account enumeration reached its row cap.",
        },
      ],
    });
  });
});
