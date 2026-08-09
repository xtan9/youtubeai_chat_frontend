// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureAnalyticsEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent,
}));

import { useSubscriptionDiscovery } from "../use-subscription-discovery";

let mobile = false;

beforeEach(() => {
  mobile = false;
  captureAnalyticsEvent.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: mobile,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSubscriptionDiscovery", () => {
  it("reports one governed view and the current device class on activation", async () => {
    const { result, rerender } = renderHook(() =>
      useSubscriptionDiscovery({
        sourceSurface: "summary_limit",
        presentationState: "upgrade_to_pro",
        authenticationState: "registered",
      }),
    );

    await waitFor(() =>
      expect(captureAnalyticsEvent).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        {
          source_surface: "summary_limit",
          presentation_state: "upgrade_to_pro",
          authentication_state: "registered",
          device_class: "desktop",
        },
      ),
    );

    rerender();
    expect(
      captureAnalyticsEvent.mock.calls.filter(
        ([event]) => event === "subscription_discovery_viewed",
      ),
    ).toHaveLength(1);

    mobile = true;
    act(() => result.current.captureClick());

    expect(captureAnalyticsEvent).toHaveBeenLastCalledWith(
      "subscription_discovery_clicked",
      {
        source_surface: "summary_limit",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "mobile",
      },
    );
  });

  it("waits for an enabled, truthfully resolved surface before reporting", async () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useSubscriptionDiscovery({
          sourceSurface: "video_chat_limit",
          presentationState: "pricing",
          authenticationState: "anonymous_session",
          enabled,
        }),
      { initialProps: { enabled: false } },
    );

    expect(captureAnalyticsEvent).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() =>
      expect(captureAnalyticsEvent).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        expect.objectContaining({
          source_surface: "video_chat_limit",
          authentication_state: "anonymous_session",
        }),
      ),
    );
  });
});
