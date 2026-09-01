import type { ChannelLaunchGate } from "@/lib/compliance/channel-launch";

export const CHANNEL_NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export function channelReleaseBlockedResponse(
  gate: ChannelLaunchGate,
): Response {
  return Response.json(
    {
      outcome: "blocked",
      reason: "channel_release_required",
      blockedGates:
        gate.status === "blocked" ? gate.blockedGates : ["launch_packet"],
      message:
        "Channel is not available until the complete, externally evidenced launch packet is verified.",
    },
    { status: 503, headers: CHANNEL_NO_STORE_HEADERS },
  );
}
