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
//
// Assertions intentionally pin the raw class strings (`bg-white/10` /
// `bg-slate-100`) — they ARE the dark/light contract this regression guard
// protects. When the design-system token sweep migrates these to semantic
// tokens, update the asserted strings to match.
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

  // next-themes returns `undefined` for both fields server-side and on the
  // initial pre-mount render. Default to light so a future "render dark by
  // default during hydration" tweak can't silently flash dark for light-OS
  // users.
  it("renders the light branch before next-themes mounts (resolvedTheme undefined)", () => {
    themeMock.mockReturnValue({ theme: undefined, resolvedTheme: undefined });
    const { container } = render(<SummaryContent summary={summary} />);
    const card = container.querySelector(".rounded-2xl.p-8");
    expect(card?.className).toContain("bg-slate-100");
    expect(card?.className).not.toContain("bg-white/10");
  });
});
