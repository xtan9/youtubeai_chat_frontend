import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";

import {
  channelReleaseBlockedResponse,
  CHANNEL_NO_STORE_HEADERS,
} from "../../release-response";

/**
 * The callback deliberately does not read or echo query parameters until the
 * full launch packet is open. A later provider adapter must validate state,
 * authenticated ownership, scopes, and consent before exchanging a code.
 */
export async function GET(request: Request): Promise<Response> {
  void request;
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status !== "open") {
    return channelReleaseBlockedResponse(launchGate);
  }

  const principalResult = await resolveRequestPrincipal({
    source: "channel_account",
  });
  if (principalResult.kind === "unavailable") {
    return Response.json(
      {
        outcome: "unavailable",
        message: "Channel authorization is temporarily unavailable.",
      },
      { status: 503, headers: CHANNEL_NO_STORE_HEADERS },
    );
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return Response.json(
      {
        outcome: "authenticated_identity_required",
        message: "Sign in to complete Channel connection.",
      },
      { status: 401, headers: CHANNEL_NO_STORE_HEADERS },
    );
  }

  return Response.json(
    {
      outcome: "not_configured",
      message:
        "OAuth callback handling is not configured in this repository; no provider exchange was made.",
    },
    { status: 503, headers: CHANNEL_NO_STORE_HEADERS },
  );
}
