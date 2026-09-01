import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createChannelQualityCorpusItem,
  createChannelQualityEvaluationResult,
  createChannelQualityResultBundle,
  freezeChannelQualityCorpus,
} from "../index";
import {
  executeChannelQualityEvaluationCommand,
  readChannelQualityEvaluationCommandConfig,
} from "../command";

const POLICY_VERSION = "youtube-community-guidelines-2026-08-31";
const SOURCE_REVISION = "b".repeat(40);
const VERSIONS = {
  modelVersion: "fixture-model-v1",
  promptVersion: "fixture-prompt-v1",
  taxonomyVersion: "fixture-taxonomy-v1",
  schemaVersion: "fixture-schema-v1",
  validatorVersion: "fixture-validator-v1",
};

const REVIEWERS = {
  protocol: "two_independent_reviewers_third_resolves_disagreement" as const,
  reviewers: [
    {
      id: "reviewer-primary",
      role: "primary" as const,
      reviewedAt: "2026-08-31T12:00:00.000Z",
    },
    {
      id: "reviewer-secondary",
      role: "secondary" as const,
      reviewedAt: "2026-08-31T12:01:00.000Z",
    },
    {
      id: "reviewer-adjudicator",
      role: "adjudicator" as const,
      reviewedAt: "2026-08-31T12:02:00.000Z",
    },
  ],
};

const ORIGINAL_WORKING_DIRECTORY = process.cwd();
const temporaryDirectories: string[] = [];
const CONFIG_ENVIRONMENT_NAMES = Object.keys(environment());
const ORIGINAL_CONFIG_ENVIRONMENT = Object.fromEntries(
  CONFIG_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]),
);

function environment(): Record<string, string> {
  return {
    CHANNEL_QUALITY_DEVELOPMENT_MANIFEST: "",
    CHANNEL_QUALITY_BLIND_MANIFEST: "",
    CHANNEL_QUALITY_RESULTS: "",
    CHANNEL_QUALITY_OUTPUT: "",
    CHANNEL_QUALITY_SOURCE_REVISION: SOURCE_REVISION,
    CHANNEL_QUALITY_TUPLE_SELECTED_AT: "2026-08-31T12:30:00.000Z",
    CHANNEL_QUALITY_POLICY_VERSION: POLICY_VERSION,
    CHANNEL_QUALITY_MODEL_VERSION: VERSIONS.modelVersion,
    CHANNEL_QUALITY_PROMPT_VERSION: VERSIONS.promptVersion,
    CHANNEL_QUALITY_TAXONOMY_VERSION: VERSIONS.taxonomyVersion,
    CHANNEL_QUALITY_SCHEMA_VERSION: VERSIONS.schemaVersion,
    CHANNEL_QUALITY_VALIDATOR_VERSION: VERSIONS.validatorVersion,
  };
}

function createCorpus(split: "development" | "blind", id: string) {
  const item = createChannelQualityCorpusItem({
    id,
    kind: "classification",
    language: "english",
    expectedClassification: "allowed_criticism",
    expectedValidatorCategory: null,
    crossCuts: [],
    input: {
      commentText: `A governed ${split} input`,
      videoTitle: "A governed video",
    },
    codeSwitchEvidence: null,
  });
  return freezeChannelQualityCorpus({
    manifestVersion: "channel-quality-corpus-manifest-v1",
    corpusVersion: "channel-comment-assistance-v1",
    split,
    frozenAt: "2026-08-31T12:00:00.000Z",
    policyVersion: POLICY_VERSION,
    dataGovernance: "synthetic",
    reviewers: REVIEWERS,
    items: [item],
  });
}

async function createCommittedFixture(): Promise<{
  directory: string;
  developmentPath: string;
  blindPath: string;
  resultsPath: string;
  outputPath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "channel-quality-"));
  temporaryDirectories.push(directory);
  execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "Channel Quality Test"], {
    cwd: directory,
  });
  await writeFile(path.join(directory, "source.txt"), "committed\n", "utf8");
  execFileSync("git", ["add", "source.txt"], { cwd: directory });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: directory,
    stdio: "ignore",
  });

  const development = createCorpus("development", "development-item");
  const blind = createCorpus("blind", "blind-item");
  const result = createChannelQualityEvaluationResult({
    itemId: "blind-item",
    status: "complete",
    assessment: { classification: "allowed_criticism", schemaValid: true },
    draft: {
      generated: false,
      created: false,
      validatorRan: false,
      accepted: false,
      zeroToleranceFailures: [],
      otherFailure: false,
    },
  });
  const bundle = createChannelQualityResultBundle({
    corpusManifestHash: blind.manifestHash,
    results: [result],
  });
  const developmentPath = path.join(directory, "development.json");
  const blindPath = path.join(directory, "blind.json");
  const resultsPath = path.join(directory, "results.json");
  const outputPath = path.join(directory, "evidence.json");
  await writeFile(developmentPath, `${JSON.stringify(development)}\n`, "utf8");
  await writeFile(blindPath, `${JSON.stringify(blind)}\n`, "utf8");
  await writeFile(resultsPath, `${JSON.stringify(bundle)}\n`, "utf8");
  return { directory, developmentPath, blindPath, resultsPath, outputPath };
}

