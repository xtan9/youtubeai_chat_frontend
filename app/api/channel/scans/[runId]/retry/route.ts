import { scanRunIdSchema } from "@/lib/channel-scans";
import {
  isRealScanChannelId,
  isSyntheticScanChannelId,
} from "@/lib/channel-scans/channel-target";
import {
  failChannelScanScheduling,
  getChannelScanRun,
  retryChannelScanRun,
} from "@/lib/channel-scans/service";
import {
  ONBOARDING_MESSAGE,
  authError,
  hasProEntitlement,
  registeredPrincipal,
  startResponse,
} from "@/lib/channel-scans/http";
import { scheduleWorker } from "../../schedule";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ runId: string }> };

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { runId: rawRunId } = await context.params;
  const parsedRunId = scanRunIdSchema.safeParse(rawRunId);
  if (!parsedRunId.success) {
    return authError(400, "The Scan Run identifier is invalid.");
  }

  const authenticated = await registeredPrincipal();
  if (authenticated.response) return authenticated.response;
  const principal = authenticated.principal;
  const entitlementError = await hasProEntitlement({
    userId: principal.userId,
    smokeProEntitled: principal.smokeProEntitled,
  });
  if (entitlementError) return entitlementError;

  let previous: Awaited<ReturnType<typeof getChannelScanRun>>;
  try {
    previous = await getChannelScanRun(parsedRunId.data, principal.userId);
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
  if (!previous) return authError(404, "Scan Run not found.");
  const validTarget =
    previous.provider === "synthetic"
      ? isSyntheticScanChannelId(previous.connectedChannelId)
      : isRealScanChannelId(previous.connectedChannelId);
  if (!validTarget) {
    return Response.json(
      { outcome: "onboarding_required", message: ONBOARDING_MESSAGE },
      { status: 409 },
    );
  }

  let result: Awaited<ReturnType<typeof retryChannelScanRun>>;
  try {
    result = await retryChannelScanRun({
      accountId: principal.userId,
      runId: parsedRunId.data,
    });
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
  if (result.kind === "missing") return authError(404, "Scan Run not found.");
  if (result.kind !== "started") return startResponse(result);

  if (!scheduleWorker(result.run.id)) {
    try {
      await failChannelScanScheduling({
        accountId: principal.userId,
        runId: result.run.id,
      });
    } catch {
      // Keep the durable record for reconciliation if the transition is down.
    }
    return authError(503, "Channel scans are temporarily unavailable.");
  }
  return startResponse(result);
}
