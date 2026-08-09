// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureAnalyticsEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent,
}));

import { ChatCapBanner } from "../ChatCapBanner";

beforeEach(() => {
  captureAnalyticsEvent.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatCapBanner", () => {
  it("renders free-cap variant by default with /pricing link", () => {
    render(<ChatCapBanner />);
    expect(screen.getByText(/used 5\/5 free chat messages/i)).not.toBeNull();
    const link = screen.getByRole("link", { name: /upgrade to pro/i });
    expect(link.getAttribute("href")).toBe(
      "/pricing?source_surface=video_chat_limit",
    );
    expect(screen.queryByText(/\$4\.99/i)).toBeNull();
  });

  it("renders anon-blocked variant with a safe signup return", () => {
    render(
      <ChatCapBanner
        variant="anon-blocked"
        returnTo="/summary?url=https%3A%2F%2Fyoutu.be%2Fabc123"
      />,
    );
    expect(screen.getByText(/sign up to chat/i)).not.toBeNull();
    const link = screen.getByRole("link");
    const href = new URL(link.getAttribute("href")!, "https://example.test");
    expect(href.pathname).toBe("/auth/sign-up");
    expect(href.searchParams.get("redirect_to")).toBe(
      "/summary?url=https%3A%2F%2Fyoutu.be%2Fabc123",
    );
  });

  it.each([
    {
      variant: "free-cap" as const,
      authenticationState: "registered",
      presentationState: "upgrade_to_pro",
      linkName: /upgrade to pro/i,
    },
    {
      variant: "anon-blocked" as const,
      authenticationState: "anonymous_session",
      presentationState: "pricing",
      linkName: /sign up free/i,
    },
  ])(
    "attributes the $variant Video Chat limit view and activation",
    ({ variant, authenticationState, presentationState, linkName }) => {
      render(<ChatCapBanner variant={variant} returnTo="/summary?url=video" />);

      expect(captureAnalyticsEvent).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        {
          source_surface: "video_chat_limit",
          presentation_state: presentationState,
          authentication_state: authenticationState,
          device_class: "desktop",
        },
      );

      fireEvent.click(screen.getByRole("link", { name: linkName }));
      expect(captureAnalyticsEvent).toHaveBeenLastCalledWith(
        "subscription_discovery_clicked",
        expect.objectContaining({
          source_surface: "video_chat_limit",
          authentication_state: authenticationState,
        }),
      );
    },
  );

  it("exposes the variant via data attribute", () => {
    const { container } = render(<ChatCapBanner variant="free-cap" />);
    expect(
      container.querySelector('[data-paywall-variant="chat-free-cap"]'),
    ).not.toBeNull();
  });

  it("exposes anon-blocked via data attribute", () => {
    const { container } = render(<ChatCapBanner variant="anon-blocked" />);
    expect(
      container.querySelector('[data-paywall-variant="chat-anon-blocked"]'),
    ).not.toBeNull();
  });
});
