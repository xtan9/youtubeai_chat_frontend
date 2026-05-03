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

type Tier = "anon" | "free" | "pro";
function entitlements(used: number, limit = 10, tier: Tier = "free") {
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
    error: null,
  };
}

beforeEach(() => {
  captureMock.mockClear();
  useEntitlementsMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UpgradeCard summary-cap — celebration path", () => {
  it("renders celebratory headline with dynamic count + time saved when usage >= 2", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/summarized 10 videos this month/i)).not.toBeNull();
    // 10 * 15min = 150min => 2h 30m
    expect(screen.getByText(/2h 30m of YouTube saved/i)).not.toBeNull();
  });

  it("celebrates at the threshold (usage = 2)", () => {
    useEntitlementsMock.mockReturnValue(entitlements(2));
    render(<UpgradeCard variant="summary-cap" />);
    // 2 * 15min = 30min (hours===0 branch)
    expect(screen.getByText(/summarized 2 videos this month/i)).not.toBeNull();
    expect(screen.getByText(/30 min of YouTube saved/i)).not.toBeNull();
  });

  it("formats exactly 1 hour as singular (4 videos)", () => {
    useEntitlementsMock.mockReturnValue(entitlements(4));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/≈ 1 hour of YouTube saved/i)).not.toBeNull();
  });

  it("formats whole hours as plural (8 videos = 2 hours)", () => {
    useEntitlementsMock.mockReturnValue(entitlements(8));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/≈ 2 hours of YouTube saved/i)).not.toBeNull();
  });

  it("caps displayed count at the limit when a race pushes used past limit", () => {
    useEntitlementsMock.mockReturnValue(entitlements(15, 10));
    render(<UpgradeCard variant="summary-cap" />);
    // Used should be clamped to the cap (10), not surface as "15 videos"
    expect(screen.getByText(/summarized 10 videos this month/i)).not.toBeNull();
    expect(screen.queryByText(/15 videos/i)).toBeNull();
  });
});

describe("UpgradeCard summary-cap — fallback paths", () => {
  it("uses fallback headline when usage is below threshold (1 video)", () => {
    useEntitlementsMock.mockReturnValue(entitlements(1));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/reached your free summary limit/i)).not.toBeNull();
  });

  it("uses fallback headline when entitlements data is unavailable", () => {
    useEntitlementsMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/reached your free summary limit/i)).not.toBeNull();
  });

  it("uses fallback headline when entitlements errored (does not pretend a celebration)", () => {
    useEntitlementsMock.mockReturnValue({
      data: { tier: "free", caps: { summariesUsed: 10, summariesLimit: 10 } },
      isPending: false,
      isError: true,
      error: new Error("entitlements 503"),
    });
    render(<UpgradeCard variant="summary-cap" />);
    // Even though `data` is populated, isError forces the neutral headline
    expect(screen.getByText(/reached your free summary limit/i)).not.toBeNull();
    expect(screen.queryByText(/summarized 10 videos/i)).toBeNull();
  });
});

describe("UpgradeCard summary-cap — structure", () => {
  it("renders exactly three Pro benefits, each preceded by a check icon", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    const { container } = render(<UpgradeCard variant="summary-cap" />);
    expect(container.querySelectorAll("li").length).toBe(3);
    expect(
      container.querySelectorAll('[data-testid="upgrade-card-bullet-check"]').length,
    ).toBe(3);
    expect(screen.getByText(/Unlimited summaries — no monthly cap/i)).not.toBeNull();
    expect(
      screen.getByText(/Unlimited AI Chat — ask follow-ups across every video/i),
    ).not.toBeNull();
    expect(screen.getByText(/Permanent history — never auto-replaced/i)).not.toBeNull();
  });

  it("renders both CTAs as anchors pointing to /pricing", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    const upgradeLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/pricing");
    expect(upgradeLinks.length).toBe(2);
    expect(screen.getByRole("link", { name: /unlock pro — \$4\.99/i })).not.toBeNull();
    expect(screen.getByRole("link", { name: /see plans/i })).not.toBeNull();
  });
});

describe("UpgradeCard summary-cap — reset date footer", () => {
  it("formats the next-month-1st reset date in local time (not UTC instant)", () => {
    // Pin system clock so the rendered date is deterministic. Use mid-month
    // to keep this test stable across timezones — we're specifically NOT
    // testing the timezone-edge-case here, just that the formatter prints
    // the next month's name and "1".
    vi.useFakeTimers().setSystemTime(new Date("2026-05-15T12:00:00Z"));
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/Free tier resets June 1/i)).not.toBeNull();
    expect(screen.getByText(/Cancel anytime/i)).not.toBeNull();
  });

  it("rolls year boundary correctly", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-12-15T12:00:00Z"));
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(screen.getByText(/Free tier resets January 1/i)).not.toBeNull();
  });
});

