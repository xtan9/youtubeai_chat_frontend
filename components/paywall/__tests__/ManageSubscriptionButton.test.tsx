// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ManageSubscriptionButton } from "../ManageSubscriptionButton";

afterEach(cleanup);

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, assign: vi.fn() },
  });
});

describe("ManageSubscriptionButton", () => {
  it("renders button with stable copy", () => {
    render(<ManageSubscriptionButton />);
    expect(screen.getByRole("button", { name: /manage subscription/i })).not.toBeNull();
  });

  it("calls /api/billing/portal and navigates to the returned url", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://billing.stripe.com/x" }), { status: 200 })
    );
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith("https://billing.stripe.com/x")
    );
  });

  it("re-enables button on fetch error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      const btn = screen.getByRole("button") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("shows inline error text on non-ok response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeNull()
    );
    expect(screen.getByRole("alert").textContent).toMatch(/billing portal/i);
  });

  it("shows inline error text when response has no url", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeNull()
    );
    expect(screen.getByRole("alert").textContent).toMatch(/billing portal/i);
  });

  it("shows inline error text on thrown fetch error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeNull()
    );
    expect(screen.getByRole("alert").textContent).toMatch(/billing portal/i);
  });
});
