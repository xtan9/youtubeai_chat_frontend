import { describe, expect, it } from "vitest";
import {
  hasSmokeProEntitlement,
  isSmokeAccount,
  SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY,
  SMOKE_ACCOUNT_METADATA_KEY,
} from "../smoke-account";

describe("isSmokeAccount", () => {
  it("accepts the trusted boolean app metadata marker", () => {
    expect(
      isSmokeAccount({ app_metadata: { [SMOKE_ACCOUNT_METADATA_KEY]: true } }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    { app_metadata: {} },
    { app_metadata: { [SMOKE_ACCOUNT_METADATA_KEY]: false } },
    { app_metadata: { [SMOKE_ACCOUNT_METADATA_KEY]: "true" } },
  ])("rejects an untrusted or missing marker: %j", (user) => {
    expect(isSmokeAccount(user)).toBe(false);
  });

  it("ignores user-editable metadata when the trusted marker is present", () => {
    expect(
      isSmokeAccount({
        app_metadata: { [SMOKE_ACCOUNT_METADATA_KEY]: true },
        user_metadata: { [SMOKE_ACCOUNT_METADATA_KEY]: false },
      }),
    ).toBe(true);
  });
});

describe("hasSmokeProEntitlement", () => {
  it("requires both trusted Smoke Account and Pro entitlement markers", () => {
    expect(
      hasSmokeProEntitlement({
        app_metadata: {
          [SMOKE_ACCOUNT_METADATA_KEY]: true,
          [SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY]: "pro",
        },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    { app_metadata: { [SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY]: "pro" } },
    {
      app_metadata: {
        [SMOKE_ACCOUNT_METADATA_KEY]: true,
        [SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY]: "free",
      },
    },
    {
      app_metadata: { [SMOKE_ACCOUNT_METADATA_KEY]: true },
      user_metadata: { [SMOKE_ACCOUNT_ENTITLEMENT_METADATA_KEY]: "pro" },
    },
  ])("rejects incomplete or user-editable entitlement metadata: %j", (user) => {
    expect(hasSmokeProEntitlement(user)).toBe(false);
  });
});
