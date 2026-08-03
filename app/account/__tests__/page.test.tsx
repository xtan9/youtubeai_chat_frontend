// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolveRequestPrincipal } = vi.hoisted(() => ({
  mockResolveRequestPrincipal: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockRedirect = vi.fn((_path: string) => {
  throw new Error("REDIRECT");
});

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mockResolveRequestPrincipal,
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

// Stub AccountView — we're only verifying the server gate here. The
// client component's behavior is covered by AccountView.test.tsx.
vi.mock("../AccountView", () => ({
  AccountView: () => null,
}));

import AccountPage from "../page";

describe("AccountPage server gate", () => {
  beforeEach(() => {
    mockResolveRequestPrincipal.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects unauthenticated users to /auth/login", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    await expect(AccountPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects Supabase-anonymous users to /auth/login", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "u-anon", isAnonymous: true, email: "" },
    });
    await expect(AccountPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders for an authenticated, non-anonymous user", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u1",
        isAnonymous: false,
        email: "test@example.com",
      },
    });
    await expect(AccountPage()).resolves.not.toThrow();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("treats undefined is_anonymous as 'not anonymous' (renders)", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u1",
        isAnonymous: false,
        email: "test@example.com",
      },
    });
    await expect(AccountPage()).resolves.not.toThrow();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("does not redirect to login when auth infrastructure is unavailable", async () => {
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });
    await expect(AccountPage()).rejects.toThrow(
      "Auth service temporarily unavailable",
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
