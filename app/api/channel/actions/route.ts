import { z } from "zod";

import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import {
  authorizeChannelHubAction,
  channelEntitlementFromState,
} from "@/lib/channel-exposure/eligibility";
import { loadChannelAccessSnapshot } from "@/lib/channel-exposure/server";
import type { HubAction } from "@/lib/channel-hub/contract";
import {
  publicScanRun,
  startResponse,
} from "@/lib/channel-scans/http";
import {
  cancelChannelScanRun,
  failChannelScanScheduling,
  getChannelScanRun,
  startChannelScanRun,
} from "@/lib/channel-scans/service";
import { scanRunIdSchema } from "@/lib/channel-scans";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { resolveRegisteredSubscription } from "@/lib/services/entitlements";
import { createClient } from "@/lib/supabase/server";

import { channelReleaseBlockedResponse } from "../release-response";
import { scheduleWorker } from "../scans/schedule";

const HubActionSchema = z.object({
  action: z.enum([
    "upgrade",
    "connect",
    "continue_onboarding",
    "start_scan",
    "cancel_scan",
    "open_review",
    "dismiss",
    "defer",
    "mark_allowed_criticism",
    "confirm_actionable_abuse",
    "request_draft",
    "edit_draft",
    "publish",
    "retry_publication",
    "recheck_publication",
    "continue_safety_guidance",
    "open_on_youtube",
    "delete_published_reply",
    "disconnect",
    "export_data",
    "delete_data",
  ]),
  subjectId: z.string().trim().min(1).max(240).nullable().optional(),
});

function json(
  body: Record<string, unknown>,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function startRealChannelScan(input: Readonly<{
  accountId: string;
  connectedChannelId: string;
}>): Promise<Response> {
  let result: Awaited<ReturnType<typeof startChannelScanRun>>;
  try {
    result = await startChannelScanRun({
      accountId: input.accountId,
      connectedChannelId: input.connectedChannelId,
      provider: "youtube",
    });
  } catch {
    return json(
      { outcome: "unavailable", message: "Channel scans are temporarily unavailable." },
      503,
    );
  }
  if (result.kind !== "started") return withNoStore(startResponse(result));

  if (!scheduleWorker(result.run.id)) {
    try {
      await failChannelScanScheduling({
        accountId: input.accountId,
        runId: result.run.id,
      });
    } catch {
      // Keep the durable run for reconciliation when scheduling is unavailable.
    }
    return json(
      { outcome: "unavailable", message: "Channel scans are temporarily unavailable." },
      503,
    );
  }
  return withNoStore(startResponse(result));
}

async function cancelRealChannelScan(input: Readonly<{
  accountId: string;
  connectedChannelId: string;
  subjectId: string | null | undefined;
}>): Promise<Response> {
  const parsedRunId = scanRunIdSchema.safeParse(input.subjectId);
  if (!parsedRunId.success) {
    return json(
      { outcome: "invalid_request", message: "A valid Scan Run is required." },
      400,
    );
  }

  let previous: Awaited<ReturnType<typeof getChannelScanRun>>;
  try {
    previous = await getChannelScanRun(parsedRunId.data, input.accountId);
  } catch {
    return json(
      { outcome: "unavailable", message: "Channel scans are temporarily unavailable." },
      503,
    );
  }
  if (!previous) {
    return json({ outcome: "not_found", message: "Scan Run not found." }, 404);
  }
  if (previous.connectedChannelId !== input.connectedChannelId) {
    return json(
      {
        outcome: "not_authorized",
        reason: "connected_channel_identity_mismatch",
        message: "The Scan Run is not bound to the active Channel.",
      },
      403,
    );
  }

  try {
    const run = await cancelChannelScanRun({
      accountId: input.accountId,
      runId: parsedRunId.data,
    });
    if (!run) {
      return json({ outcome: "not_found", message: "Scan Run not found." }, 404);
    }
    const isCancelled = run.outcome === "cancelled";
    return json(
      {
        outcome: isCancelled ? "cancelled" : "cancellation_requested",
        run: publicScanRun(run),
      },
      isCancelled ? 200 : 202,
    );
  } catch {
    return json(
      { outcome: "unavailable", message: "Channel scans are temporarily unavailable." },
      503,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status !== "open") {
    return channelReleaseBlockedResponse(launchGate);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json(
      { outcome: "invalid_request", message: "Channel action details must be valid JSON." },
      400,
    );
  }
  const parsed = HubActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(
      { outcome: "invalid_request", message: "Choose a valid Channel action." },
      400,
    );
  }

  const principalResult = await resolveRequestPrincipal({
    source: "channel_action",
  });
  if (principalResult.kind === "unavailable") {
    return json(
      { outcome: "unavailable", message: "Channel authorization is temporarily unavailable." },
      503,
    );
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return json(
      { outcome: "authenticated_identity_required", message: "Sign in to use Channel." },
      401,
    );
  }

  const subscription = await resolveRegisteredSubscription(
    principalResult.principal.userId,
    principalResult.principal.smokeProEntitled === true,
  );
  if (subscription.kind === "unavailable") {
    return json(
      { outcome: "unavailable", message: "Channel entitlement is temporarily unavailable." },
      503,
    );
  }

  const supabase = await createClient();
  const accessResult = await loadChannelAccessSnapshot({
    supabase,
    userId: principalResult.principal.userId,
    entitlement: channelEntitlementFromState(subscription.presentation.state),
  });
  if (accessResult.kind === "unavailable") {
    return json(
      { outcome: "unavailable", message: "Channel authorization is temporarily unavailable." },
      503,
    );
  }

  const action = parsed.data.action as HubAction;
  const decision = authorizeChannelHubAction({
    action,
    launchGate,
    access: accessResult.snapshot.access,
  });
  if (!decision.allowed) {
    return json(
      {
        outcome: "not_authorized",
        reason: decision.reason,
        message: "Channel authority was revalidated and this action is not available.",
      },
      403,
    );
  }

  const connectedChannelId =
    accessResult.snapshot.access.connectedChannel?.connectedChannelId;
  if (action === "start_scan") {
    if (!connectedChannelId) {
      return json(
        {
          outcome: "not_authorized",
          reason: "connected_channel_identity_required",
          message: "Connect a verified Channel before starting a Scan Run.",
        },
        403,
      );
    }
    return startRealChannelScan({
      accountId: principalResult.principal.userId,
      connectedChannelId,
    });
  }

  if (action === "cancel_scan") {
    if (!connectedChannelId) {
      return json(
        {
          outcome: "not_authorized",
          reason: "connected_channel_identity_required",
          message: "Connect a verified Channel before cancelling a Scan Run.",
        },
        403,
      );
    }
    return cancelRealChannelScan({
      accountId: principalResult.principal.userId,
      connectedChannelId,
      subjectId: parsed.data.subjectId,
    });
  }

  // The action boundary is intentionally present before the provider adapter.
  // No external call is made until a later release supplies the reviewed
  // adapter and production evidence through this already-gated seam.
  return json(
    {
      outcome: "not_configured",
      action: decision.action,
      subjectId: parsed.data.subjectId ?? null,
      message:
        "Channel action handling is not configured in this repository; no external action was made.",
    },
    503,
  );
}