describe("Channel quality evaluation command", () => {
  afterEach(async () => {
    process.chdir(ORIGINAL_WORKING_DIRECTORY);
    for (const name of CONFIG_ENVIRONMENT_NAMES) {
      const originalValue = ORIGINAL_CONFIG_ENVIRONMENT[name];
      if (originalValue === undefined) delete process.env[name];
      else process.env[name] = originalValue;
    }
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("requires both frozen corpus paths and the exact version tuple", () => {
    const env = environment();
    const paths = {
      blind: path.resolve("blind.json"),
      results: path.resolve("results.json"),
      output: path.resolve("evidence.json"),
      development: path.resolve("development.json"),
    };
    env.CHANNEL_QUALITY_BLIND_MANIFEST = paths.blind;
    env.CHANNEL_QUALITY_RESULTS = paths.results;
    env.CHANNEL_QUALITY_OUTPUT = paths.output;
    expect(() => readChannelQualityEvaluationCommandConfig(env)).toThrow(
      /CHANNEL_QUALITY_DEVELOPMENT_MANIFEST must be configured/,
    );

    env.CHANNEL_QUALITY_DEVELOPMENT_MANIFEST = paths.development;
    expect(readChannelQualityEvaluationCommandConfig(env)).toMatchObject({
      developmentManifestPath: paths.development,
      blindManifestPath: paths.blind,
      resultBundlePath: paths.results,
      outputPath: paths.output,
      versions: VERSIONS,
    });
  });

  it("writes a reproducible failure artifact for an incomplete release corpus", async () => {
    const fixture = await createCommittedFixture();
    const env = environment();
    env.CHANNEL_QUALITY_DEVELOPMENT_MANIFEST = fixture.developmentPath;
    env.CHANNEL_QUALITY_BLIND_MANIFEST = fixture.blindPath;
    env.CHANNEL_QUALITY_RESULTS = fixture.resultsPath;
    env.CHANNEL_QUALITY_OUTPUT = fixture.outputPath;
    env.CHANNEL_QUALITY_SOURCE_REVISION = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: fixture.directory, encoding: "utf8" },
    ).trim();
    for (const [name, value] of Object.entries(env)) {
      process.env[name] = value;
    }
    process.chdir(fixture.directory);

    const summary = await executeChannelQualityEvaluationCommand();
    expect(summary.outcome).toBe("failed");
    expect(summary.outputPath).toBe(fixture.outputPath);
    const evidence = JSON.parse(await readFile(fixture.outputPath, "utf8"));
    expect(evidence.outcome).toBe("failed");
    expect(evidence.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "minimum_sample_count" }),
      ]),
    );
  });

  it("does not overwrite existing evidence or evaluate when the path is reserved", async () => {
    const fixture = await createCommittedFixture();
    await writeFile(fixture.outputPath, "existing evidence\n", "utf8");
    const env = environment();
    env.CHANNEL_QUALITY_DEVELOPMENT_MANIFEST = fixture.developmentPath;
    env.CHANNEL_QUALITY_BLIND_MANIFEST = fixture.blindPath;
    env.CHANNEL_QUALITY_RESULTS = fixture.resultsPath;
    env.CHANNEL_QUALITY_OUTPUT = fixture.outputPath;
    env.CHANNEL_QUALITY_SOURCE_REVISION = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: fixture.directory, encoding: "utf8" },
    ).trim();
    for (const [name, value] of Object.entries(env)) {
      process.env[name] = value;
    }
    process.chdir(fixture.directory);

    await expect(executeChannelQualityEvaluationCommand()).rejects.toMatchObject(
      { code: "EEXIST" },
    );
    expect(await readFile(fixture.outputPath, "utf8")).toBe(
      "existing evidence\n",
    );
    await expect(stat(fixture.outputPath)).resolves.toBeDefined();
  });

  it("fails before reserving output when an input file is malformed", async () => {
    const fixture = await createCommittedFixture();
    await writeFile(fixture.resultsPath, "not json\n", "utf8");
    const env = environment();
    env.CHANNEL_QUALITY_DEVELOPMENT_MANIFEST = fixture.developmentPath;
    env.CHANNEL_QUALITY_BLIND_MANIFEST = fixture.blindPath;
    env.CHANNEL_QUALITY_RESULTS = fixture.resultsPath;
    env.CHANNEL_QUALITY_OUTPUT = fixture.outputPath;
    env.CHANNEL_QUALITY_SOURCE_REVISION = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: fixture.directory, encoding: "utf8" },
    ).trim();
    for (const [name, value] of Object.entries(env)) {
      process.env[name] = value;
    }
    process.chdir(fixture.directory);

    await expect(executeChannelQualityEvaluationCommand()).rejects.toThrow(
      /results JSON is malformed/,
    );
    await expect(stat(fixture.outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
