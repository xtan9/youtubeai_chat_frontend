// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const replaceMock = vi.fn();
const searchParamsState = { value: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/summary",
  useSearchParams: () => searchParamsState.value,
}));

import { SummaryTabs } from "../summary-tabs";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  replaceMock.mockReset();
  searchParamsState.value = new URLSearchParams();
});

function renderTabs(opts: {
  chatLocked?: boolean;
  tabParam?: string;
} = {}) {
  if (opts.tabParam) {
    searchParamsState.value = new URLSearchParams({ tab: opts.tabParam });
  }
  return render(
    <SummaryTabs
      chatLocked={opts.chatLocked ?? false}
      summaryContent={<div>SUMMARY-CONTENT</div>}
      chatContent={<div>CHAT-CONTENT</div>}
    />
  );
}

describe("SummaryTabs", () => {
  it("defaults to the Summary tab when no ?tab= param", () => {
    renderTabs();
    expect(screen.getByText("SUMMARY-CONTENT")).toBeTruthy();
    // Summary trigger should be active (data-state=active).
    const summaryTrigger = screen.getByRole("tab", { name: "Summary" });
    expect(summaryTrigger.getAttribute("data-state")).toBe("active");
  });

  it("activates Chat when ?tab=chat is set and chat isn't locked", () => {
    renderTabs({ tabParam: "chat", chatLocked: false });
    const chatTrigger = screen.getByRole("tab", { name: "Chat" });
    expect(chatTrigger.getAttribute("data-state")).toBe("active");
  });

  it("disables the Chat trigger when chatLocked is true", () => {
    renderTabs({ chatLocked: true });
    const chatTrigger = screen.getByRole("tab", { name: "Chat" });
    expect(chatTrigger.getAttribute("aria-disabled")).toBe("true");
  });

  it("auto-bounces away from ?tab=chat after the bounce delay when chatLocked is still true", async () => {
    vi.useFakeTimers();
    renderTabs({ tabParam: "chat", chatLocked: true });
    // Bounce is delayed — the user gets up to BOUNCE_DELAY_MS for the
    // cache to resolve before we rewrite their URL.
    expect(replaceMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(replaceMock).toHaveBeenCalled();
    const calledWith = replaceMock.mock.calls[0]?.[0] as string;
    expect(calledWith).not.toMatch(/tab=chat/);
    vi.useRealTimers();
  });

  it("does NOT bounce when chatLocked flips to false within the delay (cached-reload path)", () => {
    vi.useFakeTimers();
    searchParamsState.value = new URLSearchParams({ tab: "chat" });
    const { rerender } = render(
      <SummaryTabs
        chatLocked={true}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />,
    );
    // Cache resolves before the timer fires.
    vi.advanceTimersByTime(500);
    rerender(
      <SummaryTabs
        chatLocked={false}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />,
    );
    // The cleanup on the prior effect should clear the timer when the
    // dep changes; advancing past the original delay must NOT fire
    // the bounce, because the effect re-ran with chatLocked=false and
    // its body short-circuited.
    vi.advanceTimersByTime(2000);
    expect(replaceMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // Radix Tabs's pointer/keyboard activation doesn't reach
  // onValueChange under happy-dom — neither click+pointerdown nor
  // ArrowRight+focus drive the roving-tabindex state. The
  // setTab callback is exercised indirectly by the URL-bounce effect
  // (auto-bounce-when-locked test above) and by the deep-link test;
  // a click-propagation test here would either be a no-op fallback
  // (misleading) or require @testing-library/user-event which isn't
  // a project dependency. Intentionally omitted.
});
