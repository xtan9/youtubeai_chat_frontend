import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasArabicChars,
  hasFrenchAnchors,
  loadAdminCreds,
  loadAdminSmokeCreds,
  loadSmokeCreds,
  parseEnvFile,
  withTrustedSmokeAccount,
} from "../helpers";

describe("hasArabicChars", () => {
  it("returns false for empty string", () => {
    expect(hasArabicChars("")).toBe(false);
  });

  it("returns false for plain Latin text", () => {
    expect(hasArabicChars("Le 27 mars 1977, deux avions...")).toBe(false);
  });

  it("returns true for any Arabic character", () => {
    expect(hasArabicChars("بسم")).toBe(true);
  });

  it("returns true even for one Arabic char in otherwise Latin text", () => {
    expect(hasArabicChars("Bonjour ا tout le monde")).toBe(true);
  });
});

describe("hasFrenchAnchors", () => {
  it("returns false for empty string", () => {
    expect(hasFrenchAnchors("")).toBe(false);
  });

  it("returns true for text containing common French words", () => {
    expect(hasFrenchAnchors("Le chat est sur la table")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasFrenchAnchors("JE suis ici")).toBe(true);
  });

  it("requires word boundaries (does not match substrings)", () => {
    // "est" inside "pestle" would be a false positive without \b
    expect(hasFrenchAnchors("The pestle was broken")).toBe(false);
  });

  it("returns false for pure English text without overlap", () => {
    expect(hasFrenchAnchors("Hello world how are you today")).toBe(false);
  });
});

describe("withTrustedSmokeAccount", () => {
  it("accepts a fetched account with the trusted marker", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "smoke-user",
          app_metadata: { is_smoke_account: true },
        },
      },
      error: null,
    });
    const mutation = vi.fn().mockResolvedValue("mutated");

    const userId = await withTrustedSmokeAccount({ getUser }, (user) => {
      mutation(user.id);
      return user.id;
    });

    expect(userId).toBe("smoke-user");
    expect(getUser).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    { app_metadata: {} },
    { app_metadata: { is_smoke_account: false } },
    { app_metadata: { is_smoke_account: "true" } },
  ])("refuses an account without a true marker before mutation: %j", async (user) => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: user ? { id: "unmarked-user", ...user } : undefined },
      error: null,
    });
    const mutation = vi.fn();

    await expect(
      withTrustedSmokeAccount({ getUser }, () => mutation()),
    ).rejects.toThrow(
      "authenticated, marked Smoke Account",
    );
    expect(getUser).toHaveBeenCalledOnce();
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("parseEnvFile", () => {
  it("parses KEY=value pairs", () => {
    expect(parseEnvFile("A=1\nB=2")).toEqual({ A: "1", B: "2" });
  });

  it("strips export prefix", () => {
    expect(parseEnvFile("export FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("strips double quotes", () => {
    expect(parseEnvFile('NAME="Jane Doe"')).toEqual({ NAME: "Jane Doe" });
  });

  it("strips single quotes", () => {
    expect(parseEnvFile("NAME='Jane Doe'")).toEqual({ NAME: "Jane Doe" });
  });

  it("skips comments and blank lines", () => {
    const raw = "# comment\n\nA=1\n# another\nB=2";
    expect(parseEnvFile(raw)).toEqual({ A: "1", B: "2" });
  });

  it("ignores malformed lines (no equals sign)", () => {
    expect(parseEnvFile("notvalid\nA=1")).toEqual({ A: "1" });
  });
});

describe("loadSmokeCreds", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prefers env vars over file", async () => {
    vi.stubEnv("TEST_USER_EMAIL", "env@example.com");
    vi.stubEnv("TEST_USER_PASSWORD", "envpass");

    const creds = await loadSmokeCreds();
    expect(creds).toEqual({
      email: "env@example.com",
      password: "envpass",
      source: "env",
    });
  });

  it("prefers the dedicated non-admin CI pair over legacy user variables", async () => {
    vi.stubEnv("TEST_NON_ADMIN_EMAIL", "smoke-non-admin@example.com");
    vi.stubEnv("TEST_NON_ADMIN_PASSWORD", "smoke-password");
    vi.stubEnv("TEST_USER_EMAIL", "legacy@example.com");
    vi.stubEnv("TEST_USER_PASSWORD", "legacy-password");

    await expect(loadSmokeCreds()).resolves.toMatchObject({
      email: "smoke-non-admin@example.com",
      password: "smoke-password",
      source: "env",
    });
  });

  it("does not fall back to a legacy identity when a dedicated pair is incomplete", async () => {
    vi.stubEnv("TEST_NON_ADMIN_EMAIL", "smoke-non-admin@example.com");
    vi.stubEnv("TEST_NON_ADMIN_PASSWORD", "");
    vi.stubEnv("TEST_USER_EMAIL", "legacy@example.com");
    vi.stubEnv("TEST_USER_PASSWORD", "legacy-password");

    await expect(loadSmokeCreds()).resolves.toBeNull();
  });

  it("returns null when env is absent and file is missing", async () => {
    vi.stubEnv("TEST_USER_EMAIL", "");
    vi.stubEnv("TEST_USER_PASSWORD", "");
    // Point HOME at a tmpdir with no creds file so the file-fallback path
    // hits a real ENOENT — avoids ESM module-spy limitations.
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-creds-"));
    vi.stubEnv("HOME", tmpHome);

    const creds = await loadSmokeCreds();
    expect(creds).toBeNull();
  });
});

describe("loadAdminCreds", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when SUPABASE_URL or SECRET key missing AND file absent", async () => {
    process.env.TEST_USER_EMAIL = "x@example.com";
    process.env.TEST_USER_PASSWORD = "x";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.HOME = "/nonexistent-test-home-xyz";
    const r = await loadAdminCreds();
    expect(r).toBeNull();
  });

  it("returns admin creds when both env vars are set", async () => {
    process.env.TEST_USER_EMAIL = "x@example.com";
    process.env.TEST_USER_PASSWORD = "x";
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const r = await loadAdminCreds();
    expect(r).not.toBeNull();
    expect(r!.supabaseUrl).toBe("https://supabase.example.com");
    expect(r!.secretKey).toBe("sb_secret_test");
    expect(r!.email).toBe("x@example.com");
  });

  it("uses only the explicit administrator Smoke Account pair", async () => {
    process.env.TEST_ADMIN_EMAIL = "admin-smoke@example.com";
    process.env.TEST_ADMIN_PASSWORD = "admin-password";
    process.env.TEST_NON_ADMIN_EMAIL = "non-admin-smoke@example.com";
    process.env.TEST_NON_ADMIN_PASSWORD = "non-admin-password";
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

    await expect(loadAdminSmokeCreds()).resolves.toEqual({
      email: "admin-smoke@example.com",
      password: "admin-password",
      source: "env",
      supabaseUrl: "https://supabase.example.com",
      secretKey: "sb_secret_test",
    });
  });

  it("refuses an incomplete administrator Smoke Account pair", async () => {
    process.env.TEST_ADMIN_EMAIL = "admin-smoke@example.com";
    delete process.env.TEST_ADMIN_PASSWORD;
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

    await expect(loadAdminSmokeCreds()).resolves.toBeNull();
  });
});
