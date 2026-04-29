// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import type { SummaryResult } from "@/lib/types";

const themeMock = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => themeMock(),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => null,
}));

import { SummaryContent } from "../summary-content";

const summary: SummaryResult = {
  title: "Test Video",
  duration: "10:00",
  summary: "Hello world summary.",
  transcriptionTime: 1.2,
  summaryTime: 0.8,
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  themeMock.mockReset();
});

// Regression for the next-themes "system" bug: previously the component used
// `theme === "dark"`, which is `false` when the user picked "system" with a
// dark OS (theme is "system" in that case, not "dark"). The fix is to read
// `resolvedTheme`, which always settles to "light" or "dark".
describe("SummaryContent dark-mode detection", () => {
  it("renders the dark branch when theme='system' resolves to dark", () => {
    themeMock.mockReturnValue({ theme: "system", resolvedTheme: "dark" });
    const { container } = render(<SummaryContent summary={summary} />);
    const card = container.querySelector(".rounded-2xl.p-8");
    expect(card?.className).toContain("bg-white/10");
    expect(card?.className).not.toContain("bg-slate-100");
  });

  it("renders the light branch when theme='system' resolves to light", () => {
    themeMock.mockReturnValue({ theme: "system", resolvedTheme: "light" });
    const { container } = render(<SummaryContent summary={summary} />);
    const card = container.querySelector(".rounded-2xl.p-8");
    expect(card?.className).toContain("bg-slate-100");
    expect(card?.className).not.toContain("bg-white/10");
  });

  it("renders the dark branch when user explicitly picks dark", () => {
    themeMock.mockReturnValue({ theme: "dark", resolvedTheme: "dark" });
    const { container } = render(<SummaryContent summary={summary} />);
    const card = container.querySelector(".rounded-2xl.p-8");
    expect(card?.className).toContain("bg-white/10");
  });
});
