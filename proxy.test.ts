import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const { getUser, createServerClient } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@/lib/utils", () => ({ hasEnvVars: true }));

import { config, proxy } from "./proxy";

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  createServerClient.mockReset();
  createServerClient.mockReturnValue({ auth: { getUser } });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
});

afterEach(() => vi.unstubAllEnvs());

describe("public analytics proxy boundary", () => {
  it.each([
    ["/ingest", "POST"],
    ["/ingest/e/", "POST"],
    ["/ingest/array/public-project-key/config.js", "GET"],
    ["/ingest/static/exception-autocapture.js?v=1.409.0", "GET"],
  ])("allows %s (%s) without a session or with an expired session", async (pathname, method) => {
    for (const cookie of [undefined, "sb-project-ref-auth-token=expired-token"]) {
      const request = new NextRequest(`https://example.com${pathname}`, {
        method,
        headers: cookie ? { cookie } : undefined,
      });
      const response = await proxy(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(createServerClient).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
    }
  });

  it("removes application credentials before forwarding an analytics request", async () => {
    const request = new NextRequest("https://example.com/ingest/e/", {
      method: "POST",
      headers: {
        cookie: "sb-project-ref-auth-token=private-session; preference=private",
        authorization: "Bearer private-access-token",
        "content-type": "application/json",
      },
    });

    const response = await proxy(request);

    expect(response.headers.get("x-middleware-override-headers")).toBe("content-type");
    expect(response.headers.get("x-middleware-request-content-type")).toBe("application/json");
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-request-authorization")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
    expect(request.headers.get("authorization")).toBe("Bearer private-access-token");
  });

  it.each([
    "/ingest",
    "/ingest/array/public-project-key/config.js",
    "/ingest/static/pixel.png",
    "/ingest/static/icon.svg",
  ])("applies the credential boundary to %s through the real route matcher", (pathname) => {
    expect(unstable_doesMiddlewareMatch({ config, url: pathname })).toBe(true);
  });

  it("continues to exclude ordinary Next static assets from the proxy", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/_next/static/app.js" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, url: "/logo.png" })).toBe(false);
  });

  it.each([
    "/ingest-private/config.js",
    "/ingestion",
    "/admin",
    "/api/projects/private.js",
  ])("preserves the authentication boundary for %s", async (pathname) => {
    for (const cookie of [undefined, "sb-project-ref-auth-token=expired-token"]) {
      const response = await proxy(new NextRequest(`https://example.com${pathname}`, {
        headers: cookie ? { cookie } : undefined,
      }));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://example.com/auth/login");
    }
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
