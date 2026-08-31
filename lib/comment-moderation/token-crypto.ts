import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const TOKEN_VERSION = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "YOUTUBE_TOKEN_ENCRYPTION_KEY must contain at least 32 characters",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptYouTubeToken(plaintext: string): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty YouTube token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptYouTubeToken(ciphertext: string): string {
  const [version, ivValue, tagValue, encryptedValue, ...rest] =
    ciphertext.split(".");
  if (
    version !== TOKEN_VERSION ||
    !ivValue ||
    !tagValue ||
    !encryptedValue ||
    rest.length > 0
  ) {
    throw new Error("Unsupported encrypted YouTube token");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
