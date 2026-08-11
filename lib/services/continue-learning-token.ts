import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "cl1";
const MIN_SECRET_LENGTH = 32;

export type ContinueLearningTokenBinding = Readonly<{
  learnerId: string;
  setId: string;
  ordinal: number;
}>;

export type ContinueLearningSetTokenBinding = Readonly<{
  learnerId: string;
  setId: string;
}>;

function secret(): string | null {
  const value = process.env.CONTINUE_LEARNING_TOKEN_SECRET?.trim();
  return value && value.length >= MIN_SECRET_LENGTH ? value : null;
}
function bindingMessage(binding: ContinueLearningTokenBinding): string | null {
  if (
    !binding.learnerId ||
    !binding.setId ||
    !Number.isSafeInteger(binding.ordinal) ||
    binding.ordinal < 1 ||
    binding.ordinal > 50
  ) {
    return null;
  }
  return `continue-learning:${TOKEN_VERSION}:${binding.learnerId}:${binding.setId}:${binding.ordinal}`;
}

function digest(value: string, signingSecret: string): Buffer {
  return createHmac("sha256", signingSecret).update(value).digest();
}

function setBindingMessage(
  binding: ContinueLearningSetTokenBinding,
): string | null {
  if (!binding.learnerId || !binding.setId) return null;
  return `continue-learning-set:${TOKEN_VERSION}:${binding.learnerId}:${binding.setId}`;
}

/**
 * Returns a token containing only a version and HMAC digest. Internal learner,
 * Set, and ordinal identifiers are never serialized into the browser token.
 */
export function signContinueLearningToken(
  binding: ContinueLearningTokenBinding,
): string | null {
  const signingSecret = secret();
  const message = bindingMessage(binding);
  if (!signingSecret || !message) return null;
  return `${TOKEN_VERSION}.${digest(message, signingSecret).toString("base64url")}`;
}

/** Sign the current Set version without serializing its internal id. */
export function signContinueLearningSetToken(
  binding: ContinueLearningSetTokenBinding,
): string | null {
  const signingSecret = secret();
  const message = setBindingMessage(binding);
  if (!signingSecret || !message) return null;
  return `${TOKEN_VERSION}s.${digest(message, signingSecret).toString("base64url")}`;
}

export function verifyContinueLearningToken(
  token: string,
  binding: ContinueLearningTokenBinding,
): boolean {
  const signingSecret = secret();
  const message = bindingMessage(binding);
  if (!signingSecret || !message || typeof token !== "string") return false;

  const [version, encodedDigest, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedDigest || extra !== undefined) {
    return false;
  }

  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedDigest, "base64url");
  } catch {
    return false;
  }
  const expected = digest(message, signingSecret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function verifyContinueLearningSetToken(
  token: string,
  binding: ContinueLearningSetTokenBinding,
): boolean {
  const signingSecret = secret();
  const message = setBindingMessage(binding);
  if (!signingSecret || !message || typeof token !== "string") return false;

  const [version, encodedDigest, extra] = token.split(".");
  if (version !== `${TOKEN_VERSION}s` || !encodedDigest || extra !== undefined) {
    return false;
  }
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedDigest, "base64url");
  } catch {
    return false;
  }
  const expected = digest(message, signingSecret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
