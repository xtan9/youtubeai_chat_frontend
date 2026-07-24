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
  PostHogProvider,
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
});
