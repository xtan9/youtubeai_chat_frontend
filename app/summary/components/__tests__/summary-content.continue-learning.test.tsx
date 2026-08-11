// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryResult } from "@/lib/types";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => null,
}));
vi.mock("../continue-learning", () => ({
  ContinueLearningSection: ({
    sourceUrl,
    enabled,
  }: {
    sourceUrl: string;
    enabled: boolean;
  }) => (
    <section data-testid="continue-learning-integration">
      {sourceUrl}:{String(enabled)}
    </section>
  ),
}));

import { SummaryContent } from "../summary-content";

const summary: SummaryResult = {
  title: "Test Video",
  duration: "10:00",
  summary: "Hello world summary.",
  transcriptionTime: 1.2,
  summaryTime: 0.8,
};

afterEach(() => cleanup());

describe("SummaryContent Continue Learning boundary", () => {
  it("places the dormant section after Summary Stats only when explicitly enabled", () => {
    const { rerender } = render(
      <SummaryContent
        summary={summary}
        sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        continueLearningEnabled
      />,
    );

    const stats = screen.getByTestId("summary-stats");
    const section = screen.getByTestId("continue-learning-integration");
    expect(Boolean(stats.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    expect(section.textContent).toContain("true");

    rerender(
      <SummaryContent
        summary={summary}
        sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        continueLearningEnabled={false}
      />,
    );
    expect(screen.queryByTestId("continue-learning-integration")).toBeNull();
  });
});
