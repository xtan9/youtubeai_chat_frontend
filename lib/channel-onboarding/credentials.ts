import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

import { YouTubeOAuthScopeSchema } from "./scopes";

const SecretTextSchema = z.string().trim().min(1).max(4_096);
const RecordTextSchema = z.string().trim().min(1).max(240);
const InstantSchema = z.string().datetime({ offset: true });
const Base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u, "Expected unpadded base64url.");
const InitializationVectorSchema = Base64UrlSchema.length(16);
const CiphertextSchema = Base64UrlSchema.min(1).max(32_768);
const AuthenticationTagSchema = Base64UrlSchema.length(22);

/**
 * Raw tokens are transient provider-boundary data. They are never part of a
 * ChannelConnection, callback result, log record, analytics event, or model
 * request. A caller must hand them directly to a token encryptor.
 */
export const YouTubeOAuthTokenSetSchema = z
  .object({
    accessToken: SecretTextSchema,
    refreshToken: SecretTextSchema.optional(),
    scopes: z
      .array(YouTubeOAuthScopeSchema)
      .min(1)
      .max(2)
      .superRefine((scopes, context) => {
        if (new Set(scopes).size !== scopes.length) {
          context.addIssue({
            code: "custom",
            message: "OAuth scopes must not be duplicated.",
          });
        }
      })
      .readonly(),
    expiresAt: InstantSchema.nullable().optional(),
  })
  .strict();

export type YouTubeOAuthTokenSet = z.infer<
  typeof YouTubeOAuthTokenSetSchema
>;

/** The only credential payload shape accepted by the persistence boundary. */
export const EncryptedOAuthTokenEnvelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    keyVersion: RecordTextSchema,
    iv: InitializationVectorSchema,
    ciphertext: CiphertextSchema,
    authTag: AuthenticationTagSchema,
  })
  .strict();

export type EncryptedOAuthTokenEnvelope = z.infer<
  typeof EncryptedOAuthTokenEnvelopeSchema
>;

/** An opaque reference safe to associate with the account-owned grant. */
export const OAuthCredentialReferenceSchema = z
  .object({
    id: RecordTextSchema,
    provider: z.literal("youtube"),
    ownerId: RecordTextSchema,
    grantId: RecordTextSchema,
    storage: z.literal("encrypted"),
    keyVersion: RecordTextSchema,
    algorithm: z.literal("aes-256-gcm"),
  })
  .strict();

export type OAuthCredentialReference = z.infer<
  typeof OAuthCredentialReferenceSchema
>;

export type OAuthTokenEncryptor = Readonly<{
  encrypt(
    tokens: YouTubeOAuthTokenSet,
  ): Promise<unknown> | unknown;
}>;

export type OAuthCredentialStore = Readonly<{
  storeEncrypted(input: Readonly<{
    ownerId: string;
    grantId: string;
    envelope: EncryptedOAuthTokenEnvelope;
  }>): Promise<unknown>;
  remove(reference: OAuthCredentialReference): Promise<void>;
}>;

function encryptionKey(key: Uint8Array): Buffer {
  const value = Buffer.from(key);
  if (value.length !== 32) {
    throw new Error("OAuthEncryptionKeyInvalid");
  }
  return value;
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

/** Encrypt a transient provider token set before it crosses a storage seam. */
export function encryptYouTubeOAuthTokenSet(
  input: YouTubeOAuthTokenSet,
  options: Readonly<{
    key: Uint8Array;
    keyVersion: string;
    randomBytes?: (size: number) => Uint8Array;
  }>,
): EncryptedOAuthTokenEnvelope {
  const tokens = YouTubeOAuthTokenSetSchema.parse(input);
  const keyVersion = options.keyVersion.trim();
  if (!keyVersion || keyVersion.length > 240) {
    throw new Error("OAuthEncryptionKeyVersionInvalid");
  }

  const iv = Buffer.from(
    options.randomBytes?.(12) ?? randomBytes(12),
  );
  if (iv.length !== 12) throw new Error("OAuthEncryptionIvInvalid");

  const cipher = createCipheriv("aes-256-gcm", encryptionKey(options.key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return EncryptedOAuthTokenEnvelopeSchema.parse({
    version: 1,
    algorithm: "aes-256-gcm",
    keyVersion,
    iv: base64Url(iv),
    ciphertext: base64Url(ciphertext),
    authTag: base64Url(authTag),
  });
}

/** Decrypt only inside a server-side provider adapter immediately before use. */
export function decryptYouTubeOAuthTokenSet(
  input: EncryptedOAuthTokenEnvelope,
  options: Readonly<{ key: Uint8Array }>,
): YouTubeOAuthTokenSet {
  const envelope = EncryptedOAuthTokenEnvelopeSchema.parse(input);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(options.key),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return YouTubeOAuthTokenSetSchema.parse(JSON.parse(plaintext) as unknown);
}

/**
 * Resolve the production encryptor only from explicitly configured key
 * material. There is no development fallback, generated key, or plaintext
 * storage mode.
 */
export function createEnvironmentOAuthTokenEncryptor(): OAuthTokenEncryptor | null {
  const encodedKey = process.env.CHANNEL_OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  const keyVersion =
    process.env.CHANNEL_OAUTH_TOKEN_ENCRYPTION_KEY_VERSION?.trim();
  if (
    !encodedKey ||
    !keyVersion ||
    !/^[A-Za-z0-9_-]+$/u.test(encodedKey)
  ) {
    return null;
  }

  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32) return null;

  return {
    encrypt(tokens) {
      return encryptYouTubeOAuthTokenSet(tokens, { key, keyVersion });
    },
  };
}
