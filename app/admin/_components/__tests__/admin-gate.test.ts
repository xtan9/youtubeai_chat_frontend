import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` is a Next.js compiler virtual module; in vitest we just need it to be a no-op import.
vi.mock("server-only", () => ({}));

const mockGetUser = vi.fn();
const mockRedirect = vi.fn((path: string) => {
  // Mirror Next.js: redirect throws to short-circuit the request.
  throw new Error(`__redirect__:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

async function importGate() {
  // Re-import per test so the module-level cache + warning state reset.
  vi.resetModules();
  return await import("../admin-gate");
}

async function expectRedirect(
  fn: () => Promise<unknown>,
  expectedPath: string,
): Promise<void> {
  await expect(fn()).rejects.toThrow(`__redirect__:${expectedPath}`);
}

describe("requireAdminPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockRedirect.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated request to /auth/login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("redirects user with no email to /auth/login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: undefined } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("redirects user with no id to /auth/login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: { email: "alice@example.com" } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("redirects non-admin email to / (homepage)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "carol@example.com" } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/");
  });

  it("returns admin context when allowlisted", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com,bob@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u-alice", email: "Alice@Example.COM" } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    const ctx = await requireAdminPage();
    expect(ctx.email).toBe("alice@example.com");
    expect(ctx.userId).toBe("u-alice");
    expect(ctx.allowlist).toBeInstanceOf(Set);
    expect(ctx.allowlist.has("alice@example.com")).toBe(true);
    expect(ctx.allowlist.has("bob@example.com")).toBe(true);
  });

  it("trims whitespace and dedupes the allowlist (case-insensitive)", async () => {
    vi.stubEnv(
      "ADMIN_EMAILS",
      "  alice@example.com , Alice@Example.COM ,, bob@example.com",
    );
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u-bob", email: "bob@example.com" } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    const ctx = await requireAdminPage();
    expect(ctx.email).toBe("bob@example.com");
    expect(ctx.userId).toBe("u-bob");
    expect(ctx.allowlist.size).toBe(2);
  });

  it("denies everyone and warns ONCE across repeat calls when ADMIN_EMAILS is empty", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    const warnSpy = vi.spyOn(console, "warn");
    warnSpy.mockClear();
    await expectRedirect(() => requireAdminPage(), "/");
    await expectRedirect(() => requireAdminPage(), "/");
    await expectRedirect(() => requireAdminPage(), "/");
    const adminEmailsWarnings = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("ADMIN_EMAILS is empty"),
    );
    expect(adminEmailsWarnings).toHaveLength(1);
  });

  it("denies everyone when ADMIN_EMAILS is unset (literally undefined)", async () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/");
  });

  it("treats Supabase 401 as 'not signed in' (auth-client error → /auth/login)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401, message: "Bad JWT" },
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("throws on Supabase infra failure (5xx) instead of silently bouncing to login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503, message: "service unavailable" },
    });
    const { requireAdminPage } = await importGate();
    await expect(requireAdminPage()).rejects.toThrow(
      /auth service temporarily unavailable/i,
    );
  });

  it("throws on getUser() rejection (network/runtime) instead of silently bouncing", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockRejectedValue(new Error("network down"));
    const { requireAdminPage } = await importGate();
    await expect(requireAdminPage()).rejects.toThrow(
      /auth service temporarily unavailable/i,
    );
  });

  it("treats Supabase error with no status field as infra failure (fail-loud, not silent login redirect)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "no status field" },
    });
    const { requireAdminPage } = await importGate();
    await expect(requireAdminPage()).rejects.toThrow(
      /auth service temporarily unavailable/i,
    );
  });

  it("preserves the original error as cause when rethrowing as AuthInfraError (5xx path)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    const original = { status: 503, message: "service unavailable" };
    mockGetUser.mockResolvedValue({ data: { user: null }, error: original });
    const { requireAdminPage } = await importGate();
    try {
      await requireAdminPage();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBe(original);
    }
  });

  it("preserves the original error as cause when rethrowing on getUser() rejection", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    const original = new Error("network down");
    mockGetUser.mockRejectedValue(original);
    const { requireAdminPage } = await importGate();
    try {
      await requireAdminPage();
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).cause).toBe(original);
    }
  });
});
