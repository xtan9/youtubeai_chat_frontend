// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockRedirect = vi.fn((_path: string) => {
  throw new Error("REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
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
    mockGetUser.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects unauthenticated users to /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(AccountPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects Supabase-anonymous users to /auth/login", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u-anon", is_anonymous: true } },
    });
    await expect(AccountPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders for an authenticated, non-anonymous user", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false, email: "test@example.com" } },
    });
    await expect(AccountPage()).resolves.not.toThrow();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("treats undefined is_anonymous as 'not anonymous' (renders)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "test@example.com" } },
    });
    await expect(AccountPage()).resolves.not.toThrow();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
