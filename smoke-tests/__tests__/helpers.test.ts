import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasArabicChars,
  hasFrenchAnchors,
  loadAdminCreds,
  loadSmokeCreds,
  parseEnvFile,
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
});
