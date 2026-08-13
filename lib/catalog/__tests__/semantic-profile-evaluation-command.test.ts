import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  runSemanticProfileEvaluation,
  verifySemanticProfileEvaluationFingerprint,
} = vi.hoisted(() => ({
  runSemanticProfileEvaluation: vi.fn(),
  verifySemanticProfileEvaluationFingerprint: vi.fn(() => true),
}));

vi.mock("../semantic-profile-evaluation-runner", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../semantic-profile-evaluation-runner")
  >()),
  runSemanticProfileEvaluation,
  verifySemanticProfileEvaluationFingerprint,
}));

import {
  executeSemanticProfileEvaluationCommand,
  readSemanticProfileEvaluationCommandConfig,
} from "../semantic-profile-evaluation-command";

const OUTPUT_PATH = path.resolve("private-artifacts", "semantic-profile.json");
const ORIGINAL_WORKING_DIRECTORY = process.cwd();
const CHECKOUT_REVISION = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

function environment(): Record<string, string> {
  return {
    LLM_GATEWAY_URL: "https://gateway.example.com/v1",
    LLM_GATEWAY_API_KEY: "gateway-key",
    LLM_MODEL: "configured-gateway-model",
    SEMANTIC_PROFILE_SOURCE_REVISION: CHECKOUT_REVISION,
    SEMANTIC_PROFILE_EVALUATION_OUTPUT: OUTPUT_PATH,
    SEMANTIC_PROFILE_INPUT_MICRO_USD_PER_MILLION_TOKENS: "1000000",
    SEMANTIC_PROFILE_CACHED_INPUT_MICRO_USD_PER_MILLION_TOKENS: "500000",
    SEMANTIC_PROFILE_OUTPUT_MICRO_USD_PER_MILLION_TOKENS: "2000000",
    SEMANTIC_PROFILE_EVALUATION_ACKNOWLEDGEMENT:
      "I_UNDERSTAND_THIS_MAKES_56_GATEWAY_CALLS",
  };
}

async function createCommittedFixture(directory: string): Promise<{
  readonly revision: string;
  readonly trackedPath: string;
}> {
  execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "Semantic Profile Test"], {
    cwd: directory,
  });
  const trackedPath = path.join(directory, "semantic-profile.ts");
  await writeFile(trackedPath, "committed\n", "utf8");
  execFileSync("git", ["add", "semantic-profile.ts"], { cwd: directory });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: directory,
    stdio: "ignore",
  });
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim(),
    trackedPath,
  };
}

async function configureCommittedCommandFixture(
  temporaryDirectories: string[],
): Promise<{ readonly directory: string; readonly outputPath: string }> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "semantic-profile-evaluation-"),
  );
  temporaryDirectories.push(directory);
  const { revision } = await createCommittedFixture(directory);
  const outputPath = path.join(directory, "evidence.json");
  const env = environment();
  env.SEMANTIC_PROFILE_SOURCE_REVISION = revision;
  env.SEMANTIC_PROFILE_EVALUATION_OUTPUT = outputPath;
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  process.chdir(directory);
  return { directory, outputPath };
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
    const env = environment();
    expect(readSemanticProfileEvaluationCommandConfig(env)).toEqual({
      modelIdentifier: "configured-gateway-model",
      gatewayProvider: "cliproxyapi",
      sourceRevision: env.SEMANTIC_PROFILE_SOURCE_REVISION,
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
    process.chdir(ORIGINAL_WORKING_DIRECTORY);
    runSemanticProfileEvaluation.mockReset();
    verifySemanticProfileEvaluationFingerprint.mockReset();
    verifySemanticProfileEvaluationFingerprint.mockReturnValue(true);
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
    const { revision } = await createCommittedFixture(directory);
    const outputPath = path.join(directory, "evidence.json");
    await writeFile(outputPath, "existing evidence", "utf8");
    const env = environment();
    env.SEMANTIC_PROFILE_SOURCE_REVISION = revision;
    env.SEMANTIC_PROFILE_EVALUATION_OUTPUT = outputPath;
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    process.chdir(directory);

    await expect(executeSemanticProfileEvaluationCommand()).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(runSemanticProfileEvaluation).not.toHaveBeenCalled();
  });

  it("rejects a source revision mismatch before reserving evidence or making a Gateway call", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "semantic-profile-evaluation-"),
    );
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "evidence.json");
    const env = environment();
    env.SEMANTIC_PROFILE_SOURCE_REVISION = "0".repeat(40);
    env.SEMANTIC_PROFILE_EVALUATION_OUTPUT = outputPath;
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    await expect(executeSemanticProfileEvaluationCommand()).rejects.toThrow(
      /must match the checkout HEAD/,
    );
    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(runSemanticProfileEvaluation).not.toHaveBeenCalled();
  });

  it("rejects tracked checkout changes before reserving evidence or making a Gateway call", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "semantic-profile-evaluation-"),
    );
    temporaryDirectories.push(directory);
    const { revision, trackedPath } = await createCommittedFixture(directory);
    await writeFile(trackedPath, "modified\n", "utf8");
    const outputPath = path.join(directory, "evidence.json");
    const env = environment();
    env.SEMANTIC_PROFILE_SOURCE_REVISION = revision;
    env.SEMANTIC_PROFILE_EVALUATION_OUTPUT = outputPath;
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    process.chdir(directory);

    await expect(executeSemanticProfileEvaluationCommand()).rejects.toThrow(
      /clean tracked checkout/,
    );
    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(runSemanticProfileEvaluation).not.toHaveBeenCalled();
  });

  it("allows untracked files that cannot change the committed evaluation source", async () => {
    const { directory } = await configureCommittedCommandFixture(
      temporaryDirectories,
    );
    await writeFile(path.join(directory, "operator-notes.txt"), "untracked\n");
    runSemanticProfileEvaluation.mockResolvedValue({
      evaluationFingerprint: "a".repeat(64),
      requestCount: 56,
      automatedGate: { outcome: "passed", failedGates: [] },
    });

    await expect(executeSemanticProfileEvaluationCommand()).resolves.toEqual(
      expect.objectContaining({ requestCount: 56 }),
    );
    expect(runSemanticProfileEvaluation).toHaveBeenCalledOnce();
  });

  it("refuses to persist evidence whose fingerprint does not verify", async () => {
    const { outputPath } = await configureCommittedCommandFixture(
      temporaryDirectories,
    );
    runSemanticProfileEvaluation.mockResolvedValue({
      evaluationFingerprint: "a".repeat(64),
      requestCount: 56,
      automatedGate: { outcome: "passed", failedGates: [] },
    });
    verifySemanticProfileEvaluationFingerprint.mockReturnValue(false);

    await expect(executeSemanticProfileEvaluationCommand()).rejects.toThrow(
      /fingerprint verification failed/,
    );
    expect(verifySemanticProfileEvaluationFingerprint).toHaveBeenCalledOnce();
    await expect(stat(outputPath)).resolves.toMatchObject({ size: 0 });
  });
});
