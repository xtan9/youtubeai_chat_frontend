import { createHmac } from "node:crypto";

export const ANON_COOKIE_NAME = "yt_anon_id";
export const ANON_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

function getSecret(): string | null {
  return process.env.ANON_COOKIE_SECRET ?? null;
}

/**
 * Signs a UUID to produce a cookie value of the form `<uuid>.<hmac>`.
 * Returns null if the secret env var is not set (fail-open: caller skips
 * cookie issuance, leaving anonId as null and skipping entitlement tracking).
 */
export function signAnonId(id: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const mac = createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${mac}`;
}

/**
 * Verifies a signed cookie value. Returns the raw UUID on success, null on
 * tamper / missing secret.
 */
export function verifyAnonId(value: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const lastDot = value.lastIndexOf(".");
  if (lastDot === -1) return null;
  const id = value.slice(0, lastDot);
  const expected = createHmac("sha256", secret).update(id).digest("base64url");
  const actual = value.slice(lastDot + 1);
  // Constant-time comparison to prevent timing attacks.
  if (expected.length !== actual.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0 ? id : null;
}
