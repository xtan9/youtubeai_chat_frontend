import {
  evaluateYouTubeChannelOAuthVerificationGate,
  CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
} from "@/lib/compliance/youtube-channel-oauth-verification";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Inert release-boundary callback. Query parameters are deliberately ignored:
 * an authorization code must never be echoed, logged, or exchanged until the
 * external verification gate and a credentialed provider adapter are both
 * explicitly enabled by a later release.
 */
export function GET(request: Request): Response {
  void request;
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
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  return Response.json(
    {
      outcome: "blocked",
      reason: "oauth_callback_not_configured",
      message:
        "OAuth callback handling is not configured in this repository; no provider exchange was made.",
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}
