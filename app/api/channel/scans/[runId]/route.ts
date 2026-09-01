import { scanRunIdSchema } from "@/lib/channel-scans";
import { getChannelScanRun } from "@/lib/channel-scans/service";
import {
  activeScanRun,
  authError,
  publicScanRun,
  registeredPrincipal,
} from "@/lib/channel-scans/http";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { channelReleaseBlockedResponse } from "../../release-response";
import { scheduleWorker } from "../schedule";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status !== "open") {
    return channelReleaseBlockedResponse(launchGate);
  }

  const { runId: rawRunId } = await context.params;
  const parsedRunId = scanRunIdSchema.safeParse(rawRunId);
  if (!parsedRunId.success) {
    return authError(400, "The Scan Run identifier is invalid.");
  }

  const authenticated = await registeredPrincipal();
  if (authenticated.response) return authenticated.response;

  try {
    const run = await getChannelScanRun(
      parsedRunId.data,
      authenticated.principal.userId,
    );
    if (!run) return authError(404, "Scan Run not found.");
    if (activeScanRun(run)) scheduleWorker(run.id);
    return Response.json({ run: publicScanRun(run) });
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
}
