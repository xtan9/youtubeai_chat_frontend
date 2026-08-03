import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` is a Next.js compiler virtual module; in vitest we just need it to be a no-op import.
vi.mock("server-only", () => ({}));

const mockResolveRequestPrincipal = vi.fn();
const mockRedirect = vi.fn((path: string) => {
  // Mirror Next.js: redirect throws to short-circuit the request.
  throw new Error(`__redirect__:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mockResolveRequestPrincipal,
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
    mockResolveRequestPrincipal.mockReset();
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
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("redirects user with no email to /auth/login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: { userId: "u1", isAnonymous: false, email: null },
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("redirects non-admin email to / (homepage)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u1",
        isAnonymous: false,
        email: "carol@example.com",
      },
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/");
  });

  it("returns admin context when allowlisted", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com,bob@example.com");
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u-alice",
        isAnonymous: false,
        email: "Alice@Example.COM",
      },
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
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u-bob",
        isAnonymous: false,
        email: "bob@example.com",
      },
    });
    const { requireAdminPage } = await importGate();
    const ctx = await requireAdminPage();
    expect(ctx.email).toBe("bob@example.com");
    expect(ctx.userId).toBe("u-bob");
    expect(ctx.allowlist.size).toBe(2);
  });

  it("denies everyone and warns ONCE across repeat calls when ADMIN_EMAILS is empty", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u1",
        isAnonymous: false,
        email: "alice@example.com",
      },
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
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u1",
        isAnonymous: false,
        email: "alice@example.com",
      },
    });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/");
  });

  it("redirects a missing principal to /auth/login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    const { requireAdminPage } = await importGate();
    await expectRedirect(() => requireAdminPage(), "/auth/login");
  });

  it("throws on an unavailable principal instead of silently bouncing to login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockResolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });
    const { requireAdminPage } = await importGate();
    await expect(requireAdminPage()).rejects.toThrow(
      /auth service temporarily unavailable/i,
    );
  });

  it("accepts a resolved anonymous principal when its normalized email is allowlisted", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com");
    mockResolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "u-anon",
        isAnonymous: true,
        email: "Alice@Example.COM",
      },
    });
    const { requireAdminPage } = await importGate();
    const ctx = await requireAdminPage();
    expect(ctx.userId).toBe("u-anon");
    expect(ctx.email).toBe("alice@example.com");
  });
});
