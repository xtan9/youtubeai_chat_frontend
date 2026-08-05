import { describe, expect, it } from "vitest";
import { isSmokeAccount, SMOKE_ACCOUNT_METADATA_KEY } from "../smoke-account";

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
