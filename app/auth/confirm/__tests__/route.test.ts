import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyOtp, createClient, redirect } = vi.hoisted(() => {
  const verifyOtp = vi.fn();
  const createClient = vi.fn(async () => ({
    auth: { verifyOtp },
  }));
  const redirect = vi.fn((location: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { location });
  });

  return { verifyOtp, createClient, redirect };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

vi.mock("next/navigation", () => ({ redirect }));

import { GET } from "../route";

function req(url: string): NextRequest {
  return new NextRequest(url);
}

async function captureRedirect(request: NextRequest): Promise<string> {
  try {
    await GET(request);
  } catch (error) {
    if (error instanceof Error && "location" in error) {
      return String((error as Error & { location: string }).location);
    }
    throw error;
  }

  throw new Error("Expected GET /auth/confirm to redirect");
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    createClient.mockClear();
    redirect.mockClear();
  });

  it("verifies the token and redirects to a safe relative next path", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const location = await captureRedirect(
      req(
        "https://www.youtubeai.chat/auth/confirm?token_hash=hash123&type=email&next=/account?tab=security",
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "hash123",
    });
    expect(location).toBe("/account?tab=security");
  });

  it("defaults to /dashboard when next is absent", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const location = await captureRedirect(
      req(
        "https://www.youtubeai.chat/auth/confirm?token_hash=hash123&type=email",
      ),
    );

    expect(location).toBe("/dashboard");
  });

  it.each([
    "https://evil.example.com/account",
    "//evil.example.com/account",
  ])("defaults to /dashboard for unsafe next %s", async (next) => {
    verifyOtp.mockResolvedValue({ error: null });

    const location = await captureRedirect(
      req(
        `https://www.youtubeai.chat/auth/confirm?token_hash=hash123&type=email&next=${encodeURIComponent(next)}`,
      ),
    );

    expect(location).toBe("/dashboard");
  });

  it("encodes Supabase verification errors on the same-origin error page", async () => {
    const message = "invalid token: https://evil.example.com/?next=/dashboard&x=1";
    verifyOtp.mockResolvedValue({ error: new Error(message) });

    const location = await captureRedirect(
      req(
        "https://www.youtubeai.chat/auth/confirm?token_hash=stale&type=email",
      ),
    );

    const errorUrl = new URL(location, "https://www.youtubeai.chat");
    expect(location.startsWith("https://")).toBe(false);
    expect(errorUrl.pathname).toBe("/auth/error");
    expect(errorUrl.searchParams.get("error")).toBe(message);
    expect(redirect).toHaveBeenCalledWith(location);
  });

  it("redirects missing token parameters to the error page", async () => {
    const location = await captureRedirect(
      req("https://www.youtubeai.chat/auth/confirm"),
    );

    const errorUrl = new URL(location, "https://www.youtubeai.chat");
    expect(errorUrl.pathname).toBe("/auth/error");
    expect(errorUrl.searchParams.get("error")).toBe("No token hash or type");
  });
});
