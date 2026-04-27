import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// /auth/callback handles the PKCE code-exchange landing for OAuth and email
// confirmation flows (signup, magic-link). Recovery does NOT route through
// this handler — see lib/auth/recovery-redirect.ts for why (Supabase's
// recovery email path uses implicit grant, not PKCE, in this project).
// These tests pin the exchange + redirect contract so a refactor of the
// route can't silently regress sign-in/signup flows after Vercel's edge
// 307 from non-www to www.

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

  it("exchanges code and redirects to next when both are present (OAuth/signup happy path)", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "https://www.youtubeai.chat/auth/callback?next=/account&code=abc123",
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/account"
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
    // OAuth providers (e.g. Google) sometimes redirect through the apex
    // origin while the production app lives on www. Vercel's edge sets
    // x-forwarded-host so the post-exchange redirect lands the user on
    // the canonical www host where their session cookies are scoped.
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "https://youtubeai.chat/auth/callback?code=abc&next=/account",
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/account"
    );
  });

  it("uses request origin (not x-forwarded-host) in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      req(
        "http://localhost:3000/auth/callback?code=abc&next=/account",
        // x-forwarded-host present but should be ignored in dev
        { "x-forwarded-host": "www.youtubeai.chat" }
      )
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/account"
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
        "https://www.youtubeai.chat/auth/callback?code=stale&next=/account"
      )
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("stale");
    expect(res.headers.get("location")).toBe(
      "https://www.youtubeai.chat/auth/auth-code-error"
    );
  });
});
