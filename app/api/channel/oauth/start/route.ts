import {
  evaluateYouTubeChannelOAuthVerificationGate,
  CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
} from "@/lib/compliance/youtube-channel-oauth-verification";

/**
 * Inert release-boundary route. A future implementation may construct a
 * provider authorization request only after the checked-in verification gate
 * is open and an authorized maintainer has supplied external configuration.
 * This route intentionally never creates a URL, reads credentials, or calls
 * Google.
 */
export function POST(): Response {
  const gate = evaluateYouTubeChannelOAuthVerificationGate(
    CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
  );
  if (gate.status === "blocked") {
    return Response.json(
      {
        outcome: "blocked",
        reason: "oauth_verification_required",
        message: gate.reason,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      outcome: "blocked",
      reason: "oauth_start_not_configured",
      message:
        "OAuth initiation is not configured in this repository; no provider request was made.",
    },
    { status: 503 },
  );
}
