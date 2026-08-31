import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decryptYouTubeToken, encryptYouTubeToken } from "../token-crypto";

describe("YouTube token encryption", () => {
  beforeEach(() => {
    vi.stubEnv(
      "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      "test-only-secret-that-is-longer-than-thirty-two-characters",
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("round-trips without exposing the plaintext", () => {
    const encrypted = encryptYouTubeToken("provider-refresh-token");
    expect(encrypted).not.toContain("provider-refresh-token");
    expect(decryptYouTubeToken(encrypted)).toBe("provider-refresh-token");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptYouTubeToken("provider-refresh-token");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("a") ? "b" : "a"}`;
    expect(() => decryptYouTubeToken(tampered)).toThrow();
  });

  it("fails closed when the key is missing", () => {
    vi.stubEnv("YOUTUBE_TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptYouTubeToken("token")).toThrow(/at least 32/);
  });
});
