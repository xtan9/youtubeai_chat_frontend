// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../BillingSuccessView", () => ({
  BillingSuccessView: ({ sessionId }: { sessionId: string | null }) => (
    <div data-testid="billing-success-view">{sessionId ?? "no-session"}</div>
  ),
}));

import BillingSuccessPage, { metadata } from "../page";

afterEach(cleanup);

describe("BillingSuccessPage", () => {
  it("keeps the public return shell out of search results", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("passes Stripe's checkout-session return token to the activation view", async () => {
    render(
      await BillingSuccessPage({
        searchParams: Promise.resolve({ session_id: "cs_test_return" }),
      }),
    );

    expect(screen.getByTestId("billing-success-view").textContent).toBe(
      "cs_test_return",
    );
  });

  it.each([
    ["missing", {}],
    ["blank", { session_id: "   " }],
    ["malformed", { session_id: "not-a-stripe-session" }],
    ["ambiguous", { session_id: ["cs_test_one", "cs_test_two"] }],
  ])("does not activate for a %s checkout-return token", async (_label, params) => {
    render(
      await BillingSuccessPage({
        searchParams: Promise.resolve(params),
      }),
    );

    expect(screen.getByTestId("billing-success-view").textContent).toBe(
      "no-session",
    );
  });
});
