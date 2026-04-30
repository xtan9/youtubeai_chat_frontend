// lib/services/anon-cookie.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const ANON_COOKIE_NAME = "yt_anon_id";

// 1 year. Sliding via re-set on each request would extend lifetime; we
// don't bother — fixed expiry is fine, the counter survives even if the
// cookie expires (orphaned row GC'd at 90 days).
export const ANON_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function getSecret(): string | null {
  const s = process.env.ANON_COOKIE_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") {
      console.error("[anon-cookie] ANON_COOKIE_SECRET missing or too short", {
        errorId: "ANON_COOKIE_SECRET_MISSING",
      });
    }
    return null;
  }
  return s;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Sign a UUID. Returns "<uuid>.<hmac-hex>" or null if secret missing. */
export function signAnonId(uuid: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return `${uuid}.${hmac(secret, uuid)}`;
}

/** Verify a signed cookie. Returns the UUID on success, null otherwise. */
export function verifyAnonId(signed: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const dot = signed.indexOf(".");
  if (dot <= 0 || dot === signed.length - 1) return null;
  const id = signed.slice(0, dot);
  const tag = signed.slice(dot + 1);
  const expected = hmac(secret, id);
  if (tag.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(tag, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  return id;
}
