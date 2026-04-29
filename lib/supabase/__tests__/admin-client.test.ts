import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const createClientMock = vi.fn(
  (_url: string, _key: string, _opts: unknown) => ({ __id: Math.random() }),
);
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, opts: unknown) =>
    createClientMock(url, key, opts),
}));

async function importModule() {
  vi.resetModules();
  const mod = await import("../admin-client");
  mod.__resetForTests();
  return mod;
}

describe("parseAdminAllowlist", () => {
  it("returns an empty set for undefined", async () => {
    const { parseAdminAllowlist } = await importModule();
    expect(parseAdminAllowlist(undefined).size).toBe(0);
  });

  it("returns an empty set for empty/whitespace-only", async () => {
    const { parseAdminAllowlist } = await importModule();
    expect(parseAdminAllowlist("").size).toBe(0);
    expect(parseAdminAllowlist("   ").size).toBe(0);
    expect(parseAdminAllowlist(",,,").size).toBe(0);
  });

  it("normalizes case and trims whitespace", async () => {
    const { parseAdminAllowlist } = await importModule();
    const set = parseAdminAllowlist(" Alice@Example.COM , bob@EXAMPLE.com ");
    expect(set.has("alice@example.com")).toBe(true);
    expect(set.has("bob@example.com")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("dedupes case-equivalent entries", async () => {
    const { parseAdminAllowlist } = await importModule();
    const set = parseAdminAllowlist("alice@x.com,Alice@X.COM,ALICE@x.com");
    expect(set.size).toBe(1);
    expect(set.has("alice@x.com")).toBe(true);
  });
});

describe("isAdminEmail", () => {
  it("returns false for null/undefined user", async () => {
    const { isAdminEmail } = await importModule();
    expect(isAdminEmail(null, new Set(["a@x.com"]))).toBe(false);
    expect(isAdminEmail(undefined, new Set(["a@x.com"]))).toBe(false);
  });

  it("returns false when user has no email", async () => {
    const { isAdminEmail } = await importModule();
    expect(isAdminEmail({ email: undefined }, new Set(["a@x.com"]))).toBe(false);
  });

  it("returns true on case-insensitive match", async () => {
    const { isAdminEmail } = await importModule();
    expect(isAdminEmail({ email: "Alice@X.COM" }, new Set(["alice@x.com"]))).toBe(
      true,
    );
  });

  it("returns false when not in allowlist", async () => {
    const { isAdminEmail } = await importModule();
    expect(isAdminEmail({ email: "carol@x.com" }, new Set(["alice@x.com"]))).toBe(
      false,
    );
  });
});

describe("requireAdmin", () => {
  it("throws NotAdminError when user is null", async () => {
    const { requireAdmin, NotAdminError } = await importModule();
    expect(() => requireAdmin(null, new Set())).toThrow(NotAdminError);
  });

  it("throws NotAdminError when user has no email", async () => {
    const { requireAdmin, NotAdminError } = await importModule();
    expect(() => requireAdmin({ email: undefined }, new Set())).toThrow(
      NotAdminError,
    );
  });

  it("throws NotAdminError when not in allowlist", async () => {
    const { requireAdmin, NotAdminError } = await importModule();
    expect(() =>
      requireAdmin({ email: "carol@x.com" }, new Set(["alice@x.com"])),
    ).toThrow(NotAdminError);
  });

  it("does not throw when in allowlist (case-insensitive)", async () => {
    const { requireAdmin } = await importModule();
    expect(() =>
      requireAdmin({ email: "Alice@X.COM" }, new Set(["alice@x.com"])),
    ).not.toThrow();
  });
});

describe("requireAdminClient", () => {
  beforeEach(() => {
    createClientMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws NotAdminError before any env check when user is not admin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { requireAdminClient, NotAdminError } = await importModule();
    expect(() =>
      requireAdminClient({ email: "carol@x.com" }, new Set(["alice@x.com"])),
    ).toThrow(NotAdminError);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("throws AdminClientUnavailableError when URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "the-key");
    const { requireAdminClient, AdminClientUnavailableError } = await importModule();
    expect(() =>
      requireAdminClient({ email: "alice@x.com" }, new Set(["alice@x.com"])),
    ).toThrow(AdminClientUnavailableError);
  });

  it("throws AdminClientUnavailableError when service-role key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { requireAdminClient, AdminClientUnavailableError } = await importModule();
    expect(() =>
      requireAdminClient({ email: "alice@x.com" }, new Set(["alice@x.com"])),
    ).toThrow(AdminClientUnavailableError);
  });

  it("returns a memoized client across calls with same env", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "the-key");
    const { requireAdminClient } = await importModule();
    const allowlist = new Set(["alice@x.com"]);
    const c1 = requireAdminClient({ email: "alice@x.com" }, allowlist);
    const c2 = requireAdminClient({ email: "alice@x.com" }, allowlist);
    expect(c1).toBe(c2);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh client when env signature changes", async () => {
    const { requireAdminClient, __resetForTests } = await importModule();
    const allowlist = new Set(["alice@x.com"]);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://a.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key-1");
    const c1 = requireAdminClient({ email: "alice@x.com" }, allowlist);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://b.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key-2");
    const c2 = requireAdminClient({ email: "alice@x.com" }, allowlist);

    expect(c1).not.toBe(c2);
    expect(createClientMock).toHaveBeenCalledTimes(2);

    __resetForTests();
  });
});

describe("module surface", () => {
  it("exports exactly the allowlisted public surface (no escape hatch)", async () => {
    // Frozen list — adding a new export is a deliberate decision that the
    // single-module gate contract still holds. If you find yourself updating
    // this list to add a "getAdminClientWithoutChecking"-style helper, stop.
    const expected = new Set([
      "NotAdminError",
      "AdminClientUnavailableError",
      "parseAdminAllowlist",
      "isAdminEmail",
      "requireAdmin",
      "requireAdminClient",
      "__resetForTests",
    ]);
    const mod = await importModule();
    const actual = new Set(Object.keys(mod));
    expect(actual).toEqual(expected);
  });
});
