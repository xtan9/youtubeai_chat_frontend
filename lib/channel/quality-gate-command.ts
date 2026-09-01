import { readFile } from "node:fs/promises";

import {
  buildChannelQualityGateInputErrorReport,
  buildMissingChannelQualityGateReport,
  evaluateChannelQualityGate,
} from "./quality-gate";
import type { ChannelQualityGateReport } from "./quality-gate";

export const CHANNEL_QUALITY_GATE_INPUT_PATH =
  "docs/channel-evaluation/channel-quality-gate-input.json" as const;

type ReadQualityGateFile = (inputPath: string) => Promise<string>;

export type ChannelQualityGateCommandOptions = Readonly<{
  inputPath?: string;
  readFile?: ReadQualityGateFile;
}>;

/**
 * Evaluate a checked-in or operator-supplied offline artifact. This command
 * intentionally has no provider, network, credential, or production code
 * activation seam.
 */
export async function executeChannelQualityGateCommand(
  options: ChannelQualityGateCommandOptions = {},
): Promise<ChannelQualityGateReport> {
  const inputPath = options.inputPath?.trim() || CHANNEL_QUALITY_GATE_INPUT_PATH;
  const read = options.readFile ?? ((filePath) => readFile(filePath, "utf8"));
  let contents: string;
  try {
    contents = await read(inputPath);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return buildMissingChannelQualityGateReport(inputPath);
    }
    return buildChannelQualityGateInputErrorReport(
      "quality_gate_input_unreadable",
      `Frozen quality-gate input could not be read from ${inputPath}.`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(contents) as unknown;
  } catch {
    return buildChannelQualityGateInputErrorReport(
      "quality_gate_input_json_invalid",
      `Frozen quality-gate input at ${inputPath} is not valid JSON.`,
    );
  }
  return evaluateChannelQualityGate(input);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
