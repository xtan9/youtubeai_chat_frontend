import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ChineseEnglishCodeSwitchBlindCorpusApprovalEvidenceSchema,
  ChineseEnglishCodeSwitchBlindCorpusManifestDescriptorSchema,
  createChineseEnglishCodeSwitchBlindEvaluationCorpus,
  validateChineseEnglishCodeSwitchBlindEvaluationCorpus,
} from "../lib/channel/code-switch-blind-corpus-governance";

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH =
  "docs/channel-evaluation/chinese-english-code-switch-blind-corpus-manifest.json";
const EVIDENCE_PATH =
  "docs/compliance/channel-chinese-english-code-switch-blind-corpus-approval.json";

async function readJson(relativePath: string): Promise<unknown> {
  const contents = await readFile(path.join(ROOT, relativePath), "utf8");
  return JSON.parse(contents) as unknown;
}

function schemaMessages(result: {
  success: false;
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
}): string[] {
  return result.error.issues.map((issue) => {
    const location = issue.path.map(String).join(".") || "record";
    return `${location}: ${issue.message}`;
  });
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main(): Promise<void> {
  const [rawManifest, rawEvidence] = await Promise.all([
    readJson(MANIFEST_PATH),
    readJson(EVIDENCE_PATH),
  ]);
  const manifest =
    ChineseEnglishCodeSwitchBlindCorpusManifestDescriptorSchema.safeParse(
      rawManifest,
    );
  const evidence =
    ChineseEnglishCodeSwitchBlindCorpusApprovalEvidenceSchema.safeParse(
      rawEvidence,
    );
  const errors = [
    ...(manifest.success ? [] : schemaMessages(manifest)),
    ...(evidence.success ? [] : schemaMessages(evidence)),
  ];

  const corpus = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
  const report = validateChineseEnglishCodeSwitchBlindEvaluationCorpus(corpus);
  errors.push(...report.issues.map((issue) => issue.code));

  if (manifest.success) {
    if (!sameJsonValue(manifest.data.declaredCoverage, report.coverage)) {
      errors.push("manifest_coverage_mismatch");
    }
    if (!sameJsonValue(manifest.data.targets, corpus.targets)) {
      errors.push("manifest_targets_mismatch");
    }
  }
  if (evidence.success) {
    if (evidence.data.corpusId !== corpus.corpusId) {
      errors.push("evidence_corpus_mismatch");
    }
    if (evidence.data.manifestPath !== MANIFEST_PATH) {
      errors.push("evidence_manifest_path_mismatch");
    }
  }

  const result = {
    corpusId: corpus.corpusId,
    manifestPath: MANIFEST_PATH,
    evidencePath: EVIDENCE_PATH,
    inventoryValid: report.valid && errors.length === 0,
    releaseReady: report.releaseReady && errors.length === 0,
    coverage: report.coverage,
    issues: errors,
    blockers: report.blockers,
    finalTupleEvaluation: corpus.finalTupleEvaluation.status,
    tuningAllowed: corpus.tuning.allowed,
  } as const;
  console.log(JSON.stringify(result));

  // Pending human and upstream evidence is an intentional fail-closed result.
  if (!result.inventoryValid || !result.releaseReady) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Code-switch corpus validation failed",
  );
  process.exitCode = 1;
});
