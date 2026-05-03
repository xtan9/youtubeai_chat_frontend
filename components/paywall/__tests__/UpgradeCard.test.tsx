// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureMock = vi.fn();
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: captureMock }),
}));

const useEntitlementsMock = vi.fn();
vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: () => useEntitlementsMock(),
}));

import { UpgradeCard } from "../UpgradeCard";

function entitlements(used: number, limit = 10, tier: "anon" | "free" | "pro" = "free") {
  return {
    data: {
      tier,
      caps: {
        summariesUsed: used,
        summariesLimit: limit,
      },
    },
    isPending: false,
    isError: false,
  };
}

beforeEach(() => {
  captureMock.mockClear();
  useEntitlementsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("UpgradeCard summary-cap", () => {
  it("renders the celebratory headline with dynamic count + time saved when usage >= 2", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/summarized 10 videos this month/i)).not.toBeNull();
    // 10 * 15min = 150min => 2h 30m
    expect(screen.getByText(/2h 30m of YouTube saved/i)).not.toBeNull();
  });

  it("uses singular video noun when count is 1 (and falls back to non-celebratory headline)", () => {
    useEntitlementsMock.mockReturnValue(entitlements(1));
    render(<UpgradeCard variant="summary-cap" />);
    // 1 used: below celebration threshold — uses fallback headline
    expect(screen.getByText(/reached your free summary limit/i)).not.toBeNull();
  });

  it("renders the three Pro benefits with checkmarks", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/Unlimited summaries/i)).not.toBeNull();
    expect(screen.getByText(/Unlimited AI Chat/i)).not.toBeNull();
    expect(screen.getByText(/Permanent history/i)).not.toBeNull();
  });

  it("renders both CTAs as links pointing to /pricing", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    const upgradeLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/pricing");
    expect(upgradeLinks.length).toBe(2);
    expect(screen.getByRole("link", { name: /unlock pro — \$4\.99/i })).not.toBeNull();
    expect(screen.getByRole("link", { name: /see plans/i })).not.toBeNull();
  });

  it("shows the reset date footer", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/free tier resets/i)).not.toBeNull();
    expect(screen.getByText(/cancel anytime/i)).not.toBeNull();
  });

  it("falls back to the static headline when entitlements data is unavailable", () => {
    useEntitlementsMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/reached your free summary limit/i)).not.toBeNull();
  });

  it("fires paywall_cap_hit_viewed on mount and paywall_cap_cta_clicked on CTA click", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);

    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_hit_viewed",
      expect.objectContaining({
        variant: "summary-cap",
        tier: "free",
        summaries_used: 10,
        summaries_limit: 10,
      })
    );

    fireEvent.click(screen.getByRole("link", { name: /unlock pro/i }));
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_cta_clicked",
      expect.objectContaining({ variant: "summary-cap", cta: "primary", tier: "free" })
    );

    fireEvent.click(screen.getByRole("link", { name: /see plans/i }));
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_cta_clicked",
      expect.objectContaining({ variant: "summary-cap", cta: "secondary", tier: "free" })
    );
  });
});

describe("UpgradeCard chat-cap", () => {
  it("renders chat-cap headline + Pro benefits ordered with chat first", () => {
    useEntitlementsMock.mockReturnValue(entitlements(0));
    render(<UpgradeCard variant="chat-cap" />);
    expect(screen.getByText(/used your free chats on this video/i)).not.toBeNull();
    expect(screen.getByText(/Unlimited AI Chat across every video/i)).not.toBeNull();
  });
});

describe("UpgradeCard history-cap", () => {
  it("renders history-cap headline + Pro benefits ordered with history first", () => {
    useEntitlementsMock.mockReturnValue(entitlements(0));
    render(<UpgradeCard variant="history-cap" />);
    expect(screen.getByText(/free history is full/i)).not.toBeNull();
    expect(screen.getByText(/Permanent history/i)).not.toBeNull();
  });
});

describe("UpgradeCard analytics attribute", () => {
  it("exposes the variant via data attribute", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    const { container } = render(<UpgradeCard variant="summary-cap" />);
    expect(container.querySelector('[data-paywall-variant="summary-cap"]')).not.toBeNull();
  });
});
