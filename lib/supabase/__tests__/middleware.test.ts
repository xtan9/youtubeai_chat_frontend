import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
// Rest param is intentional: the test asserts on the recorded call args
// via mock.calls, but the implementation body doesn't use them.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockCreateServerClient = vi.fn((..._args: unknown[]) => ({
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

  it("redirects unauthenticated request for a protected path to /auth/login (full URL pinned)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/dashboard"));
    expect(response.status).toBe(307);
    // Pin the full URL — catches accidental path leakage, query-string
    // injection, or a regression to the legacy `/login` route.
    expect(response.headers.get("location")).toBe(
      "https://example.com/auth/login"
    );
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
    // vi.isolateModulesAsync is not available in this Vitest version, so we
    // use vi.resetModules + try/finally. We re-mock @supabase/ssr inside the
    // isolated block so the dynamically-imported middleware binds to the same
    // mockCreateServerClient spy — making the not-called assertion meaningful
    // (vs the old form which let the import bind to a fresh instance the spy
    // didn't see).
    vi.resetModules();
    try {
      vi.doMock("../../utils", () => ({ hasEnvVars: false }));
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: mockCreateServerClient,
      }));
      mockCreateServerClient.mockClear();
      const { updateSession: updateSessionNoEnv } = await import(
        "../middleware"
      );
      const response = await updateSessionNoEnv(req("/dashboard"));
      expect(response.status).toBe(200);
      expect(mockCreateServerClient).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../utils");
      vi.doUnmock("@supabase/ssr");
      vi.resetModules();
    }
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

  it.each([
    ["/loginx", "extends /login prefix"],
    ["/summary-fake", "extends /summary prefix"],
    ["/authxyz", "extends /auth prefix"],
  ])(
    "currently treats prefix-extending path %s as public (%s) — startsWith over-acceptance",
    async (pathname) => {
      // Documents the current behavior of the public-path predicate
      // (startsWith semantics): paths that EXTEND a public prefix are
      // also public. If a future PR tightens the predicate to an exact
      // match or adds a "/" suffix guard, this test will fail and force
      // a deliberate decision about the new boundary.
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const response = await updateSession(req(pathname));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  );
});
