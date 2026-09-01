import { z } from "zod";

import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { authorizeChannelHubAction } from "@/lib/channel-exposure/eligibility";
import {
  channelEntitlementFromState,
} from "@/lib/channel-exposure/eligibility";
import { loadChannelAccessSnapshot } from "@/lib/channel-exposure/server";
import type { HubAction } from "@/lib/channel-hub/contract";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { resolveRegisteredSubscription } from "@/lib/services/entitlements";
import { createClient } from "@/lib/supabase/server";

import { channelReleaseBlockedResponse } from "../release-response";

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
