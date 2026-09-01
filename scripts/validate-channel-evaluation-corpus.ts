import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ChannelEnglishBlindCorpusApprovalEvidenceSchema,
  ChannelEnglishBlindCorpusManifestDescriptorSchema,
  createEnglishBlindEvaluationCorpus,
  validateChannelEvaluationCorpus,
} from "../lib/channel/evaluation-corpus-governance";

import simplifiedManifest from "../docs/evaluation/channel/simplified-chinese-blind-corpus.manifest.json";
import simplifiedEvidence from "../docs/evaluation/channel/simplified-chinese-blind-corpus-approval-freeze-evidence.json";
import {
  SimplifiedChineseBlindCorpusApprovalFreezeEvidenceSchema,
  validateSimplifiedChineseBlindCorpus,
} from "../lib/channel/evaluation-corpus";

import {
  TRADITIONAL_CHINESE_BLIND_MANIFEST,
} from "../test-fixtures/channel-evaluation-corpus/traditional-chinese-blind.manifest";
import {
  validateChannelEvaluationCorpus as validateTraditionalChineseBlindEvaluationCorpus,
} from "../lib/channel/traditional-chinese-evaluation-corpus-governance";
import codeSwitchManifest from "../docs/channel-evaluation/chinese-english-code-switch-blind-corpus-manifest.json";
import codeSwitchEvidence from "../docs/compliance/channel-chinese-english-code-switch-blind-corpus-approval.json";
import {
  ChineseEnglishCodeSwitchBlindCorpusApprovalEvidenceSchema,
  ChineseEnglishCodeSwitchBlindCorpusManifestDescriptorSchema,
  createChineseEnglishCodeSwitchBlindEvaluationCorpus,
  validateChineseEnglishCodeSwitchBlindEvaluationCorpus,
} from "../lib/channel/code-switch-blind-corpus-governance";

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = "docs/channel-evaluation/english-blind-corpus-manifest.json";
const EVIDENCE_PATH =
  "docs/compliance/channel-english-blind-corpus-approval.json";

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
  const manifest = ChannelEnglishBlindCorpusManifestDescriptorSchema.safeParse(
    rawManifest,
  );
  const evidence = ChannelEnglishBlindCorpusApprovalEvidenceSchema.safeParse(
    rawEvidence,
  );
  const errors = [
    ...(manifest.success ? [] : schemaMessages(manifest)),
    ...(evidence.success ? [] : schemaMessages(evidence)),
  ];

  const corpus = createEnglishBlindEvaluationCorpus();
  const report = validateChannelEvaluationCorpus(corpus);
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

  const englishResult = {
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
  const simplifiedReport = validateSimplifiedChineseBlindCorpus(simplifiedManifest);
  const parsedSimplifiedEvidence =
    SimplifiedChineseBlindCorpusApprovalFreezeEvidenceSchema.safeParse(
      simplifiedEvidence,
    );
  const simplifiedEvidenceMatchesManifest =
    parsedSimplifiedEvidence.success &&
    parsedSimplifiedEvidence.data.language === simplifiedManifest.language &&
    parsedSimplifiedEvidence.data.status === simplifiedReport.status;
  const simplifiedResult = {
    manifestPath:
      "docs/evaluation/channel/simplified-chinese-blind-corpus.manifest.json",
    evidencePath:
      "docs/evaluation/channel/simplified-chinese-blind-corpus-approval-freeze-evidence.json",
    status: simplifiedReport.status,
    counts: simplifiedReport.counts,
    issues: simplifiedReport.issues,
    approvalFreezeEvidence: {
      status: parsedSimplifiedEvidence.success ? "valid" : "invalid",
      matchesManifest: simplifiedEvidenceMatchesManifest,
    },
  } as const;
  const traditionalReport = validateTraditionalChineseBlindEvaluationCorpus(
    TRADITIONAL_CHINESE_BLIND_MANIFEST,
  );
  const traditionalResult = {
    corpusVersion: TRADITIONAL_CHINESE_BLIND_MANIFEST.corpusVersion,
    language: TRADITIONAL_CHINESE_BLIND_MANIFEST.language,
    valid: traditionalReport.valid,
    releaseReady: traditionalReport.releaseReady,
    coverage: traditionalReport.coverage,
    blockers: traditionalReport.blockers,
  } as const;
  const codeSwitchReport =
    validateChineseEnglishCodeSwitchBlindEvaluationCorpus(
      createChineseEnglishCodeSwitchBlindEvaluationCorpus(),
    );
  const parsedCodeSwitchManifest =
    ChineseEnglishCodeSwitchBlindCorpusManifestDescriptorSchema.safeParse(
      codeSwitchManifest,
    );
  const parsedCodeSwitchEvidence =
    ChineseEnglishCodeSwitchBlindCorpusApprovalEvidenceSchema.safeParse(
      codeSwitchEvidence,
    );
  const codeSwitchManifestMatchesCorpus =
    parsedCodeSwitchManifest.success &&
    sameJsonValue(parsedCodeSwitchManifest.data.targets, codeSwitchReport.manifest?.targets) &&
    sameJsonValue(
      parsedCodeSwitchManifest.data.declaredCoverage,
      codeSwitchReport.coverage,
    );
  const codeSwitchEvidenceMatchesManifest =
    parsedCodeSwitchEvidence.success &&
    parsedCodeSwitchEvidence.data.corpusId === codeSwitchManifest.corpusId &&
    parsedCodeSwitchEvidence.data.manifestPath ===
      "docs/channel-evaluation/chinese-english-code-switch-blind-corpus-manifest.json";
  const codeSwitchResult = {
    corpusId: codeSwitchManifest.corpusId,
    manifestPath:
      "docs/channel-evaluation/chinese-english-code-switch-blind-corpus-manifest.json",
    evidencePath:
      "docs/compliance/channel-chinese-english-code-switch-blind-corpus-approval.json",
    inventoryValid:
      codeSwitchReport.valid &&
      parsedCodeSwitchManifest.success &&
      parsedCodeSwitchEvidence.success &&
      codeSwitchManifestMatchesCorpus &&
      codeSwitchEvidenceMatchesManifest,
    releaseReady:
      codeSwitchReport.releaseReady &&
      parsedCodeSwitchManifest.success &&
      parsedCodeSwitchEvidence.success &&
      codeSwitchManifestMatchesCorpus &&
      codeSwitchEvidenceMatchesManifest,
    coverage: codeSwitchReport.coverage,
    issues: [
      ...codeSwitchReport.issues.map((issue) => issue.code),
      ...(parsedCodeSwitchManifest.success
        ? []
        : schemaMessages(parsedCodeSwitchManifest)),
      ...(parsedCodeSwitchEvidence.success
        ? []
        : schemaMessages(parsedCodeSwitchEvidence)),
      ...(codeSwitchManifestMatchesCorpus ? [] : ["manifest_coverage_mismatch"]),
      ...(codeSwitchEvidenceMatchesManifest
        ? []
        : ["evidence_manifest_mismatch"]),
    ],
    blockers: codeSwitchReport.blockers,
    finalTupleEvaluation:
      codeSwitchReport.manifest?.finalTupleEvaluation.status ?? "blocked",
    tuningAllowed: codeSwitchReport.manifest?.tuning.allowed ?? false,
  } as const;
  const result = {
    english: englishResult,
    simplified: simplifiedResult,
    traditional: traditionalResult,
    codeSwitch: codeSwitchResult,
  } as const;
  console.log(JSON.stringify(result));

  // A pending human gate is an intentional fail-closed result, not an error in
  // the inventory. CI and operators must not mistake it for release evidence.
  if (
    !englishResult.inventoryValid ||
    !englishResult.releaseReady ||
    simplifiedResult.status !== "ready" ||
    !simplifiedEvidenceMatchesManifest ||
    !traditionalResult.valid ||
    !traditionalResult.releaseReady ||
    !codeSwitchResult.inventoryValid ||
    !codeSwitchResult.releaseReady
  ) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Corpus validation failed");
  process.exitCode = 1;
});
