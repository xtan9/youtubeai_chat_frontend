import { z } from "zod";

const ProviderTextSchema = z.string().trim().min(1).max(240);

/**
 * The normalized result produced by a provider adapter after it has queried
 * the provider's owned-channel identity endpoint. `mine` is retained in the
 * contract so callers cannot replace provider evidence with a locally chosen
 * channel ID.
 */
export const ProviderChannelIdentitySchema = z
  .object({
    provider: z.literal("youtube"),
    providerSubject: ProviderTextSchema,
    providerChannelId: ProviderTextSchema,
    displayName: ProviderTextSchema,
    mine: z.literal(true),
  })
  .strict();

const RawProviderChannelIdentitySchema = z
  .object({
    provider: z.literal("youtube"),
    providerSubject: ProviderTextSchema,
    providerChannelId: ProviderTextSchema,
    displayName: ProviderTextSchema,
    mine: z.boolean(),
  })
  .strict();

export type ProviderChannelIdentity = z.infer<
  typeof ProviderChannelIdentitySchema
>;

export type ProviderIdentityResolution =
  | Readonly<{
      kind: "verified";
      identity: ProviderChannelIdentity;
    }>
  | Readonly<{
      kind: "rejected";
      reason:
        | "no_provider_identity"
        | "multiple_provider_identities"
        | "invalid_provider_identity"
        | "unverified_provider_identity";
    }>;

/**
 * Resolve a provider response to one supported creator identity.
 *
 * Zero results, malformed results, a non-owned result, and every response
 * containing more than one result are rejected. In particular, this function
 * never accepts a local selection as a substitute for provider identity
 * evidence.
 */
export function resolveSupportedCreatorChannel(
  response: unknown,
): ProviderIdentityResolution {
  if (!Array.isArray(response)) {
    return { kind: "rejected", reason: "invalid_provider_identity" };
  }

  if (response.length === 0) {
    return { kind: "rejected", reason: "no_provider_identity" };
  }

  // Do this before parsing or sorting so a malformed second result can never
  // cause the first result to be selected as the write identity.
  if (response.length !== 1) {
    return { kind: "rejected", reason: "multiple_provider_identities" };
  }

  const rawResult = RawProviderChannelIdentitySchema.safeParse(response[0]);
  if (!rawResult.success) {
    return { kind: "rejected", reason: "invalid_provider_identity" };
  }
  if (rawResult.data.mine !== true) {
    return { kind: "rejected", reason: "unverified_provider_identity" };
  }

  const verifiedResult = ProviderChannelIdentitySchema.safeParse(
    rawResult.data,
  );
  if (!verifiedResult.success) {
    return { kind: "rejected", reason: "invalid_provider_identity" };
  }

  return { kind: "verified", identity: verifiedResult.data };
}
