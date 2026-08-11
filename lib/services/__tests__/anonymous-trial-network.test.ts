import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveAnonymousTrialNetworkKey } from "../anonymous-trial-network";

describe("Anonymous Trial trusted network key", () => {
  const secret = "a-required-server-secret-with-enough-entropy";

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
