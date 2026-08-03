import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAdminShell } from "../admin-shell";

function buildClient(
  users: Array<{
    id: string;
    email: string | null;
    is_anonymous?: boolean;
    app_metadata?: Record<string, unknown>;
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
