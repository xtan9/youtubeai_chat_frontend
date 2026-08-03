import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { loadAdminShell } from "../admin-shell";
import type { SupabaseClient } from "@supabase/supabase-js";

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
