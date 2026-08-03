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
import { QueryError } from "../errors";
import { listUserAccounts } from "../user-account-directory";

interface AuthUserFixture {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  deleted_at?: string | null;
  is_anonymous?: boolean;
  is_sso_user?: boolean;
  identities?: Array<{ provider?: string }>;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

function buildClient(
  pages: Array<{ users: AuthUserFixture[]; total?: number }>,
  error?: { message: string } | null,
): SupabaseClient {
  const listUsers = vi.fn(async ({ page }: { page: number; perPage: number }) => {
    if (error) return { data: null, error };
    const result = pages[page - 1] ?? { users: [] };
    return {
      data: { ...result, total: result.total ?? pages[0]?.total ?? result.users.length },
      error: null,
    };
  });

  return {
    auth: { admin: { listUsers } },
  } as unknown as SupabaseClient;
}

describe("listUserAccounts", () => {
  it("pages through auth users, maps account fields, and identifies administrators", async () => {
    const secondPageUser = {
      id: "u-2",
      email: null,
      created_at: "2026-01-02T00:00:00Z",
    };
    const client = buildClient([
      {
        users: [
          {
            id: "u-1",
            email: "Admin@Example.com",
            created_at: "2026-01-01T00:00:00Z",
            last_sign_in_at: "2026-02-01T00:00:00Z",
            email_confirmed_at: "2026-01-01T00:00:00Z",
            banned_until: null,
            deleted_at: null,
            is_anonymous: false,
            is_sso_user: true,
            identities: [{ provider: "google" }, { provider: "google" }],
            app_metadata: { is_admin: true, plan: "pro" },
            user_metadata: { display_name: "Admin" },
          },
          ...Array.from({ length: 199 }, (_, index) => ({
            id: `filler-${index}`,
            email: `filler-${index}@example.com`,
          })),
        ],
        total: 201,
      },
      { users: [secondPageUser] },
    ]);

    const result = await listUserAccounts(client);

    expect(result.total).toBe(201);
    expect(result.truncated).toBe(false);
    expect(result.users).toHaveLength(201);
    expect(result.users[0]).toEqual({
      id: "u-1",
      email: "Admin@Example.com",
      createdAt: "2026-01-01T00:00:00Z",
      lastSignInAt: "2026-02-01T00:00:00Z",
      emailConfirmedAt: "2026-01-01T00:00:00Z",
      bannedUntil: null,
      deletedAt: null,
      isAnonymous: false,
      isSsoUser: true,
      providers: ["google"],
      appMetadata: { is_admin: true, plan: "pro" },
      userMetadata: { display_name: "Admin" },
      isAdministrator: true,
    });
    expect(result.users.at(-1)).toMatchObject({
      id: "u-2",
      email: null,
      isAdministrator: false,
    });
    expect((client.auth.admin.listUsers as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      [{ page: 1, perPage: 200 }],
      [{ page: 2, perPage: 200 }],
    ]);
  });

  it("stops at the row cap while preserving the provider total and truncation signal", async () => {
    const client = buildClient([
      {
        users: [
          { id: "u-1", email: "one@example.com" },
          { id: "u-2", email: "two@example.com" },
          { id: "u-3", email: "three@example.com" },
        ],
        total: 3,
      },
    ]);

    const result = await listUserAccounts(client, { rowCap: 2 });

    expect(result.users.map((user) => user.id)).toEqual(["u-1", "u-2"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("throws the recognized admin data error when enumeration fails", async () => {
    const client = buildClient([], { message: "auth unavailable" });

    await expect(listUserAccounts(client)).rejects.toBeInstanceOf(QueryError);
  });

  it("normalizes thrown provider failures to the recognized admin data error", async () => {
    const client = {
      auth: {
        admin: {
          listUsers: vi.fn(async () => {
            throw new Error("auth request rejected");
          }),
        },
      },
    } as unknown as SupabaseClient;

    await expect(listUserAccounts(client)).rejects.toBeInstanceOf(QueryError);
  });

  it("normalizes effective options before request-scoped memoization", async () => {
    const client = buildClient([
      {
        users: [{ id: "u-1", email: "one@example.com" }],
        total: 1,
      },
    ]);

    await Promise.all([
      listUserAccounts(client, { rowCap: 10 }),
      listUserAccounts(client, { rowCap: 10 }),
    ]);

    expect((client.auth.admin.listUsers as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
