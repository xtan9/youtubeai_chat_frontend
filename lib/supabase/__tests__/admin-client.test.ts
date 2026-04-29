import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Each createClient invocation produces a deterministically-tagged object so
// later assertions can prove WHICH invocation produced the returned client,
// not just that they're different objects.
let createClientCallSeq = 0;
// Mock receives the 3 args the real createClient takes (url, key, opts).
// Tests assert on calls[i][0] / [1] (url/key); opts is captured for shape
// fidelity but not asserted.
const createClientMock = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (url: string, key: string, _opts: unknown) => ({
    __id: ++createClientCallSeq,
    __url: url,
    __key: key,
  }),
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
    createClientCallSeq = 0;
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

  it("returns the client createClient produced (not a stub)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "the-key");
    const { requireAdminClient } = await importModule();
    const c = requireAdminClient({ email: "alice@x.com" }, new Set(["alice@x.com"]));
    expect(c).toBe(createClientMock.mock.results[0].value);
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

  it("memoization is keyed by env signature: URL change forces a new client with the new URL", async () => {
    const { requireAdminClient } = await importModule();
    const allowlist = new Set(["alice@x.com"]);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://a.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "the-key");
    const c1 = requireAdminClient({ email: "alice@x.com" }, allowlist);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://b.supabase.co");
    const c2 = requireAdminClient({ email: "alice@x.com" }, allowlist);

    expect(c1).not.toBe(c2);
    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(createClientMock).toHaveBeenNthCalledWith(
      1,
      "https://a.supabase.co",
      "the-key",
      expect.anything(),
    );
    expect(createClientMock).toHaveBeenNthCalledWith(
      2,
      "https://b.supabase.co",
      "the-key",
      expect.anything(),
    );
  });

  it("memoization is keyed by env signature: KEY change forces a new client with the new key", async () => {
    const { requireAdminClient } = await importModule();
    const allowlist = new Set(["alice@x.com"]);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://a.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key-1");
    requireAdminClient({ email: "alice@x.com" }, allowlist);

    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key-2");
    requireAdminClient({ email: "alice@x.com" }, allowlist);

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(createClientMock.mock.calls[0][1]).toBe("key-1");
    expect(createClientMock.mock.calls[1][1]).toBe("key-2");
  });

  it("memoization survives across calls with different allowlist Sets (the cache is env-keyed, not user-keyed)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://a.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
    const { requireAdminClient } = await importModule();

    const allowA = new Set(["alice@x.com"]);
    const allowB = new Set(["alice@x.com", "bob@x.com"]);
    const c1 = requireAdminClient({ email: "alice@x.com" }, allowA);
    const c2 = requireAdminClient({ email: "alice@x.com" }, allowB);
    expect(c1).toBe(c2);
    expect(createClientMock).toHaveBeenCalledTimes(1);
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
