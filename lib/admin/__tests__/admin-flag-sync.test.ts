import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reconcileAdminFlags,
  __resetReconcileCooldownForTests,
} from "../admin-flag-sync";

interface FakeUser {
  id: string;
  email: string | null;
  app_metadata?: Record<string, unknown>;
}

function buildClient(
  users: FakeUser[],
  updateBehavior: (id: string, patch: Record<string, unknown>) =>
    | { error: null }
    | { error: { message: string } } = () => ({ error: null }),
): SupabaseClient {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return {
    from: vi.fn(),
    auth: {
      admin: {
        listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => {
          if (page !== 1) {
            return { data: { users: [], total: users.length }, error: null };
          }
          return {
            data: { users: users.slice(0, perPage), total: users.length },
            error: null,
          };
        }),
        updateUserById: vi.fn(async (id: string, patch: Record<string, unknown>) => {
          updates.push({ id, patch });
          return updateBehavior(id, patch);
        }),
        // Surface mock recorder for assertions.
        __updates: updates,
      },
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  __resetReconcileCooldownForTests();
});

describe("reconcileAdminFlags", () => {
  it("promotes a user whose email is in the allowlist but flag is missing", async () => {
    const client = buildClient([
      { id: "u-1", email: "alice@x.com" },
    ]);
    const out = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(out).toEqual({ checked: 1, promoted: 1, demoted: 0, failed: 0, truncated: false, skipped: false, ok: true });
    const updates = (client.auth.admin as unknown as { __updates: Array<{ id: string; patch: Record<string, unknown> }> }).__updates;
    expect(updates).toEqual([
      { id: "u-1", patch: { app_metadata: { is_admin: true } } },
    ]);
  });

  it("demotes a user whose flag is true but email is not in allowlist", async () => {
    const client = buildClient([
      { id: "u-2", email: "ex-admin@x.com", app_metadata: { is_admin: true, other: "preserved" } },
    ]);
    const out = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(out).toEqual({ checked: 1, promoted: 0, demoted: 1, failed: 0, truncated: false, skipped: false, ok: true });
    const updates = (client.auth.admin as unknown as { __updates: Array<{ id: string; patch: Record<string, unknown> }> }).__updates;
    expect(updates).toEqual([
      { id: "u-2", patch: { app_metadata: { is_admin: false, other: "preserved" } } },
    ]);
  });

  it("is a no-op for users whose flag matches expected", async () => {
    const client = buildClient([
      { id: "u-1", email: "alice@x.com", app_metadata: { is_admin: true } },
      { id: "u-2", email: "bob@x.com", app_metadata: { is_admin: false } },
      { id: "u-3", email: "carol@x.com" }, // no flag, not admin → expected
    ]);
    const out = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(out).toEqual({ checked: 3, promoted: 0, demoted: 0, failed: 0, truncated: false, skipped: false, ok: true });
    const updates = (client.auth.admin as unknown as { __updates: Array<{ id: string; patch: Record<string, unknown> }> }).__updates;
    expect(updates).toEqual([]);
  });

  it("is case-insensitive on email match", async () => {
    const client = buildClient([
      { id: "u-1", email: "Alice@X.com" },
    ]);
    const out = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(out.promoted).toBe(1);
  });

  it("counts and logs but does not throw on per-row updateUserById error", async () => {
    const client = buildClient(
      [
        { id: "u-1", email: "alice@x.com" },
        { id: "u-2", email: "bob@x.com" },
      ],
      (id) => (id === "u-1" ? { error: { message: "auth busy" } } : { error: null }),
    );
    const out = await reconcileAdminFlags(client, new Set(["alice@x.com", "bob@x.com"]));
    expect(out).toEqual({ checked: 2, promoted: 1, demoted: 0, failed: 1, truncated: false, skipped: false, ok: false });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reconcileAdminFlags: updateUserById failed"),
      expect.objectContaining({ userId: "u-1" }),
    );
  });

  it("ignores users with no email (anonymous accounts)", async () => {
    const client = buildClient([
      { id: "u-anon", email: null },
    ]);
    const out = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(out).toEqual({ checked: 1, promoted: 0, demoted: 0, failed: 0, truncated: false, skipped: false, ok: true });
  });

  it("short-circuits within cooldown window and returns skipped:true", async () => {
    const client = buildClient([
      { id: "u-1", email: "alice@x.com" },
    ]);
    // First call runs.
    const first = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(first.skipped).toBe(false);
    expect(first.promoted).toBe(1);
    // Second call within cooldown is skipped.
    const second = await reconcileAdminFlags(client, new Set(["alice@x.com"]));
    expect(second).toEqual({
      checked: 0,
      promoted: 0,
      demoted: 0,
      failed: 0,
      truncated: false,
      skipped: true,
      ok: true,
    });
    // The mock should NOT have been hit again — verify by listUsers calls.
    const listUsersMock = (client.auth.admin as unknown as { listUsers: { mock: { calls: unknown[] } } }).listUsers;
    expect(listUsersMock.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
