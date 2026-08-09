// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "@/tests-utils/axe";
import { PlanBillingView } from "../PlanBillingView";

const { captureAnalyticsEventMock, useEntitlementsMock } = vi.hoisted(() => ({
  captureAnalyticsEventMock: vi.fn(),
  useEntitlementsMock: vi.fn(),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: useEntitlementsMock,
}));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: captureAnalyticsEventMock,
}));

afterEach(cleanup);

const refetchMock = vi.fn();

function setEntitlements({
  caps = {
    summariesUsed: 3,
    summariesLimit: 10,
    historyUsed: 2,
    historyLimit: 10,
    projectsUsed: 1,
    projectsLimit: 1,
  },
  isError = false,
  isPending = false,
  presentation,
}: {
  caps?: {
    summariesUsed: number;
    summariesLimit: number;
    historyUsed?: number;
    historyLimit?: number;
    projectsUsed: number;
    projectsLimit: number;
  };
  isError?: boolean;
  isPending?: boolean;
  presentation:
    | { state: "loading" }
    | { state: "lookup_failure" }
    | { state: "free" }
    | {
        state: "active_pro";
        plan: "monthly" | "yearly" | null;
        renewsAt: string | null;
      }
    | {
        state: "pro_pending_cancellation";
        plan: "monthly" | "yearly" | null;
        accessEndsAt: string | null;
      }
    | {
        state: "billing_issue";
        plan: "monthly" | "yearly" | null;
      };
}) {
  useEntitlementsMock.mockReturnValue({
    data:
      presentation.state === "loading" || presentation.state === "lookup_failure"
        ? undefined
        : {
            tier: presentation.state === "free" ? "free" : "pro",
            caps,
            subscriptionPresentation: presentation,
          },
    isError,
    isPending,
    refetch: refetchMock,
    subscriptionPresentation: presentation,
  });
}

