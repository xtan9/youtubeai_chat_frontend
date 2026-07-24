import { describe, expect, it } from "vitest";

import { assertBypassOnlyState } from "./preview-auth.setup";

function cookie(name: string, value = "cookie-value") {
  return {
    name,
    value,
    domain: "example.vercel.app",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };
}

describe("preview bypass-only storage state", () => {
  it("accepts one non-empty Vercel bypass cookie and no origin storage", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [cookie("__vercel_bypass")],
        origins: [],
      }),
    ).not.toThrow();
  });

  it("rejects application auth cookies", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [
          cookie("__vercel_bypass"),
          cookie("sb-project-auth-token", "session-value"),
        ],
        origins: [],
      }),
    ).toThrow(/no application auth cookies/);
  });

  it("rejects application origin storage", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [cookie("__vercel_bypass")],
        origins: [
          {
            origin: "https://example.vercel.app",
            localStorage: [{ name: "session", value: "session-value" }],
          },
        ],
      }),
    ).toThrow(/must not contain application origin storage/);
  });

  it.each([
    ["missing", []],
    ["empty", [cookie("__vercel_bypass", "")]],
  ])("rejects a %s bypass cookie", (_name, cookies) => {
    expect(() =>
      assertBypassOnlyState({
        cookies,
        origins: [],
      }),
    ).toThrow(/exactly one Vercel bypass cookie/);
  });
});
