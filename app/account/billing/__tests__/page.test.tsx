// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedirect, mockResolveRequestPrincipal } = vi.hoisted(() => ({
  mockRedirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
  mockResolveRequestPrincipal: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mockResolveRequestPrincipal,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("../PlanBillingView", () => ({
  PlanBillingView: () => null,
}));

import PlanBillingPage from "../page";

describe("Plan & Billing page authentication boundary", () => {
  beforeEach(() => {
    mockRedirect.mockClear();
    mockResolveRequestPrincipal.mockReset();
  });

  it("redirects a logged-out visitor to the existing login flow", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "missing" });

    await expect(PlanBillingPage()).rejects.toThrow("REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects an anonymous-session visitor to the existing login flow", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "anonymous-user",
        isAnonymous: true,
        email: null,
      },
    });

    await expect(PlanBillingPage()).rejects.toThrow("REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders for a registered Learner", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "registered-user",
        isAnonymous: false,
        email: "learner@example.com",
      },
    });

    await expect(PlanBillingPage()).resolves.not.toThrow();

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockResolveRequestPrincipal).toHaveBeenCalledWith({
      source: "account",
    });
  });

  it("does not misclassify an auth-service failure as logged out", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });

    await expect(PlanBillingPage()).rejects.toThrow(
      "Auth service temporarily unavailable",
    );

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
