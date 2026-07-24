import { describe, expect, it } from "vitest";

import { assertBypassOnlyState } from "./preview-auth.setup";

const BASE_URL = "https://example.vercel.app";

function cookie(
  name: string,
  value = "cookie-value",
  overrides: Partial<ReturnType<typeof cookieShape>> = {},
) {
  return { ...cookieShape(name, value), ...overrides };
}

function cookieShape(name: string, value: string) {
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
  it.each(["__vercel_live_token", "_vercel_jwt"])(
    "accepts one isolated Vercel protection cookie without relying on its name (%s)",
    (name) => {
      expect(() =>
        assertBypassOnlyState({
          cookies: [cookie(name)],
          origins: [],
        }, BASE_URL),
      ).not.toThrow();
    },
  );

  it("rejects application auth cookies alongside the protection cookie", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [
          cookie("__vercel_live_token"),
          cookie("sb-project-auth-token", "session-value"),
        ],
        origins: [],
      }, BASE_URL),
    ).toThrow(/exactly one cookie and no application auth cookies/);
  });

  it("rejects multiple opaque cookies", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [
          cookie("__vercel_live_token"),
          cookie("unexpected-cookie"),
        ],
        origins: [],
      }, BASE_URL),
    ).toThrow(/exactly one cookie/);
  });

  it("rejects application origin storage", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [cookie("__vercel_live_token")],
        origins: [
          {
            origin: "https://example.vercel.app",
            localStorage: [{ name: "session", value: "session-value" }],
          },
        ],
      }, BASE_URL),
    ).toThrow(/must not contain application origin storage/);
  });

  it("rejects a missing protection cookie", () => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [],
        origins: [],
      }, BASE_URL),
    ).toThrow(/exactly one cookie/);
  });

  it.each([
    ["empty", { value: "" }],
    ["non-HTTP-only", { httpOnly: false }],
    ["insecure", { secure: false }],
    ["non-root path", { path: "/auth" }],
    ["foreign-domain", { domain: "attacker.example" }],
  ])("rejects a %s cookie", (_name, overrides) => {
    expect(() =>
      assertBypassOnlyState({
        cookies: [cookie("__vercel_live_token", "cookie-value", overrides)],
        origins: [],
      }, BASE_URL),
    ).toThrow(/must be non-empty, secure, HTTP-only, root-scoped/);
  });
});
