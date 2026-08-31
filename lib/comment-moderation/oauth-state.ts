import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

type OAuthStatePayload = {
  u: string;
  n: string;
  e: number;
};

function stateSecret(): string {
  const secret = process.env.YOUTUBE_OAUTH_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "YOUTUBE_OAUTH_STATE_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

function sign(body: string): string {
  return createHmac("sha256", stateSecret())
    .update(body, "utf8")
    .digest("base64url");
}

export function createYouTubeOAuthState(
  userId: string,
  now: number = Date.now(),
): string {
  const payload: OAuthStatePayload = {
    u: userId,
    n: randomBytes(16).toString("base64url"),
    e: now + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${body}.${sign(body)}`;
}

export function verifyYouTubeOAuthState(
  value: string,
  expectedUserId: string,
  now: number = Date.now(),
): boolean {
  const [body, signature, ...rest] = value.split(".");
  if (!body || !signature || rest.length > 0) return false;
  const expectedSignature = sign(body);
  const supplied = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<OAuthStatePayload>;
    return (
      payload.u === expectedUserId &&
      typeof payload.n === "string" &&
      payload.n.length >= 16 &&
      typeof payload.e === "number" &&
      Number.isSafeInteger(payload.e) &&
      payload.e >= now
    );
  } catch {
    return false;
  }
}
