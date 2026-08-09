// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_ACTIVATION_OUTCOME_STORAGE_KEY,
  BILLING_ACTIVATION_PENDING_STORAGE_KEY,
} from "@/lib/billing/activation-pending";

const queryClientMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClientMocks,
}));

import { BillingSuccessView } from "../BillingSuccessView";

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BillingSuccessView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClientMocks.invalidateQueries.mockReset();
    queryClientMocks.invalidateQueries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows Activating Pro, then the active Pro Plan with a Plan & Billing path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "active",
            subscriptionPresentation: {
              state: "active_pro",
              plan: "yearly",
              renewsAt: "2027-08-09T00:00:00.000Z",
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingSuccessView sessionId="cs_test_return" />);

    expect(
      screen.getByRole("heading", { name: "Verifying checkout return" }),
    ).not.toBeNull();
    await flushMicrotasks();
    expect(
      screen.getByRole("heading", { name: "Activating Pro" }),
    ).not.toBeNull();
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBe("cs_test_return");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/billing/checkout/status?session_id=cs_test_return",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.queryByRole("button", { name: /upgrade|checkout|choose/i }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /upgrade|checkout|choose/i })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(
      screen.getByRole("heading", { name: "Pro Plan is active" }),
    ).not.toBeNull();
    const billingLink = screen.getByRole("link", {
      name: "View Plan & Billing",
    });
    expect(billingLink.getAttribute("href")).toBe("/account/billing");
    expect(queryClientMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["entitlements"],
    });
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBeNull();
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_OUTCOME_STORAGE_KEY),
    ).toContain('"outcome":"active"');
  });

  it("handles immediate webhook confirmation without scheduling another poll", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "active",
          subscriptionPresentation: {
            state: "active_pro",
            plan: "monthly",
            renewsAt: "2026-09-09T00:00:00.000Z",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingSuccessView sessionId="cs_test_immediate" />);
    await flushMicrotasks();

    expect(
      screen.getByRole("heading", { name: "Pro Plan is active" }),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBeNull();
  });

  it("bounds a hung confirmation request, then offers refresh and support", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingSuccessView sessionId="cs_test_slow" />);
    await flushMicrotasks();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(
      screen.getByRole("heading", {
        name: "Activation is taking longer than expected",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Refresh activation status" }),
    ).not.toBeNull();
    const supportLink = screen.getByRole("link", {
      name: "Contact support",
    });
    expect(supportLink.getAttribute("href")).toMatch(
      /^mailto:support@youtubeai\.chat/,
    );
    expect(screen.getByText(/do not start another checkout/i)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers when refresh confirms activation after a timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
      )
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "active",
            subscriptionPresentation: {
              state: "active_pro",
              plan: "monthly",
              renewsAt: null,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingSuccessView sessionId="cs_test_refresh" />);
    await flushMicrotasks();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(28_000);
    });

    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBe("cs_test_refresh");
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_OUTCOME_STORAGE_KEY),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh activation status" }),
    );
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBe("cs_test_refresh");
    await flushMicrotasks();

    expect(
      screen.getByRole("heading", { name: "Pro Plan is active" }),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBeNull();
  });

  it("stops on a 429 instead of retrying through Retry-After", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Too many activation checks" }), {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingSuccessView sessionId="cs_test_throttled" />);
    await flushMicrotasks();

    expect(
      screen.getByRole("heading", {
        name: "Activation is taking longer than expected",
      }),
    ).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_OUTCOME_STORAGE_KEY),
    ).toBeNull();
  });

  it("stops polling and aborts an in-flight request when unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
      )
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(
      <BillingSuccessView sessionId="cs_test_cleanup" />,
    );
    await flushMicrotasks();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    unmount();

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not show activation or poll outside a session-scoped checkout return", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.sessionStorage.setItem(
      BILLING_ACTIVATION_PENDING_STORAGE_KEY,
      "cs_test_stale",
    );

    render(<BillingSuccessView sessionId={null} />);

    expect(
      screen.getByRole("heading", { name: "Checkout return unavailable" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Activating Pro" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBeNull();
  });

  it("stops polling when the Checkout Session cannot be verified", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Checkout session not found" }), {
        status: 404,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingSuccessView sessionId="cs_test_unknown" />);
    await flushMicrotasks();

    expect(
      screen.getByRole("heading", { name: "Checkout return unavailable" }),
    ).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_OUTCOME_STORAGE_KEY),
    ).toContain('"outcome":"invalid"');
  });
});
