import { describe, expect, it } from "vitest";
import {
  PROJECT_BETA_ACCESS_METADATA_KEY,
  resolveProjectAvailability,
} from "../project-availability";

describe("resolveProjectAvailability", () => {
  it.each([
    ["internal", "internal"],
    ["invited", "invited"],
  ] as const)("accepts the trusted %s beta cohort", (marker, expected) => {
    expect(
      resolveProjectAvailability({
        app_metadata: { [PROJECT_BETA_ACCESS_METADATA_KEY]: marker },
      }),
    ).toBe(expected);
  });

  it("treats a marked Smoke Account as an internal fixture", () => {
    expect(
      resolveProjectAvailability({
        app_metadata: { is_smoke_account: true },
      }),
    ).toBe("internal");
  });

  it.each([
    undefined,
    null,
    {},
    { app_metadata: {} },
    { app_metadata: { [PROJECT_BETA_ACCESS_METADATA_KEY]: "ga" } },
    { app_metadata: { [PROJECT_BETA_ACCESS_METADATA_KEY]: true } },
    {
      app_metadata: {},
      user_metadata: { [PROJECT_BETA_ACCESS_METADATA_KEY]: "invited" },
    },
    {
      app_metadata: { is_smoke_account: false },
      user_metadata: { is_smoke_account: true },
    },
  ])("keeps untrusted or unmarked Researchers unavailable", (user) => {
    expect(resolveProjectAvailability(user)).toBe("unavailable");
  });
});
