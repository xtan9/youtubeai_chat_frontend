import { z } from "zod";

import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import {
  authorizeChannelAccountAction,
  channelEntitlementFromState,
  type ChannelAccountAction,
} from "@/lib/channel-exposure/eligibility";
import { loadChannelAccessSnapshot } from "@/lib/channel-exposure/server";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { resolveRegisteredSubscription } from "@/lib/services/entitlements";
import { createClient } from "@/lib/supabase/server";

import {
  channelReleaseBlockedResponse,
  CHANNEL_NO_STORE_HEADERS,
} from "../release-response";

const AccountActionSchema = z.object({
  action: z.enum([
    "connect",
    "manage_permissions",
    "revoke",
    "disconnect",
    "export_data",
    "delete_data",
  ]),
});

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: CHANNEL_NO_STORE_HEADERS,
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
      { outcome: "invalid_request", message: "Account control details must be valid JSON." },
      400,
    );
  }
  const parsed = AccountActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(
      { outcome: "invalid_request", message: "Choose a valid Channel account control." },
      400,
    );
  }

  const principalResult = await resolveRequestPrincipal({
    source: "channel_account",
  });
  if (principalResult.kind === "unavailable") {
    return json(
      { outcome: "unavailable", message: "Account controls are temporarily unavailable." },
      503,
    );
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return json(
      { outcome: "authenticated_identity_required", message: "Sign in to manage Channel." },
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
      { outcome: "unavailable", message: "Account controls are temporarily unavailable." },
      503,
    );
  }

  const action = parsed.data.action as ChannelAccountAction;
  const decision = authorizeChannelAccountAction({
    action,
    launchGate,
    access: accessResult.snapshot.access,
  });
  if (!decision.allowed) {
    return json(
      {
        outcome: "not_authorized",
        reason: decision.reason,
        message: "Account ownership and Channel authority were revalidated.",
      },
      403,
    );
  }

  if (action === "manage_permissions") {
    return json(
      {
        outcome: "accepted",
        action,
        permissionsUrl: "https://myaccount.google.com/permissions",
      },
      200,
    );
  }

  // These controls are deliberately an explicit adapter seam. The repository
  // does not invent provider credentials or claim that a cleanup worker has
  // completed. Revoke means this account's Channel grant only, never global
  // OAuth/session revocation.
  return json(
    {
      outcome: "not_configured",
      action: decision.action,
      scope: "account_owned_channel_grant",
      message:
        "This account control is not configured in the repository; no external or destructive action was made.",
    },
    503,
  );
}
