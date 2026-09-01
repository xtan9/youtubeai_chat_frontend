// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/entitlements", () => ({
  resolveRegisteredSubscription: vi.fn(),
}));
vi.mock("@/lib/channel-exposure/server", () => ({
  loadChannelAccessSnapshot: vi.fn(),
  loadConnectedChannelHubState: vi.fn(),
  loadOwnedVideoFilter: vi.fn(),
}));

import ChannelPage from "../page";

describe("Channel route release boundary", () => {
  it("does not render the Hub while the checked-in launch packet is pending", async () => {
    const element = await ChannelPage({
      searchParams: Promise.resolve({}),
    });

    render(element);

    expect(
      screen.getByRole("heading", { name: "Channel is not available yet" }),
    ).toBeTruthy();
    expect(screen.queryByRole("main", { name: "Channel Hub" })).toBeNull();
  });
});
