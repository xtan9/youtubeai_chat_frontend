// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSignInAnonymously, mockGetSession, mockUseUser } = vi.hoisted(
  () => ({
    mockSignInAnonymously: vi.fn(),
    mockGetSession: vi.fn(),
    mockUseUser: vi.fn(),
  })
);

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInAnonymously: mockSignInAnonymously,
      getSession: mockGetSession,
    },
  }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => mockUseUser(),
}));

import { useAnonSession } from "../useAnonSession";

describe("useAnonSession", () => {
  beforeEach(() => {
    mockSignInAnonymously.mockReset();
    mockGetSession.mockReset();
    mockUseUser.mockReturnValue({ session: null, user: null });
  });

  it("calls signInAnonymously when no existing Supabase session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "anon-token" } },
      error: null,
    });

    const { result } = renderHook(() => useAnonSession());

    await waitFor(() => {
      expect(result.current.anonSession?.access_token).toBe("anon-token");
    });
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("reuses existing anonymous session without calling signInAnonymously", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "existing-token" } },
    });

    const { result } = renderHook(() => useAnonSession());

    await waitFor(() => {
      expect(result.current.anonSession?.access_token).toBe("existing-token");
    });
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("logs and stays unauthenticated when sign-in errors", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAnonSession());

    await waitFor(() => {
      expect(errSpy).toHaveBeenCalled();
    });
    expect(result.current.anonSession).toBeNull();
    errSpy.mockRestore();
  });

  it("does not bootstrap when a real (non-anon) session exists", async () => {
    mockUseUser.mockReturnValue({
      session: { access_token: "real-user-token" },
      user: { id: "u1" },
    });

    renderHook(() => useAnonSession());

    // Give effects a tick to run
    await new Promise((r) => setTimeout(r, 0));

    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });
});
