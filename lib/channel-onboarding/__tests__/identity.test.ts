import { describe, expect, it } from "vitest";

import { resolveSupportedCreatorChannel } from "../identity";

const IDENTITY = {
  provider: "youtube" as const,
  providerSubject: "google-subject-1",
  providerChannelId: "UC_verified",
  displayName: "Verified creator channel",
  mine: true as const,
};

describe("resolveSupportedCreatorChannel", () => {
  it("accepts exactly one provider-verified creator identity", () => {
    expect(resolveSupportedCreatorChannel([IDENTITY])).toEqual({
      kind: "verified",
      identity: IDENTITY,
    });
  });

  it("rejects zero provider identities without inventing a local identity", () => {
    expect(resolveSupportedCreatorChannel([])).toEqual({
      kind: "rejected",
      reason: "no_provider_identity",
    });
  });

  it("rejects multiple identities instead of choosing the first result", () => {
    expect(
      resolveSupportedCreatorChannel([
        IDENTITY,
        { ...IDENTITY, providerChannelId: "UC_other" },
      ]),
    ).toEqual({
      kind: "rejected",
      reason: "multiple_provider_identities",
    });
  });

  it("treats duplicate results as ambiguous rather than silently deduplicating", () => {
    expect(resolveSupportedCreatorChannel([IDENTITY, IDENTITY])).toEqual({
      kind: "rejected",
      reason: "multiple_provider_identities",
    });
  });

  it("rejects malformed or non-owned provider results", () => {
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, providerChannelId: "" },
      ]),
    ).toEqual({ kind: "rejected", reason: "invalid_provider_identity" });
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, mine: false },
      ]),
    ).toEqual({ kind: "rejected", reason: "unverified_provider_identity" });
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, provider: "other" },
      ]),
    ).toEqual({ kind: "rejected", reason: "invalid_provider_identity" });
  });

  it("rejects a non-array provider response", () => {
    expect(resolveSupportedCreatorChannel(null)).toEqual({
      kind: "rejected",
      reason: "invalid_provider_identity",
    });
  });
});
