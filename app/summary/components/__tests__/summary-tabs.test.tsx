// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// vi.hoisted runs before vi.mock factories AND before the module imports
// vitest hoists; lets us share refs between this file and the mock factory
// without "Cannot access 'replaceMock' before initialization".
const { replaceMock, searchParamsState, routerInstance } = vi.hoisted(() => {
  const replaceMock = vi.fn();
  return {
    replaceMock,
    searchParamsState: { value: new URLSearchParams() },
    // Stable router instance — Next.js's real `useRouter()` returns a
    // memoized object; recreating it per call would make any effect
    // with `router` in its dep array re-run on every parent re-render,
    // canceling our setTimeout-based bounce timer.
    routerInstance: { replace: replaceMock },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerInstance,
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
  chatPermanentlyLocked?: boolean;
  tabParam?: string;
} = {}) {
  if (opts.tabParam) {
    searchParamsState.value = new URLSearchParams({ tab: opts.tabParam });
  }
  return render(
    <SummaryTabs
      chatLocked={opts.chatLocked ?? false}
      chatPermanentlyLocked={opts.chatPermanentlyLocked}
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

  it("does NOT bounce when chat is momentarily locked (loading) — no streamError yet", () => {
    // The cached-reload bug: the prior time-based suppression flipped
    // false before the cache resolved on prod. With the permanently-
    // locked predicate, no bounce fires regardless of cache timing
    // because the parent only flips chatPermanentlyLocked when a
    // `streamError` actually lands.
    renderTabs({
      tabParam: "chat",
      chatLocked: true,
      chatPermanentlyLocked: false,
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("auto-bounces away from ?tab=chat when the lock becomes permanent (streamError set)", () => {
    renderTabs({
      tabParam: "chat",
      chatLocked: true,
      chatPermanentlyLocked: true,
    });
    expect(replaceMock).toHaveBeenCalled();
    const calledWith = replaceMock.mock.calls[0]?.[0] as string;
    expect(calledWith).not.toMatch(/tab=chat/);
  });

  it("does NOT bounce when chat unlocks normally (cached-reload happy path)", () => {
    // chatLocked=false, chatPermanentlyLocked=false → chat is open;
    // there is nothing to bounce. Pin this so a future refactor
    // can't accidentally flip the predicate around.
    renderTabs({
      tabParam: "chat",
      chatLocked: false,
      chatPermanentlyLocked: false,
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("bounces when chatPermanentlyLocked flips true mid-session (e.g. stream errors after retry)", () => {
    searchParamsState.value = new URLSearchParams({ tab: "chat" });
    const { rerender } = render(
      <SummaryTabs
        chatLocked={true}
        chatPermanentlyLocked={false}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />,
    );
    expect(replaceMock).not.toHaveBeenCalled();
    rerender(
      <SummaryTabs
        chatLocked={true}
        chatPermanentlyLocked={true}
        summaryContent={<div>SUMMARY-CONTENT</div>}
        chatContent={<div>CHAT-CONTENT</div>}
      />,
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