describe("UpgradeCard analytics", () => {
  it("fires paywall_cap_hit_viewed once on mount with full payload", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_hit_viewed",
      {
        variant: "summary-cap",
        tier: "free",
        summaries_used: 10,
        summaries_limit: 10,
      },
    );
  });

  it("propagates anon tier in payload", () => {
    useEntitlementsMock.mockReturnValue(entitlements(1, 1, "anon"));
    render(<UpgradeCard variant="summary-cap" />);
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_hit_viewed",
      expect.objectContaining({ tier: "anon", summaries_used: 1, summaries_limit: 1 }),
    );
  });

  it("emits null tier/usage when entitlements data is unavailable but errored", () => {
    useEntitlementsMock.mockReturnValue({ data: undefined, isPending: false, isError: true, error: new Error("x") });
    render(<UpgradeCard variant="summary-cap" />);
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_hit_viewed",
      { variant: "summary-cap", tier: null, summaries_used: null, summaries_limit: null },
    );
  });

  it("does NOT fire paywall_cap_hit_viewed before entitlements resolve", () => {
    useEntitlementsMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<UpgradeCard variant="summary-cap" />);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("does NOT re-fire paywall_cap_hit_viewed when entitlements refetch with new values", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    const { rerender } = render(<UpgradeCard variant="summary-cap" />);
    expect(
      captureMock.mock.calls.filter((c) => c[0] === "paywall_cap_hit_viewed").length,
    ).toBe(1);

    // Simulate a window-focus refetch that bumps usage by one.
    useEntitlementsMock.mockReturnValue(entitlements(11));
    rerender(<UpgradeCard variant="summary-cap" />);

    expect(
      captureMock.mock.calls.filter((c) => c[0] === "paywall_cap_hit_viewed").length,
    ).toBe(1);
  });

  it("fires paywall_cap_cta_clicked with cta=primary | secondary on each click", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    render(<UpgradeCard variant="summary-cap" />);
    captureMock.mockClear();

    fireEvent.click(screen.getByRole("link", { name: /unlock pro/i }));
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_cta_clicked",
      expect.objectContaining({ variant: "summary-cap", cta: "primary", tier: "free" }),
    );

    fireEvent.click(screen.getByRole("link", { name: /see plans/i }));
    expect(captureMock).toHaveBeenCalledWith(
      "paywall_cap_cta_clicked",
      expect.objectContaining({ variant: "summary-cap", cta: "secondary", tier: "free" }),
    );
  });

  it("swallows PostHog capture throws so they cannot block rendering or CTA clicks", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    captureMock.mockImplementationOnce(() => {
      throw new Error("posthog blew up");
    });

    // Render should not throw even though capture throws on mount.
    expect(() => render(<UpgradeCard variant="summary-cap" />)).not.toThrow();

    // Subsequent CTA clicks also stay quiet on throw.
    captureMock.mockImplementationOnce(() => {
      throw new Error("posthog blew up");
    });
    expect(() =>
      fireEvent.click(screen.getByRole("link", { name: /unlock pro/i })),
    ).not.toThrow();
  });
});

describe("UpgradeCard chat-cap variant", () => {
  it("renders chat-cap headline + Pro benefits ordered with chat first", () => {
    useEntitlementsMock.mockReturnValue(entitlements(0));
    render(<UpgradeCard variant="chat-cap" />);
    expect(screen.getByText(/used your free chats on this video/i)).not.toBeNull();
    expect(screen.getByText(/Unlimited AI Chat across every video/i)).not.toBeNull();
  });
});

describe("UpgradeCard history-cap variant", () => {
  it("renders history-cap headline + Pro benefits ordered with history first", () => {
    useEntitlementsMock.mockReturnValue(entitlements(0));
    render(<UpgradeCard variant="history-cap" />);
    expect(screen.getByText(/free history is full/i)).not.toBeNull();
    expect(screen.getByText(/Permanent history — never auto-replaced/i)).not.toBeNull();
  });
});

describe("UpgradeCard analytics attribute", () => {
  it("exposes the variant via data attribute", () => {
    useEntitlementsMock.mockReturnValue(entitlements(10));
    const { container } = render(<UpgradeCard variant="summary-cap" />);
    expect(container.querySelector('[data-paywall-variant="summary-cap"]')).not.toBeNull();
  });
});
