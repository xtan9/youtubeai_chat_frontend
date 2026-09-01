import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getServiceRoleClient } = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient,
}));

import { resolveYouTubeScanTarget } from "../youtube-target";

const TARGET = {
  accountId: "00000000-0000-4000-8000-000000000010",
  channelId: "00000000-0000-4000-8000-000000000011",
  connectedChannelId: "00000000-0000-4000-8000-000000000012",
  grantId: "00000000-0000-4000-8000-000000000013",
  providerSubject: "provider-subject",
  providerChannelId: "UCverifiedcreator",
  displayName: "Supported Creator",
  identityVerified: true,
  supportedCreator: true,
  readScopeGranted: true,
  status: "active" as const,
};

describe("resolveYouTubeScanTarget", () => {
  it("requires the server-owned target RPC and never accepts browser identity data", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: TARGET, error: null });
    getServiceRoleClient.mockReturnValue({ rpc });

    await expect(
      resolveYouTubeScanTarget({
        accountId: TARGET.accountId,
        connectedChannelId: TARGET.connectedChannelId,
      }),
    ).resolves.toEqual(TARGET);
    expect(rpc).toHaveBeenCalledWith("resolve_channel_scan_target", {
      p_account_id: TARGET.accountId,
      p_connected_channel_id: TARGET.connectedChannelId,
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_provider_channel_id");
  });

  it("fails closed for missing persistence or malformed target data", async () => {
    getServiceRoleClient.mockReturnValue(null);
    await expect(
      resolveYouTubeScanTarget({
        accountId: TARGET.accountId,
        connectedChannelId: TARGET.connectedChannelId,
      }),
    ).resolves.toBeNull();

    const rpc = vi.fn().mockResolvedValue({
      data: { ...TARGET, writeScopeGranted: true },
      error: null,
    });
    getServiceRoleClient.mockReturnValue({ rpc });
    await expect(
      resolveYouTubeScanTarget({
        accountId: TARGET.accountId,
        connectedChannelId: TARGET.connectedChannelId,
      }),
    ).rejects.toThrow("verified YouTube scan target is unavailable");
  });
});
