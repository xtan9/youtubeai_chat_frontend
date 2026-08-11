import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deriveAnonymousTrialNetworkKey,
  resolveTrustedAnonymousTrialClientIp,
} from "../anonymous-trial-network";

describe("Anonymous Trial trusted network key", () => {
  const secret = "a-required-server-secret-with-enough-entropy";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the platform-controlled Vercel client IP adapter", () => {
    vi.stubEnv("ANONYMOUS_TRIAL_TRUSTED_IP_ADAPTER", "vercel");
    vi.stubEnv("VERCEL", "1");

    expect(
      resolveTrustedAnonymousTrialClientIp(
        new Request("https://example.test", {
          headers: {
            "x-forwarded-for": "198.51.100.8",
            "x-vercel-forwarded-for": "203.0.113.42",
            "x-vercel-id": "sfo1::abcde-12345",
          },
        }),
      ),
    ).toEqual({ outcome: "ready", clientIp: "203.0.113.42" });
  });

  it.each([
    ["no trusted adapter", undefined, "1", "203.0.113.42", "sfo1::abcde"],
    ["not running on Vercel", "vercel", undefined, "203.0.113.42", "sfo1::abcde"],
    ["missing platform provenance", "vercel", "1", "203.0.113.42", undefined],
    [
      "chained platform value",
      "vercel",
      "1",
      "203.0.113.42, 198.51.100.8",
      "sfo1::abcde",
    ],
  ])(
    "fails closed for %s even when a client supplies x-forwarded-for",
    (_label, adapter, vercel, platformIp, vercelId) => {
      vi.stubEnv("ANONYMOUS_TRIAL_TRUSTED_IP_ADAPTER", adapter);
      vi.stubEnv("VERCEL", vercel);
      expect(
        resolveTrustedAnonymousTrialClientIp(
          new Request("https://example.test", {
            headers: {
              "x-forwarded-for": "192.0.2.44",
              ...(platformIp
                ? { "x-vercel-forwarded-for": platformIp }
                : {}),
              ...(vercelId ? { "x-vercel-id": vercelId } : {}),
            },
          }),
        ),
      ).toEqual({ outcome: "unavailable" });
    },
  );

  it.each([
    ["203.0.113.42", "203.0.113.0/24"],
    ["::ffff:203.0.113.42", "203.0.113.0/24"],
    ["::ffff:cb00:712a", "203.0.113.0/24"],
    ["2001:db8:abcd:1234:1111:2222:3333:4444", "2001:db8:abcd:1234::/64"],
  ])("normalizes %s and returns only its HMAC", (address, prefix) => {
    const expected = createHmac("sha256", secret).update(prefix).digest("hex");

    expect(
      deriveAnonymousTrialNetworkKey({
        trustedClientIp: address,
        hmacSecret: secret,
      }),
    ).toEqual({ outcome: "ready", networkKeyHash: expected });
  });

  it.each([
    [undefined, secret],
    ["203.0.113.42", undefined],
    ["203.0.113.42, 198.51.100.9", secret],
    ["not-an-ip", secret],
  ])("fails closed for a missing or untrusted dependency", (address, key) => {
    expect(
      deriveAnonymousTrialNetworkKey({
        trustedClientIp: address,
        hmacSecret: key,
      }),
    ).toEqual({ outcome: "unavailable" });
  });
});
