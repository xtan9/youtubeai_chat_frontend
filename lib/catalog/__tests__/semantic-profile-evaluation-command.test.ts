import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runSemanticProfileEvaluation } = vi.hoisted(() => ({
  runSemanticProfileEvaluation: vi.fn(),
}));

vi.mock("../semantic-profile-evaluation-runner", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../semantic-profile-evaluation-runner")
  >()),
  runSemanticProfileEvaluation,
}));

import {
  executeSemanticProfileEvaluationCommand,
  readSemanticProfileEvaluationCommandConfig,
} from "../semantic-profile-evaluation-command";

const OUTPUT_PATH = path.resolve("private-artifacts", "semantic-profile.json");

function environment(): Record<string, string> {
  return {
    LLM_GATEWAY_URL: "https://gateway.example.com/v1",
    LLM_GATEWAY_API_KEY: "gateway-key",
    LLM_MODEL: "configured-gateway-model",
    SEMANTIC_PROFILE_SOURCE_REVISION:
      "9b09883f41cb2ae3c6dfde192f227963c0bd54a1",
    SEMANTIC_PROFILE_EVALUATION_OUTPUT: OUTPUT_PATH,
    SEMANTIC_PROFILE_INPUT_MICRO_USD_PER_MILLION_TOKENS: "1000000",
    SEMANTIC_PROFILE_CACHED_INPUT_MICRO_USD_PER_MILLION_TOKENS: "500000",
    SEMANTIC_PROFILE_OUTPUT_MICRO_USD_PER_MILLION_TOKENS: "2000000",
    SEMANTIC_PROFILE_EVALUATION_ACKNOWLEDGEMENT:
      "I_UNDERSTAND_THIS_MAKES_56_GATEWAY_CALLS",
  };
}

describe("readSemanticProfileEvaluationCommandConfig", () => {
  it("requires an explicit 56-call acknowledgement before exposing live configuration", () => {
    const env = environment();
    delete env.SEMANTIC_PROFILE_EVALUATION_ACKNOWLEDGEMENT;

    expect(() => readSemanticProfileEvaluationCommandConfig(env)).toThrow(
      /56 Gateway calls/,
    );
  });

  it("uses only the configured backend Gateway and explicit pricing", () => {
    expect(readSemanticProfileEvaluationCommandConfig(environment())).toEqual({
      modelIdentifier: "configured-gateway-model",
      gatewayProvider: "cliproxyapi",
      sourceRevision: "9b09883f41cb2ae3c6dfde192f227963c0bd54a1",
      outputPath: OUTPUT_PATH,
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });
  });
});

describe("executeSemanticProfileEvaluationCommand", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    runSemanticProfileEvaluation.mockReset();
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("reserves the create-only evidence path before making a Gateway call", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "semantic-profile-evaluation-"),
    );
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "evidence.json");
    await writeFile(outputPath, "existing evidence", "utf8");
    const env = environment();
    env.SEMANTIC_PROFILE_EVALUATION_OUTPUT = outputPath;
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    await expect(executeSemanticProfileEvaluationCommand()).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(runSemanticProfileEvaluation).not.toHaveBeenCalled();
  });
});
