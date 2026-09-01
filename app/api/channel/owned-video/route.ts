import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { loadOwnedVideoForUrl } from "@/lib/channel-exposure/server";
import { evaluateChannelLaunchGate } from "@/lib/compliance/channel-launch";
import { createClient } from "@/lib/supabase/server";

import {
  channelReleaseBlockedResponse,
  CHANNEL_NO_STORE_HEADERS,
} from "../release-response";

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: CHANNEL_NO_STORE_HEADERS,
  });
}

export async function GET(request: Request): Promise<Response> {
  const launchGate = evaluateChannelLaunchGate();
  if (launchGate.status !== "open") {
    return channelReleaseBlockedResponse(launchGate);
  }

  const principalResult = await resolveRequestPrincipal({
    source: "channel_video",
  });
  if (principalResult.kind === "unavailable") {
    return json(
      { outcome: "unavailable", message: "Video ownership is temporarily unavailable." },
      503,
    );
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return json(
      { outcome: "authenticated_identity_required", message: "Sign in to open an owned Video in Channel." },
      401,
    );
  }

  const youtubeUrl = new URL(request.url).searchParams.get("url")?.trim();
  if (!youtubeUrl || youtubeUrl.length > 2_000) {
    return json(
      { outcome: "not_owned", message: "This Video is not available in your History." },
      404,
    );
  }

  const supabase = await createClient();
  const result = await loadOwnedVideoForUrl({
    supabase,
    userId: principalResult.principal.userId,
    youtubeUrl,
  });
  if (result.kind === "unavailable") {
    return json(
      { outcome: "unavailable", message: "Video ownership is temporarily unavailable." },
      503,
    );
  }
  if (result.kind === "not_owned") {
    return json(
      { outcome: "not_owned", message: "This Video is not available in your History." },
      404,
    );
  }
  return json(
    {
      outcome: "owned",
      videoId: result.internalVideoId,
      providerVideoId: result.providerVideoId,
    },
    200,
  );
}
