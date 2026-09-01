import {
  verifyChannelLaunchPacketFile,
  CHANNEL_LAUNCH_PACKET_DEFAULT_INPUT_PATH,
} from "../lib/channel-launch";

async function main(): Promise<void> {
  const result = await verifyChannelLaunchPacketFile(
    process.env.CHANNEL_LAUNCH_PACKET_INPUT ??
      CHANNEL_LAUNCH_PACKET_DEFAULT_INPUT_PATH,
  );
  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
  if (result.status === "blocked") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`Channel launch packet verification failed: ${detail}`);
  process.exitCode = 1;
});
