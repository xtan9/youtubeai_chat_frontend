// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  init: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: mocks.capture,
    init: mocks.init,
  },
}));

vi.mock("posthog-js/react", () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import {
  POSTHOG_CAPTURE_OPTIONS,
  POSTHOG_SESSION_RECORDING_OPTIONS,
  PostHogProvider,
  maskCapturedNetworkRequest,
} from "../posthog-provider";

describe("PostHogProvider", () => {
  it("uses one automatic history-change page-view source", () => {
    render(
      <PostHogProvider>
        <div>child</div>
      </PostHogProvider>,
    );

    expect(POSTHOG_CAPTURE_OPTIONS.capture_pageview).toBe("history_change");
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("drops private Project Search traffic from session replay", () => {
    const privateRequest = {
      name: "https://youtubeai.chat/api/projects/project-1/search",
      requestBody: JSON.stringify({ query: "private research" }),
      responseBody: JSON.stringify({ passages: [{ text: "exact passage" }] }),
    };
    const ordinaryRequest = {
      name: "https://youtubeai.chat/api/health",
    };

    expect(maskCapturedNetworkRequest(privateRequest as never)).toBeNull();
    expect(maskCapturedNetworkRequest(ordinaryRequest as never)).toBe(
      ordinaryRequest,
    );
    expect(
      POSTHOG_SESSION_RECORDING_OPTIONS.maskCapturedNetworkRequestFn,
    ).toBe(maskCapturedNetworkRequest);
  });
});
