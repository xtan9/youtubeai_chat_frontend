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
    ["/blog", "blog index"],
    ["/blog/some-post", "blog post"],
    ["/faq", "faq"],
    ["/pricing", "pricing page"],
    ["/api/health", "health probe"],
    // Paywall routes — must be reachable unauthenticated for their own
    // auth strategies to run (signature verification, JSON 401, anon-tier
    // branch). Without these rows, a future predicate refactor could
    // silently re-introduce the redirect that breaks every webhook
    // delivery and clobbers JSON billing responses into HTML 307s.
    ["/api/webhooks/stripe", "stripe webhook"],
    ["/api/billing/checkout", "billing checkout"],
    ["/api/billing/portal", "billing portal"],
    ["/api/me/entitlements", "entitlements"],
  ])("allows unauthenticated access to %s (%s)", async (pathname) => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req(pathname));
    expect(response.status).toBe(200);
    // No redirect header set
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects /api/me/entitlementsX (entitlements is exact-match, /api/me/* is NOT public)", async () => {
    // Pins the deliberate use of `===` rather than `startsWith` for
    // /api/me/entitlements. If a future refactor broadens the predicate
    // to startsWith("/api/me/"), this test will fail and force a
    // conscious decision about the new attack surface.
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/api/me/entitlementsX"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/auth/login"
    );
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

  it("redirects authenticated user from / to /dashboard", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    const response = await updateSession(req("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/dashboard"
    );
  });

  it("redirects user with is_anonymous=false explicitly set from / to /dashboard", async () => {
    // The above test omits `is_anonymous`, which is `undefined` (legacy /
    // pre-anon-auth JWT shape). Pinning the explicit-false case too
    // protects the predicate from a future inversion (e.g. someone
    // refactors `!user.is_anonymous` to `user.is_anonymous === true`,
    // which would silently break the redirect for the common case).
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com", is_anonymous: false } },
    });
    const response = await updateSession(req("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/dashboard"
    );
  });

  it("does NOT redirect anonymous user on /", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(req("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does NOT redirect Supabase-anonymous user (is_anonymous=true) from / to /dashboard", async () => {
    // Hero demo on `/` calls signInAnonymously() so anon visitors can use
    // the in-page chat. That issues a real Supabase JWT with
    // is_anonymous=true. The marketing homepage redirect must distinguish
    // these from real signed-in users — otherwise every visitor who
    // touches the hero gets bounced to /dashboard on the next visit.
    mockGetUser.mockResolvedValue({
      data: { user: { id: "anon-1", email: "", is_anonymous: true } },
    });
    const response = await updateSession(req("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does NOT block Supabase-anonymous user from /api/chat/stream (anon chat is the whole point)", async () => {
    // Defensive pin: anon-auth users MUST be able to reach chat/summarize
    // routes from the homepage hero. A future refactor that broadens the
    // unauthenticated bounce to also catch is_anonymous would silently
    // break the anon-chat funnel.
    mockGetUser.mockResolvedValue({
      data: { user: { id: "anon-1", email: "", is_anonymous: true } },
    });
    const response = await updateSession(req("/api/chat/stream"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does NOT redirect authenticated user away from /summary", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    const response = await updateSession(req("/summary"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects authenticated user from / to /dashboard regardless of query string", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    const response = await updateSession(
      new NextRequest("https://example.com/?utm_source=email")
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/dashboard"
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
