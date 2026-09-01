import { execFileSync } from "node:child_process";
import { lstat, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ChannelQualityVersionTupleSchema } from "./contracts";
import {
  evaluateChannelQualityRelease,
  verifyChannelQualityEvaluationFingerprint,
  type ChannelQualityEvaluationArtifact,
} from "./harness";

const InstantSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "invalid timestamp");

export type ChannelQualityEvaluationCommandConfig = Readonly<{
  developmentManifestPath: string;
  blindManifestPath: string;
  resultBundlePath: string;
  outputPath: string;
  sourceRevision: string;
  tupleSelectedAt: string;
  policyVersion: string;
  versions: Readonly<{
    modelVersion: string;
    promptVersion: string;
    taxonomyVersion: string;
    schemaVersion: string;
    validatorVersion: string;
  }>;
}>;

export function readChannelQualityEvaluationCommandConfig(
  env: Readonly<Record<string, string | undefined>>,
): ChannelQualityEvaluationCommandConfig {
  const versions = {
    modelVersion: requireEnvironmentValue(env, "CHANNEL_QUALITY_MODEL_VERSION"),
    promptVersion: requireEnvironmentValue(env, "CHANNEL_QUALITY_PROMPT_VERSION"),
    taxonomyVersion: requireEnvironmentValue(
      env,
      "CHANNEL_QUALITY_TAXONOMY_VERSION",
    ),
    schemaVersion: requireEnvironmentValue(env, "CHANNEL_QUALITY_SCHEMA_VERSION"),
    validatorVersion: requireEnvironmentValue(
      env,
      "CHANNEL_QUALITY_VALIDATOR_VERSION",
    ),
  };
  if (!ChannelQualityVersionTupleSchema.safeParse(versions).success) {
    throw new Error(
      "Channel quality evaluation requires concrete model, prompt, taxonomy, schema, and validator versions",
    );
  }

  const sourceRevision = requireEnvironmentValue(
    env,
    "CHANNEL_QUALITY_SOURCE_REVISION",
  );
  if (!/^[a-f0-9]{40,64}$/.test(sourceRevision)) {
    throw new Error(
      "CHANNEL_QUALITY_SOURCE_REVISION must be a full commit hash",
    );
  }
  const policyVersion = requireConcreteEnvironmentValue(
    env,
    "CHANNEL_QUALITY_POLICY_VERSION",
  );
  const tupleSelectedAt = requireInstantEnvironmentValue(
    env,
    "CHANNEL_QUALITY_TUPLE_SELECTED_AT",
  );
  return {
    developmentManifestPath: requireJsonPath(
      env,
      "CHANNEL_QUALITY_DEVELOPMENT_MANIFEST",
    ),
    blindManifestPath: requireJsonPath(
      env,
      "CHANNEL_QUALITY_BLIND_MANIFEST",
    ),
    resultBundlePath: requireJsonPath(env, "CHANNEL_QUALITY_RESULTS"),
    outputPath: requireJsonPath(env, "CHANNEL_QUALITY_OUTPUT"),
    sourceRevision,
    tupleSelectedAt,
    policyVersion,
    versions,
  };
}

export async function executeChannelQualityEvaluationCommand(): Promise<Readonly<{
  outputPath: string;
  outcome: "passed" | "failed";
  evaluationFingerprint: string;
  gate: ChannelQualityEvaluationArtifact["gate"];
}>> {
  const config = readChannelQualityEvaluationCommandConfig(process.env);
  const checkoutRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (config.sourceRevision !== checkoutRevision) {
    throw new Error(
      "CHANNEL_QUALITY_SOURCE_REVISION must match the checkout HEAD",
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
      "Channel quality evaluation requires a clean tracked checkout",
    );
  }

  const evidenceFile = await open(config.outputPath, "wx", 0o600);
  const reservedEvidence = await evidenceFile.stat();
  try {
    const [developmentCorpus, blindCorpus, results] = await Promise.all([
      readJsonFile(config.developmentManifestPath, "development manifest"),
      readJsonFile(config.blindManifestPath, "blind manifest"),
      readJsonFile(config.resultBundlePath, "results"),
    ]);
    const artifact = evaluateChannelQualityRelease({
      developmentCorpus,
      blindCorpus,
      results,
      versions: config.versions,
      policyVersion: config.policyVersion,
      tupleSelectedAt: config.tupleSelectedAt,
      sourceRevision: config.sourceRevision,
      evaluatedAt: new Date().toISOString(),
    });
    if (!verifyChannelQualityEvaluationFingerprint(artifact)) {
      throw new Error(
        "Channel quality evaluation fingerprint verification failed",
      );
    }
    await evidenceFile.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: "utf8",
    });
    return {
      outputPath: config.outputPath,
      outcome: artifact.outcome,
      evaluationFingerprint: artifact.evaluationFingerprint,
      gate: artifact.gate,
    };
  } catch (error) {
    const currentEvidence = await lstat(config.outputPath).catch(() => null);
    if (
      currentEvidence?.dev === reservedEvidence.dev &&
      currentEvidence.ino === reservedEvidence.ino
    ) {
      await rm(config.outputPath, { force: true });
    }
    throw error;
  } finally {
    await evidenceFile.close();
  }
}

function requireInstantEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = requireEnvironmentValue(env, name);
  if (!InstantSchema.safeParse(value).success) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return value;
}

async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read`, { cause: error });
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(`${label} JSON is malformed`, { cause: error });
  }
}

function requireJsonPath(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = requireEnvironmentValue(env, name);
  if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== ".json") {
    throw new Error(`${name} must be an absolute JSON path`);
  }
  return value;
}

function requireEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function requireConcreteEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = requireEnvironmentValue(env, name);
  if (
    ["latest", "current", "unknown", "unversioned", "pending", "todo"].includes(
      value.toLowerCase(),
    )
  ) {
    throw new Error(`${name} must be a concrete version`);
  }
  return value;
}
