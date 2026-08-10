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
    expect(POSTHOG_CAPTURE_OPTIONS.capture_performance).toBe(false);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("drops all private Project API traffic from session replay", () => {
    const privateRequests = [
      {
        name: "https://youtubeai.chat/api/projects/project-1/search",
        requestBody: JSON.stringify({ query: "private research" }),
        responseBody: JSON.stringify({ passages: [{ text: "exact passage" }] }),
      },
      {
        name: "https://youtubeai.chat/api/projects/project-1/conversation/stream",
        requestBody: JSON.stringify({ question: "private prompt" }),
        responseBody: "private answer",
      },
      {
        name: "https://youtubeai.chat/api/projects/project-1/artifacts/study-guide",
        responseBody: JSON.stringify({ markdown: "private Artifact" }),
      },
      {
        name: "https://youtubeai.chat/api/projects/project-1/source-set/process",
        requestBody: JSON.stringify({ youtubeUrl: "https://youtu.be/private" }),
      },
      {
        name: "https://youtubeai.chat/api/workspace/projects",
        requestBody: JSON.stringify({
          name: "Private Project",
          goal: "Private Goal",
        }),
      },
      {
        name: "https://youtubeai.chat/workspace?_rsc=private-navigation",
        responseBody: JSON.stringify({ name: "Private Project" }),
        entryType: "resource",
        initiatorType: "fetch",
        duration: 42,
      },
      {
        name: "https://youtubeai.chat/workspace/projects/project-1?_rsc=private-project",
        responseBody: JSON.stringify({
          goal: "Private Goal",
          title: "Private Video",
          youtubeUrl: "https://youtu.be/private",
        }),
        entryType: "resource",
        initiatorType: "fetch",
        duration: 84,
      },
    ];
    const ordinaryRequest = {
      name: "https://youtubeai.chat/api/health",
    };

    for (const privateRequest of privateRequests) {
      expect(maskCapturedNetworkRequest(privateRequest as never)).toBeNull();
    }
    expect(maskCapturedNetworkRequest(ordinaryRequest as never)).toBe(
      ordinaryRequest,
    );
    expect(
      POSTHOG_SESSION_RECORDING_OPTIONS.maskCapturedNetworkRequestFn,
    ).toBe(maskCapturedNetworkRequest);
    expect(POSTHOG_SESSION_RECORDING_OPTIONS.blockClass).toBe("ph-no-capture");
    expect(POSTHOG_SESSION_RECORDING_OPTIONS.blockSelector).toBe(
      "[data-ph-no-autocapture]",
    );
    expect(POSTHOG_SESSION_RECORDING_OPTIONS.recordBody).toBe(false);
    expect(POSTHOG_SESSION_RECORDING_OPTIONS.recordHeaders).toBe(false);
  });
});
