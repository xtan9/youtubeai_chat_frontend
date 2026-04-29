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
  chatLockPending?: boolean;
  tabParam?: string;
} = {}) {
  if (opts.tabParam) {
    searchParamsState.value = new URLSearchParams({ tab: opts.tabParam });
  }
  return render(
    <SummaryTabs
      chatLocked={opts.chatLocked ?? false}
      chatLockPending={opts.chatLockPending}
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

  it("auto-bounces away from ?tab=chat when chatLocked becomes true", () => {
    renderTabs({ tabParam: "chat", chatLocked: true });
    expect(replaceMock).toHaveBeenCalled();
    const calledWith = replaceMock.mock.calls[0]?.[0] as string;
    expect(calledWith).not.toMatch(/tab=chat/);
  });

  it("does NOT auto-bounce while chatLockPending is true (so a reload of ?tab=chat against a cached summary stays on chat once it unlocks)", () => {
    // Initial render: pending and locked (cache lookup in flight).
    const { rerender } = render(
      <SummaryTabs
        chatLocked={true}
        chatLockPending={true}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />
    );
    searchParamsState.value = new URLSearchParams({ tab: "chat" });
    rerender(
      <SummaryTabs
        chatLocked={true}
        chatLockPending={true}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("auto-bounces once chatLockPending flips to false and chat is still locked", () => {
    searchParamsState.value = new URLSearchParams({ tab: "chat" });
    const { rerender } = render(
      <SummaryTabs
        chatLocked={true}
        chatLockPending={true}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />
    );
    expect(replaceMock).not.toHaveBeenCalled();
    // Lock decision becomes final (e.g. cache lookup resolved with no
    // summary, or a hard error landed). Now the bounce should fire.
    rerender(
      <SummaryTabs
        chatLocked={true}
        chatLockPending={false}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />
    );
    expect(replaceMock).toHaveBeenCalled();
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