beforeEach(() => {
  captureAnalyticsEventMock.mockReset();
  refetchMock.mockReset();
  refetchMock.mockResolvedValue({});
  useEntitlementsMock.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

describe("PlanBillingView page boundary", () => {
  it("has no detectable accessibility violations in its Free Plan state", async () => {
    setEntitlements({ presentation: { state: "free" } });

    const { container } = render(
      <main>
        <PlanBillingView />
      </main>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows every available Free usage limit and one Upgrade action", async () => {
    setEntitlements({ presentation: { state: "free" } });

    render(<PlanBillingView />);

    expect(
      screen.getByRole("heading", { name: "Plan & Billing", level: 1 }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Free Plan", level: 2 }),
    ).not.toBeNull();
    expect(screen.getByText("3 of 10 used")).not.toBeNull();
    expect(screen.getByText("2 of 10 used")).not.toBeNull();
    expect(screen.getByText("1 of 1 used")).not.toBeNull();
    expect(
      screen.getByRole("progressbar", {
        name: "Monthly summaries: 3 of 10 used",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("progressbar", {
        name: "Saved Videos in History: 2 of 10 used",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("progressbar", {
        name: "Projects: 1 of 1 used",
      }),
    ).not.toBeNull();
    expect(
      screen.getByText(/deleting a Project frees this Project slot/i),
    ).not.toBeNull();

    const upgrade = screen.getByRole("link", { name: "Upgrade to Pro" });
    expect(upgrade.getAttribute("href")).toBe("/pricing");
    expect(screen.getAllByRole("link", { name: "Upgrade to Pro" })).toHaveLength(
      1,
    );

    await waitFor(() =>
      expect(captureAnalyticsEventMock).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        {
          source_surface: "plan_and_billing",
          presentation_state: "upgrade_to_pro",
          authentication_state: "registered",
          device_class: "desktop",
        },
      ),
    );

    fireEvent.click(upgrade);
    expect(captureAnalyticsEventMock).toHaveBeenCalledWith(
      "subscription_discovery_clicked",
      {
        source_surface: "plan_and_billing",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "desktop",
      },
    );
  });

  it("shows active Pro cadence, renewal date, and Stripe management", () => {
    setEntitlements({
      presentation: {
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2026-12-31T00:00:00.000Z",
      },
    });

    render(<PlanBillingView />);

    expect(
      screen.getByRole("heading", { name: "Pro Plan", level: 2 }),
    ).not.toBeNull();
    expect(screen.getByText("Billed yearly")).not.toBeNull();
    expect(screen.getByText("Renews on Dec 31, 2026")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Manage subscription" }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        /payment methods, invoices, cancellation, resumption, and plan changes open in stripe/i,
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
    expect(
      screen.getByText(/unlimited Projects within technical and abuse limits/i),
    ).not.toBeNull();
  });

  it("does not render malformed non-finite limits as usage meters", () => {
    setEntitlements({
      caps: {
        summariesUsed: 3,
        summariesLimit: Number.POSITIVE_INFINITY,
        historyUsed: 2,
        historyLimit: Number.NaN,
        projectsUsed: Number.NaN,
        projectsLimit: 1,
      },
      presentation: { state: "free" },
    });

    render(<PlanBillingView />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(
      screen.getByText(/monthly summary usage is temporarily unavailable/i),
    ).not.toBeNull();
    expect(
      screen.getByText(/history usage is temporarily unavailable/i),
    ).not.toBeNull();
    expect(
      screen.getByText(/Project usage is temporarily unavailable/i),
    ).not.toBeNull();
  });

  it("keeps a pending cancellation on Pro and says when access ends", () => {
    setEntitlements({
      presentation: {
        state: "pro_pending_cancellation",
        plan: "monthly",
        accessEndsAt: "2026-05-31T00:00:00.000Z",
      },
    });

    render(<PlanBillingView />);

    expect(
      screen.getByRole("heading", { name: "Pro Plan", level: 2 }),
    ).not.toBeNull();
    expect(screen.getByText("Billed monthly")).not.toBeNull();
    expect(screen.getByText("Cancels on May 31, 2026")).not.toBeNull();
    expect(screen.queryByText(/renews on/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Manage subscription" }),
    ).not.toBeNull();
  });

  it("explains a recoverable billing issue and routes recovery through Stripe", async () => {
    setEntitlements({
      presentation: { state: "billing_issue", plan: "monthly" },
    });

    render(<PlanBillingView />);

    expect(
      screen.getByRole("heading", { name: "Billing issue", level: 2 }),
    ).not.toBeNull();
    expect(
      screen.getByText(/your subscription needs attention/i),
    ).not.toBeNull();
    expect(
      screen.getByText(/update your payment details securely in stripe/i),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Resolve billing issue in Stripe" }),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();

    await waitFor(() =>
      expect(captureAnalyticsEventMock).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        expect.objectContaining({
          source_surface: "plan_and_billing",
          presentation_state: "billing_issue",
        }),
      ),
    );
  });

  it("states which active Pro metadata is unavailable without guessing", () => {
    setEntitlements({
      presentation: {
        state: "active_pro",
        plan: null,
        renewsAt: null,
      },
    });

    render(<PlanBillingView />);

    expect(
      screen.getByRole("heading", { name: "Pro Plan", level: 2 }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        /billing cadence and renewal date are temporarily unavailable/i,
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/billed monthly|billed yearly/i)).toBeNull();
    expect(screen.queryByText(/renews on/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Manage subscription" }),
    ).not.toBeNull();
  });

  it("offers retry-only neutral UI when Subscription lookup fails", () => {
    setEntitlements({
      isError: true,
      presentation: { state: "lookup_failure" },
    });

    render(<PlanBillingView />);

    expect(
      screen.getByRole("alert").textContent,
    ).toMatch(/couldn't load your plan and billing details/i);
    expect(screen.queryByRole("heading", { name: "Free Plan" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Pro Plan" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Manage subscription" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(captureAnalyticsEventMock).not.toHaveBeenCalled();
  });

  it("reserves the plan surface while loading without exposing an action", () => {
    setEntitlements({
      isPending: true,
      presentation: { state: "loading" },
    });

    render(<PlanBillingView />);

    const status = screen.getByRole("status", {
      name: "Loading Plan & Billing",
    });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /manage subscription/i }),
    ).toBeNull();
    expect(captureAnalyticsEventMock).not.toHaveBeenCalled();
  });
});
