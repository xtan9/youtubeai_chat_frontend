import { describe, expect, it } from "vitest";

import { resolveSupportedCreatorChannel } from "../identity";

const IDENTITY = {
  provider: "youtube" as const,
  providerSubject: "google-subject-1",
  providerChannelId: "UC_verified",
  displayName: "Verified creator channel",
  mine: true as const,
  ownership: "account_owned" as const,
  authorization: "direct_owner" as const,
  visibility: "public" as const,
  persona: "creator" as const,
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

  it("rejects multi-host and delegated identities with native YouTube guidance", () => {
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, ownership: "multi_host_organization" },
      ]),
    ).toEqual({
      kind: "rejected",
      reason: "multi_host_organization_not_supported",
      guidance:
        "This Channel type is not supported here; use native YouTube tools for multi-host organizations or delegated Studio permissions.",
    });
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, authorization: "delegated_studio" },
      ]),
    ).toEqual({
      kind: "rejected",
      reason: "delegated_studio_not_supported",
      guidance:
        "This Channel type is not supported here; use native YouTube tools for multi-host organizations or delegated Studio permissions.",
    });
  });

  it("requires a public creator persona rather than inferring one from a Channel ID", () => {
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, visibility: "not_public" },
      ]),
    ).toEqual({
      kind: "rejected",
      reason: "not_public_creator_persona",
    });
    expect(
      resolveSupportedCreatorChannel([
        { ...IDENTITY, persona: "other" },
      ]),
    ).toEqual({
      kind: "rejected",
      reason: "not_public_creator_persona",
    });
  });
});
