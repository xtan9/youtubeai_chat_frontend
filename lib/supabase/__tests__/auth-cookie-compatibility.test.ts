import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreateBrowserClient = vi.fn((...args: unknown[]) => ({ args }));
const mockCreateServerClient = vi.fn((...args: unknown[]) => ({
  args,
  auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

const cookieStore = {
  getAll: vi.fn(() => []),
  set: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("../../utils", () => ({
  hasEnvVars: true,
}));

import { createClient as createBrowserClient } from "../client";
import { createClient as createServerClient } from "../server";
import { updateSession } from "../middleware";

const CURRENT_PROJECT_COOKIE_NAME = "sb-fzfgyeltcvnwmluqlwhn-auth-token";

function requestWithAuthCookie() {
  return new NextRequest("https://youtubeai.chat/dashboard", {
    headers: {
      cookie: `${CURRENT_PROJECT_COOKIE_NAME}=session-token`,
    },
  });
}

describe("Supabase auth cookie compatibility", () => {
  beforeEach(() => {
    mockCreateBrowserClient.mockClear();
    mockCreateServerClient.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.youtubeai.chat");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the browser auth cookie name when the Supabase URL uses the branded host", () => {
    createBrowserClient();

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://auth.youtubeai.chat",
      "anon-key",
      {
        cookieOptions: { name: CURRENT_PROJECT_COOKIE_NAME },
      },
    );
  });

  it("keeps the server auth cookie name when the Supabase URL uses the branded host", async () => {
    await createServerClient();

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://auth.youtubeai.chat",
      "anon-key",
      expect.objectContaining({
        cookieOptions: { name: CURRENT_PROJECT_COOKIE_NAME },
      }),
    );
  });

  it("keeps the proxy auth cookie name when the Supabase URL uses the branded host", async () => {
    await updateSession(requestWithAuthCookie());

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://auth.youtubeai.chat",
      "anon-key",
      expect.objectContaining({
        cookieOptions: { name: CURRENT_PROJECT_COOKIE_NAME },
      }),
    );
  });

  it("allows another Supabase project to provide its own stable cookie name", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME",
      "sb-other-project-auth-token",
    );

    createBrowserClient();

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://auth.youtubeai.chat",
      "anon-key",
      {
        cookieOptions: { name: "sb-other-project-auth-token" },
      },
    );
  });
});
