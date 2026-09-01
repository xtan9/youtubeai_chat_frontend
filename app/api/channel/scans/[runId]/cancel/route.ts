import { scanRunIdSchema } from "@/lib/channel-scans";
import { cancelChannelScanRun } from "@/lib/channel-scans/service";
import {
  authError,
  publicScanRun,
  registeredPrincipal,
} from "@/lib/channel-scans/http";

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

  try {
    const run = await cancelChannelScanRun({
      accountId: authenticated.principal.userId,
      runId: parsedRunId.data,
    });
    if (!run) return authError(404, "Scan Run not found.");
    const isCancelled = run.outcome === "cancelled";
    return Response.json(
      {
        outcome: isCancelled ? "cancelled" : "cancellation_requested",
        run: publicScanRun(run),
      },
      { status: isCancelled ? 200 : 202 },
    );
  } catch {
    return authError(503, "Channel scans are temporarily unavailable.");
  }
}
