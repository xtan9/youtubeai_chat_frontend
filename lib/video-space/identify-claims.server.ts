import "server-only";
import { createHash } from "node:crypto";
import type { Resource, Space } from "./contract";

// The same saved source passage gets the same link on every read, including
// digests created before individual claims had an identifier.
export function identifyClaims(
  resourceId: string,
  digest: NonNullable<Resource["digest"]>,
) {
  return {
    ...digest,
    claims: digest.claims.map((claim) => ({
      ...claim,
      id:
        "c-" +
        createHash("sha256")
          .update(
            JSON.stringify([
              resourceId,
              claim.location,
              claim.quote,
              claim.text,
            ]),
          )
          .digest("hex")
          .slice(0, 32),
    })),
  };
}

export function identifySpaceClaims(space: Space) {
  for (const resource of space.resources) {
    if (resource.digest) resource.digest = identifyClaims(resource.id, resource.digest);
  }
  return space;
}
