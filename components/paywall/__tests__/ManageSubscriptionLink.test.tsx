// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ManageSubscriptionLink } from "../ManageSubscriptionLink";

afterEach(cleanup);

beforeEach(() => {
  vi.restoreAllMocks();
  // window.location.assign isn't a method we want to call for real in tests.
  // Replace it with a spy.
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, assign: vi.fn() },
  });
});

describe("ManageSubscriptionLink", () => {
  it("renders button with stable copy", () => {
    render(<ManageSubscriptionLink />);
    expect(screen.getByRole("button", { name: /manage subscription/i })).not.toBeNull();
  });

  it("calls /api/billing/portal and navigates to the returned url", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://billing.stripe.com/x" }), { status: 200 })
    );
    render(<ManageSubscriptionLink />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith("https://billing.stripe.com/x")
    );
  });

  it("re-enables button on fetch error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    render(<ManageSubscriptionLink />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      const btn = screen.getByRole("button") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
