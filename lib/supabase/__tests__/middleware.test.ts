import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockCreateServerClient = vi.fn(() => ({
  auth: { getUser: mockGetUser },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock("../../utils", () => ({
  hasEnvVars: true,
}));

import { updateSession } from "../middleware";

function req(pathname: string): NextRequest {
  return new NextRequest(`https://example.com${pathname}`);
}

describe("updateSession", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockCreateServerClient.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["/", "home"],
    ["/summary", "summary index"],
    ["/summary?url=foo", "summary with query"],
    ["/auth/login", "auth login"],
    ["/auth/sign-up", "auth signup"],
    ["/login", "legacy login"],
    ["/privacy", "privacy"],
    ["/terms", "terms"],
    ["/api/health", "health probe"],
  ])("allows unauthenticated access to %s (%s)", async (pathname) => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req(pathname));
    expect(response.status).toBe(200);
    // No redirect header set
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated request for a protected path to /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/\/auth\/login$/);
  });

  it("allows authenticated request to a protected path", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    const response = await updateSession(req("/dashboard"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("short-circuits without calling supabase when hasEnvVars is false", async () => {
    vi.resetModules();
    vi.doMock("../../utils", () => ({ hasEnvVars: false }));
    const { updateSession: updateSessionNoEnv } = await import("../middleware");
    const response = await updateSessionNoEnv(req("/dashboard"));
    expect(response.status).toBe(200);
    // createServerClient should not have been called this run
    expect(mockCreateServerClient).not.toHaveBeenCalled();
    vi.doUnmock("../../utils");
  });

  it("trims env vars before passing them to createServerClient", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "  https://supabase.example.com  ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "  anon-key\n");
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await updateSession(req("/dashboard"));
    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://supabase.example.com",
      "anon-key",
      expect.any(Object)
    );
  });
});
