import "server-only";

import {
  resolveRequestPrincipal,
  type RequestPrincipal,
} from "@/lib/auth/request-principal";
import { getUserTier } from "@/lib/services/entitlements";
import {
  scanRunIdSchema,
  serializeScanRun,
  type PublicScanRun,
  type ScanRun,
  type ScanRunStartResult,
} from "./contracts";

export const ONBOARDING_MESSAGE =
  "Connect a verified YouTube Channel before starting a scan.";
export const PRO_MESSAGE = "Channel scans require an active Pro plan.";

export function authError(
  status: number,
  message: string,
  outcome = "error",
): Response {
  return Response.json({ outcome, message }, { status });
}

export type RegisteredPrincipalResult =
  | { readonly response: Response; readonly principal?: never }
  | { readonly response?: never; readonly principal: RequestPrincipal };

export async function registeredPrincipal(): Promise<RegisteredPrincipalResult> {
  const result = await resolveRequestPrincipal({ source: "channel_scan" });
  if (result.kind === "unavailable") {
    return { response: authError(503, "Authentication is temporarily unavailable.") };
  }
  if (result.kind === "missing" || result.principal.isAnonymous) {
    return { response: authError(401, "Sign in to use Channel scans.") };
  }
  return { principal: result.principal };
}

export async function hasProEntitlement(input: {
  userId: string;
  smokeProEntitled?: boolean;
}): Promise<Response | null> {
  try {
    const tier = await getUserTier(input.userId, input.smokeProEntitled === true);
    return tier === "pro"
      ? null
      : authError(402, PRO_MESSAGE, "upgrade_required");
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
}

export function activeScanRun(run: ScanRun): boolean {
  return run.status === "queued" || run.status === "running";
}

export function publicScanRun(run: ScanRun): PublicScanRun {
  return serializeScanRun(run);
}

export function parseRunId(value: string): string | Response {
  const parsed = scanRunIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : authError(400, "The Scan Run identifier is invalid.");
}

export function startResponse(result: ScanRunStartResult): Response {
  switch (result.kind) {
    case "started":
      return Response.json(
        { outcome: "started", run: publicScanRun(result.run) },
        { status: 202 },
      );
    case "concurrent":
      return Response.json(
        { outcome: "concurrent", run: publicScanRun(result.run) },
        { status: 409 },
      );
    case "rate_limited":
      return Response.json(
        { outcome: "rate_limited", retryAt: result.retryAt },
        { status: 429 },
      );
    case "retry_unavailable":
      return authError(409, "This Scan Run is not available for retry.");
    case "invalid":
      return authError(400, "The bounded synthetic scan request is invalid.");
  }
}
