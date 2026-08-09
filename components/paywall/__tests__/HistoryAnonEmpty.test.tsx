// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureAnalyticsEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent,
}));

import { HistoryAnonEmpty } from "../HistoryAnonEmpty";

beforeEach(() => {
  captureAnalyticsEvent.mockReset();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HistoryAnonEmpty", () => {
  it("renders the heading", () => {
    render(<HistoryAnonEmpty />);
    expect(
      screen.getByRole("heading", { name: /save and revisit your summaries/i }),
    ).not.toBeNull();
  });

  it("provides a signup link with a safe History return", () => {
    render(<HistoryAnonEmpty />);
    const signupLink = screen.getByRole("link", { name: /sign up free/i });
    const href = new URL(
      signupLink.getAttribute("href")!,
      "https://example.test",
    );
    expect(href.pathname).toBe("/auth/sign-up");
    expect(href.searchParams.get("redirect_to")).toBe("/history");
  });

  it("attributes the anonymous History limit view and activation", () => {
    render(<HistoryAnonEmpty />);

    expect(captureAnalyticsEvent).toHaveBeenCalledWith(
      "subscription_discovery_viewed",
      {
        source_surface: "history_limit",
        presentation_state: "pricing",
        authentication_state: "anonymous_session",
        device_class: "desktop",
      },
    );

    fireEvent.click(screen.getByRole("link", { name: /sign up free/i }));
    expect(captureAnalyticsEvent).toHaveBeenLastCalledWith(
      "subscription_discovery_clicked",
      expect.objectContaining({
        source_surface: "history_limit",
        authentication_state: "anonymous_session",
      }),
    );
  });

  it("exposes the paywall variant data attribute", () => {
    const { container } = render(<HistoryAnonEmpty />);
    expect(
      container.querySelector('[data-paywall-variant="history-anon"]'),
    ).not.toBeNull();
  });
});
