import { execFileSync } from "node:child_process";
import { lstat, open, rm } from "node:fs/promises";
import path from "node:path";
import { CHAT_GATEWAY_PROVIDER } from "@/lib/services/models";
import {
  runSemanticProfileEvaluation,
  verifySemanticProfileEvaluationFingerprint,
} from "./semantic-profile-evaluation-runner";

const LIVE_CALL_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_MAKES_56_GATEWAY_CALLS";

export function readSemanticProfileEvaluationCommandConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  if (
    env.SEMANTIC_PROFILE_EVALUATION_ACKNOWLEDGEMENT !==
    LIVE_CALL_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      "Semantic Profile evaluation requires explicit acknowledgement of 56 Gateway calls",
    );
  }
  requireEnvironmentValue(env, "LLM_GATEWAY_URL");
  requireEnvironmentValue(env, "LLM_GATEWAY_API_KEY");
  const modelIdentifier = requireEnvironmentValue(env, "LLM_MODEL");
  const sourceRevision = requireEnvironmentValue(
    env,
    "SEMANTIC_PROFILE_SOURCE_REVISION",
  );
  if (!/^[a-f0-9]{40,64}$/.test(sourceRevision)) {
    throw new Error("SEMANTIC_PROFILE_SOURCE_REVISION must be a full commit hash");
  }
  const outputPath = requireEnvironmentValue(
    env,
    "SEMANTIC_PROFILE_EVALUATION_OUTPUT",
  );
  if (!path.isAbsolute(outputPath) || path.extname(outputPath) !== ".json") {
    throw new Error(
      "SEMANTIC_PROFILE_EVALUATION_OUTPUT must be an absolute JSON path",
    );
  }

  return {
    modelIdentifier,
    gatewayProvider:
      env.SEMANTIC_PROFILE_GATEWAY_PROVIDER?.trim() || CHAT_GATEWAY_PROVIDER,
    sourceRevision,
    outputPath,
    pricing: {
      inputMicroUsdPerMillionTokens: readPrice(
        env,
        "SEMANTIC_PROFILE_INPUT_MICRO_USD_PER_MILLION_TOKENS",
      ),
      cachedInputMicroUsdPerMillionTokens: readPrice(
        env,
        "SEMANTIC_PROFILE_CACHED_INPUT_MICRO_USD_PER_MILLION_TOKENS",
      ),
      outputMicroUsdPerMillionTokens: readPrice(
        env,
        "SEMANTIC_PROFILE_OUTPUT_MICRO_USD_PER_MILLION_TOKENS",
      ),
    },
  } as const;
}

export async function executeSemanticProfileEvaluationCommand() {
  const config = readSemanticProfileEvaluationCommandConfig(process.env);
  const checkoutRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (config.sourceRevision !== checkoutRevision) {
    throw new Error(
      "SEMANTIC_PROFILE_SOURCE_REVISION must match the checkout HEAD",
    );
  }
  const trackedChanges = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
  if (trackedChanges !== "") {
    throw new Error(
      "Semantic Profile evaluation requires a clean tracked checkout",
    );
  }
  const evidenceFile = await open(config.outputPath, "wx", 0o600);
  const reservedEvidence = await evidenceFile.stat();
  let artifact: Awaited<ReturnType<typeof runSemanticProfileEvaluation>>;
  try {
    artifact = await (async () => {
      try {
        const generated = await runSemanticProfileEvaluation({
          modelIdentifier: config.modelIdentifier,
          gatewayProvider: config.gatewayProvider,
          sourceRevision: config.sourceRevision,
          evaluatedAt: new Date(),
          pricing: config.pricing,
        });
        if (!verifySemanticProfileEvaluationFingerprint(generated)) {
          throw new Error(
            "Semantic Profile evaluation fingerprint verification failed",
          );
        }
        await evidenceFile.writeFile(`${JSON.stringify(generated, null, 2)}\n`, {
          encoding: "utf8",
        });
        return generated;
      } finally {
        await evidenceFile.close();
      }
    })();
  } catch (error) {
    const currentEvidence = await lstat(config.outputPath).catch(() => null);
    if (
      currentEvidence?.dev === reservedEvidence.dev &&
      currentEvidence.ino === reservedEvidence.ino
    ) {
      await rm(config.outputPath, { force: true });
    }
    throw error;
  }
  return {
    outputPath: config.outputPath,
    evaluationFingerprint: artifact.evaluationFingerprint,
    requestCount: artifact.requestCount,
    automatedGate: artifact.automatedGate,
    activationPerformed: false,
    humanApprovalRequired: true,
  } as const;
}

function requireEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function readPrice(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number {
  const value = Number(requireEnvironmentValue(env, name));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative number`);
  }
  return value;
}
