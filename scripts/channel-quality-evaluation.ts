import {
  executeChannelQualityEvaluationCommand,
} from "../lib/channel-quality-evaluation/command";

async function main(): Promise<void> {
  const summary = await executeChannelQualityEvaluationCommand();
  console.log(JSON.stringify(summary, null, 2));
  if (summary.outcome === "failed") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Channel quality evaluation failed: ${message}`);
  process.exitCode = 1;
});
