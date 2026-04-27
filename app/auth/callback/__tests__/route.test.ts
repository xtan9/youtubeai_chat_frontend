import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The recovery redirect fix routes the recovery email through this handler
// (with `?code=&next=/auth/update-password`), and the redirect path here is
// load-bearing for whether the user reaches the password-update form. These
// tests pin the exchange + redirect contract so a refactor of the route
// can't silently regress recovery — `redirect_to` would still be allowlisted
// by Supabase but the user would land somewhere unexpected after exchange.

const exchangeCodeForSession = vi.fn();
const createClient = vi.fn(async () => ({
  auth: { exchangeCodeForSession },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

import { GET } from "../route";

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    createClient.mockClear();
    // Reset NODE_ENV every test so cases that assert dev-vs-prod behavior
    // don't depend on suite ordering.
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exchanges code and redirects to next when both are present (recovery happy path)", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "https://www.youtubeai.chat/auth/callback?next=/auth/update-password&code=abc123",
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/auth/update-password"
    );
  });

  it("redirects to '/' when next is absent", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req("https://www.youtubeai.chat/auth/callback?code=abc", {
        "x-forwarded-host": "www.youtubeai.chat",
      })
    );

    expect(res.headers.get("location")).toBe("https://www.youtubeai.chat/");
  });

  it("falls back to '/' when next is not a relative path (open-redirect guard)", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "https://www.youtubeai.chat/auth/callback?code=abc&next=https://evil.example.com",
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(res.headers.get("location")).toBe("https://www.youtubeai.chat/");
  });

  it("prefers x-forwarded-host over origin in production (Vercel sets it)", async () => {
    // Recovery enters this handler via the apex origin (the allowlisted
    // form), but the production app lives on www. Vercel's edge sets
    // x-forwarded-host so the post-exchange redirect lands the user on
    // the canonical www host where their session cookies are scoped.
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "https://youtubeai.chat/auth/callback?code=abc&next=/auth/update-password",
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/auth/update-password"
    );
  });

  it("uses request origin (not x-forwarded-host) in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "http://localhost:3000/auth/callback?code=abc&next=/auth/update-password",
        // x-forwarded-host present but should be ignored in dev
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/auth/update-password"
    );
  });

  it("falls back to origin when x-forwarded-host header is absent in production", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req("https://www.youtubeai.chat/auth/callback?code=abc&next=/foo")
    );

    expect(res.headers.get("location")).toBe("https://www.youtubeai.chat/foo");
  });

  it("redirects to /auth/auth-code-error when code is missing", async () => {
    const res = await GET(
      req("https://www.youtubeai.chat/auth/callback?next=/foo")
    );

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/auth/auth-code-error"
    );
  });

  it("redirects to /auth/auth-code-error when exchangeCodeForSession errors", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("invalid auth code"),
    });

    const res = await GET(
      req(
        "https://www.youtubeai.chat/auth/callback?code=stale&next=/auth/update-password"
      )
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("stale");
    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/auth/auth-code-error"
    );
  });
});
