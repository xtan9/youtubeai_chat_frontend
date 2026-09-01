import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createEnvironmentOAuthTokenEncryptor,
  decryptYouTubeOAuthTokenSet,
  encryptYouTubeOAuthTokenSet,
} from "../credentials";
import { YOUTUBE_READONLY_SCOPE } from "../scopes";

const TOKENS = {
  accessToken: "access-token-test-only",
  refreshToken: "refresh-token-test-only",
  scopes: [YOUTUBE_READONLY_SCOPE] as const,
  expiresAt: "2026-09-01T13:00:00.000Z",
};

describe("YouTube OAuth credential encryption boundary", () => {
  it("encrypts transient tokens into an authenticated envelope that round-trips only with the key", () => {
    const key = new Uint8Array(32).fill(7);

    const envelope = encryptYouTubeOAuthTokenSet(TOKENS, {
      key,
      keyVersion: "test-key-v1",
    });

    expect(envelope).toMatchObject({
      version: 1,
      algorithm: "aes-256-gcm",
      keyVersion: "test-key-v1",
    });
    expect(JSON.stringify(envelope)).not.toContain(TOKENS.accessToken);
    expect(JSON.stringify(envelope)).not.toContain(TOKENS.refreshToken);
    expect(
      decryptYouTubeOAuthTokenSet(envelope, { key }),
    ).toEqual(TOKENS);
    expect(() =>
      decryptYouTubeOAuthTokenSet(envelope, {
        key: new Uint8Array(32).fill(8),
      }),
    ).toThrow();
  });

  it("does not create an encryptor when the server key is absent or malformed", () => {
    vi.stubEnv("CHANNEL_OAUTH_TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("CHANNEL_OAUTH_TOKEN_ENCRYPTION_KEY_VERSION", "test-key-v1");
    expect(createEnvironmentOAuthTokenEncryptor()).toBeNull();

    vi.stubEnv(
      "CHANNEL_OAUTH_TOKEN_ENCRYPTION_KEY",
      Buffer.alloc(31, 7).toString("base64url"),
    );
    expect(createEnvironmentOAuthTokenEncryptor()).toBeNull();
  });
});
