// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_ACTIVATION_OUTCOME_STORAGE_KEY,
  BILLING_ACTIVATION_PENDING_STORAGE_KEY,
  isBillingActivationPending,
  setBillingActivationOutcome,
  setBillingActivationPending,
  useBillingActivationPending,
  useIsCheckoutReturnPending,
} from "../activation-pending";
import { isCheckoutReturnPath } from "../checkout-return";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setBillingActivationOutcome("test-cleanup", null);
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

function PendingProbe() {
  return <output>{useBillingActivationPending() ? "pending" : "idle"}</output>;
}

function ReturnGuardProbe() {
  return <output>{useIsCheckoutReturnPending() ? "guarded" : "terminal"}</output>;
}

describe("checkout activation pending signal", () => {
  it("guards only a singular, valid checkout-return route", () => {
    expect(
      isCheckoutReturnPath(
        "/billing/success",
        "?session_id=cs_test_return",
      ),
    ).toBe(true);
    expect(
      isCheckoutReturnPath(
        "/pricing",
        "?session_id=cs_test_return",
      ),
    ).toBe(false);
    expect(
      isCheckoutReturnPath(
        "/billing/success",
        "?session_id=cs_test_one&session_id=cs_test_two",
      ),
    ).toBe(false);
    expect(
      isCheckoutReturnPath("/billing/success", "?session_id=not-stripe"),
    ).toBe(false);
  });

  it("notifies Header consumers when a verified return becomes pending", () => {
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_return",
    );
    render(<PendingProbe />);

    expect(screen.getByText("idle")).not.toBeNull();
    act(() => setBillingActivationPending("cs_test_return"));
    expect(screen.getByText("pending")).not.toBeNull();
    expect(
      window.sessionStorage.getItem(BILLING_ACTIVATION_PENDING_STORAGE_KEY),
    ).toBe("cs_test_return");

    act(() => setBillingActivationPending(null));
    expect(screen.getByText("idle")).not.toBeNull();
  });

  it.each(["active", "invalid"] as const)(
    "releases the route guard after the matching session becomes %s",
    (outcome) => {
      window.history.replaceState(
        null,
        "",
        "/billing/success?session_id=cs_test_return",
      );
      render(<ReturnGuardProbe />);

      expect(screen.getByText("guarded")).not.toBeNull();
      act(() => setBillingActivationOutcome("cs_test_return", outcome));
      expect(screen.getByText("terminal")).not.toBeNull();
      expect(
        window.sessionStorage.getItem(
          BILLING_ACTIVATION_OUTCOME_STORAGE_KEY,
        ),
      ).toContain(outcome);
    },
  );

  it("does not release the route guard for another session's outcome", () => {
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_return",
    );
    setBillingActivationOutcome("cs_test_other", "active");

    render(<ReturnGuardProbe />);
    expect(screen.getByText("guarded")).not.toBeNull();
  });

  it("does not leak a stored signal into another route or return token", () => {
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_return",
    );
    setBillingActivationPending("cs_test_return");
    expect(isBillingActivationPending()).toBe(true);

    window.history.replaceState(null, "", "/pricing");
    expect(isBillingActivationPending()).toBe(false);
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_other",
    );
    expect(isBillingActivationPending()).toBe(false);
  });

  it("does not let disabled browser storage break activation", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    expect(() => setBillingActivationPending("cs_test_return")).not.toThrow();
  });

  it("releases the guard from memory when terminal storage is disabled", () => {
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_return",
    );
    render(<ReturnGuardProbe />);
    expect(screen.getByText("guarded")).not.toBeNull();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    act(() => setBillingActivationOutcome("cs_test_return", "active"));
    expect(screen.getByText("terminal")).not.toBeNull();
  });
});
