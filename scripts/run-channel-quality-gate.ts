import { executeChannelQualityGateCommand } from "../lib/channel/quality-gate-command";

const inputPath = process.argv[2];

void (async () => {
  const report = await executeChannelQualityGateCommand({ inputPath });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.decision !== "passed") process.exitCode = 2;
})();
