import { readFile } from "node:fs/promises";
import path from "node:path";

import { deepFreeze } from "./contracts";
import {
  evaluateChannelLaunchPacket,
  type ChannelLaunchPacketEvaluation,
} from "./validator";

export const CHANNEL_LAUNCH_PACKET_DEFAULT_INPUT_PATH =
  "docs/compliance/channel-production-launch-packet.json";

export type ChannelLaunchPacketFileEvaluation =
  ChannelLaunchPacketEvaluation & {
    packetPath: string;
  };

export async function verifyChannelLaunchPacketFile(
  inputPath = CHANNEL_LAUNCH_PACKET_DEFAULT_INPUT_PATH,
): Promise<ChannelLaunchPacketFileEvaluation> {
  const packetPath = path.resolve(inputPath);

  try {
    const input = JSON.parse(await readFile(packetPath, "utf8")) as unknown;
    return deepFreeze({
      ...evaluateChannelLaunchPacket(input),
      packetPath,
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "unknown read error";
    return deepFreeze({
      status: "blocked",
      decision: "blocked",
      releaseReviewEligible: false,
      packet: null,
      failures: [
        {
          code: "packet_input_unavailable",
          path: packetPath,
          detail,
        },
      ],
      packetPath,
    });
  }
}
