import { after } from "next/server";
import { logAppEvent } from "@/lib/observability";
import { runChannelScanRun } from "@/lib/channel-scans/service";

/**
 * Schedule durable work after the browser response. The callback deliberately
 * has no notification side effect; a later status read can reclaim work if a
 * deployment interrupts this invocation.
 */
export function scheduleWorker(runId: string): boolean {
  try {
    after(async () => {
      try {
        await runChannelScanRun(runId);
      } catch {
        logAppEvent("error", "CHANNEL_SCAN_WORKER_FAILED", {
          errorId: "CHANNEL_SCAN_WORKER_FAILED",
        });
      }
    });
    return true;
  } catch {
    return false;
  }
}
