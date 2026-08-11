import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

type NetworkKeyResult =
  | { readonly outcome: "ready"; readonly networkKeyHash: string }
  | { readonly outcome: "unavailable" };

function ipv4Prefix(address: string): string {
  const octets = address.split(".");
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

function expandIpv6(address: string): number[] | null {
  const convertDottedSuffix = (parts: string[]): string[] | null => {
    const last = parts.at(-1);
    if (!last?.includes(".")) return parts;
    if (isIP(last) !== 4) return null;
    const octets = last.split(".").map(Number);
    return [
      ...parts.slice(0, -1),
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ];
  };

  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = convertDottedSuffix(halves[0] ? halves[0].split(":") : []);
  const right = convertDottedSuffix(halves[1] ? halves[1].split(":") : []);
  if (!left || !right) return null;
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return null;
  const parts = [...left, ...Array(omitted).fill("0"), ...right];
  if (parts.length !== 8) return null;
  const values = parts.map((part) => Number.parseInt(part || "0", 16));
  return values.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? values
    : null;
}

function networkPrefix(address: string): string | null {
  const version = isIP(address);
  if (version === 4) return ipv4Prefix(address);
  if (version !== 6) return null;
  const parts = expandIpv6(address);
  if (!parts) return null;
  if (
    parts.slice(0, 5).every((part) => part === 0) &&
    parts[5] === 0xffff
  ) {
    const mappedIpv4 = [
      parts[6] >> 8,
      parts[6] & 0xff,
      parts[7] >> 8,
      parts[7] & 0xff,
    ].join(".");
    return ipv4Prefix(mappedIpv4);
  }
  return `${parts.slice(0, 4).map((part) => part.toString(16)).join(":")}::/64`;
}

export function deriveAnonymousTrialNetworkKey(input: {
  readonly trustedClientIp: string | undefined;
  readonly hmacSecret: string | undefined;
}): NetworkKeyResult {
  const address = input.trustedClientIp?.trim();
  const secret = input.hmacSecret?.trim();
  if (!address || address.includes(",") || !secret || secret.length < 32) {
    return { outcome: "unavailable" };
  }
  const prefix = networkPrefix(address);
  if (!prefix) return { outcome: "unavailable" };
  return {
    outcome: "ready",
    networkKeyHash: createHmac("sha256", secret).update(prefix).digest("hex"),
  };
}

export type AnonymousTrialAdmissionContext = {
  readonly networkKeyHash: string;
  readonly globalSpendLimitMicros: number;
  readonly reservationCostMicros: number;
};

export type AnonymousTrialAdmissionContextResult =
  | {
      readonly outcome: "ready";
      readonly context: AnonymousTrialAdmissionContext;
    }
  | { readonly outcome: "global_shutdown" }
  | { readonly outcome: "unavailable" };

export function resolveAnonymousTrialAdmissionContext(
  request: Request,
): AnonymousTrialAdmissionContextResult {
  const killSwitch = process.env.ANONYMOUS_TRIAL_KILL_SWITCH?.trim();
  if (killSwitch === "true") return { outcome: "global_shutdown" };
  if (killSwitch !== "false") return { outcome: "unavailable" };
  const network = deriveAnonymousTrialNetworkKey({
    trustedClientIp: request.headers.get("x-forwarded-for") ?? undefined,
    hmacSecret: process.env.ANONYMOUS_TRIAL_NETWORK_HMAC_SECRET,
  });
  const spendLimit = Number(
    process.env.ANONYMOUS_TRIAL_GLOBAL_24H_SPEND_LIMIT_MICROS,
  );
  const reservationCost = Number(
    process.env.ANONYMOUS_TRIAL_RESERVATION_COST_MICROS,
  );
  if (
    network.outcome !== "ready" ||
    !Number.isSafeInteger(spendLimit) ||
    spendLimit <= 0 ||
    !Number.isSafeInteger(reservationCost) ||
    reservationCost <= 0 ||
    reservationCost > spendLimit
  ) {
    return { outcome: "unavailable" };
  }
  return {
    outcome: "ready",
    context: {
      networkKeyHash: network.networkKeyHash,
      globalSpendLimitMicros: spendLimit,
      reservationCostMicros: reservationCost,
    },
  };
}
