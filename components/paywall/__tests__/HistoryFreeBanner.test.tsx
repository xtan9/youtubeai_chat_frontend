// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureAnalyticsEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent,
}));

import { HistoryFreeBanner } from "../HistoryFreeBanner";

beforeEach(() => {
  captureAnalyticsEvent.mockReset();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HistoryFreeBanner", () => {
  it("renders under-cap copy without auto-replaced text", () => {
    render(<HistoryFreeBanner used={5} limit={10} />);
    expect(screen.getByText(/showing 5 of 10/i)).not.toBeNull();
    expect(screen.queryByText(/auto-replaced/i)).toBeNull();
  });

  it("renders at-cap copy with auto-replaced text", () => {
    render(<HistoryFreeBanner used={10} limit={10} />);
    expect(screen.getByText(/showing 10 of 10/i)).not.toBeNull();
    expect(screen.getByText(/auto-replaced/i)).not.toBeNull();
  });

  it("clamps used > limit via Math.min", () => {
    render(<HistoryFreeBanner used={12} limit={10} />);
    // Should show 10 (clamped), not 12
    const banner = screen.getByText(/showing 10 of 10/i);
    expect(banner).not.toBeNull();
    // Also shows the auto-replaced text since 12 >= 10
    expect(screen.getByText(/auto-replaced/i)).not.toBeNull();
  });

  it("provides a truthful attributed Upgrade to Pro link", () => {
    render(<HistoryFreeBanner used={3} limit={10} />);
    const link = screen.getByRole("link", { name: /upgrade to pro/i });
    expect(link.getAttribute("href")).toBe(
      "/pricing?source_surface=history_limit",
    );
  });

  it("attributes the registered History limit view and activation", () => {
    render(<HistoryFreeBanner used={10} limit={10} />);

    expect(captureAnalyticsEvent).toHaveBeenCalledWith(
      "subscription_discovery_viewed",
      {
        source_surface: "history_limit",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "desktop",
      },
    );

    fireEvent.click(screen.getByRole("link", { name: /upgrade to pro/i }));
    expect(captureAnalyticsEvent).toHaveBeenLastCalledWith(
      "subscription_discovery_clicked",
      expect.objectContaining({ source_surface: "history_limit" }),
    );
  });

  it("exposes the paywall variant data attribute", () => {
    const { container } = render(<HistoryFreeBanner used={5} limit={10} />);
    expect(
      container.querySelector('[data-paywall-variant="history-free-banner"]'),
    ).not.toBeNull();
  });
});
