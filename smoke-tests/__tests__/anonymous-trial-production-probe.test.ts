import { describe, expect, it, vi } from "vitest";
import {
  deleteAnonymousProductionProbe,
  markAnonymousProductionProbe,
  refreshAnonymousProductionProbeSession,
} from "../anonymous-trial-production-probe";

describe("Anonymous Trial production probe identity", () => {
  it("marks only an authenticated anonymous identity using trusted app metadata", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "anon-1",
            is_anonymous: true,
            app_metadata: { provider: "anonymous" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "anon-1",
            is_anonymous: true,
            app_metadata: { is_smoke_account: true },
          }),
        ),
      );
    await expect(
      markAnonymousProductionProbe({
        accessToken: "private-access-token",
        supabaseUrl: "https://db.example.test",
        serviceRoleKey: "private-service-key",
        fetchImpl,
      }),
    ).resolves.toBe("anon-1");
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        app_metadata: {
          provider: "anonymous",
          is_smoke_account: true,
        },
      }),
    });
  });

  it("rejects a registered identity before the admin mutation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "human-1", is_anonymous: false })),
    );
    await expect(
      markAnonymousProductionProbe({
        accessToken: "token",
        supabaseUrl: "https://db.example.test",
        serviceRoleKey: "secret",
        fetchImpl,
      }),
    ).rejects.toThrow(/not an anonymous user/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("deletes the bounded synthetic identity without leaking credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAnonymousProductionProbe(
      "anon-1",
      "https://db.example.test",
      "private-service-key",
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://db.example.test/auth/v1/admin/users/anon-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("refreshes the JWT and requires the trusted marker in the returned session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access",
          refresh_token: "refreshed-refresh",
          user: {
            id: "anon-1",
            is_anonymous: true,
            app_metadata: { is_smoke_account: true },
          },
        }),
      ),
    );
    await expect(
      refreshAnonymousProductionProbeSession(
        "anon-1",
        "old-refresh",
        "https://db.example.test",
        "secret",
        fetchImpl,
      ),
    ).resolves.toMatchObject({ access_token: "refreshed-access" });
  });
});
