import {
  scanStartRequestSchema,
  type ScanRunStartResult,
} from "@/lib/channel-scans";
import {
  isRealScanChannelId,
  isSupportedScanChannelId,
  isSyntheticScanChannelId,
} from "@/lib/channel-scans/channel-target";
import {
  failChannelScanScheduling,
  listChannelScanRuns,
  startChannelScanRun,
} from "@/lib/channel-scans/service";
import {
  ONBOARDING_MESSAGE,
  activeScanRun,
  authError,
  hasProEntitlement,
  publicScanRun,
  registeredPrincipal,
  startResponse,
} from "@/lib/channel-scans/http";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { channelReleaseBlockedResponse } from "../release-response";
import { scheduleWorker } from "./schedule";

export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status !== "open") {
    return channelReleaseBlockedResponse(launchGate);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return authError(400, "Scan details must be valid JSON.");
  }
  const parsed = scanStartRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return authError(400, "Choose a valid Connected Channel.");
  }
  if (parsed.data.provider === "synthetic" && parsed.data.videoId !== null) {
    return authError(400, "Video scans require the real YouTube provider.");
  }
  const validTarget =
    parsed.data.provider === "synthetic"
      ? isSyntheticScanChannelId(parsed.data.connectedChannelId)
      : isRealScanChannelId(parsed.data.connectedChannelId);
  if (!validTarget) {
    return Response.json(
      { outcome: "onboarding_required", message: ONBOARDING_MESSAGE },
      { status: 409 },
    );
  }

  const authenticated = await registeredPrincipal();
  if (authenticated.response) return authenticated.response;
  const principal = authenticated.principal;
  const entitlementError = await hasProEntitlement({
    userId: principal.userId,
    smokeProEntitled: principal.smokeProEntitled,
  });
  if (entitlementError) return entitlementError;

  let result: ScanRunStartResult;
  try {
    result = await startChannelScanRun({
      accountId: principal.userId,
      connectedChannelId: parsed.data.connectedChannelId,
      retryOf: parsed.data.retryOf,
      ...(parsed.data.provider === "youtube"
        ? {
            provider: parsed.data.provider,
            ...(parsed.data.videoId === null
              ? {}
              : { videoId: parsed.data.videoId }),
          }
        : {}),
    });
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
  if (result.kind !== "started") return startResponse(result);

  if (!scheduleWorker(result.run.id)) {
    try {
      await failChannelScanScheduling({
        accountId: principal.userId,
        runId: result.run.id,
      });
    } catch {
      // Keep the durable record for reconciliation even when the scheduling
      // failure transition itself is unavailable.
    }
    return authError(503, "Channel scans are temporarily unavailable.");
  }
  return startResponse(result);
}

export async function GET(request: Request): Promise<Response> {
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status !== "open") {
    return channelReleaseBlockedResponse(launchGate);
  }

  const authenticated = await registeredPrincipal();
  if (authenticated.response) return authenticated.response;
  const principal = authenticated.principal;
  const connectedChannelId = new URL(request.url).searchParams.get(
    "connectedChannelId",
  );
  if (
    connectedChannelId &&
    !isSupportedScanChannelId(connectedChannelId)
  ) {
    return Response.json(
      { outcome: "onboarding_required", message: ONBOARDING_MESSAGE },
      { status: 409 },
    );
  }

  try {
    const runs = await listChannelScanRuns(
      principal.userId,
      connectedChannelId ?? undefined,
    );
    for (const run of runs) {
      if (activeScanRun(run)) scheduleWorker(run.id);
    }
    return Response.json({ runs: runs.map(publicScanRun) });
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
}
