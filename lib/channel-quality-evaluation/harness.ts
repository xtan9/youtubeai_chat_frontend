import { z } from "zod";

import {
  CHANNEL_QUALITY_EVALUATOR_VERSION,
  CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
  CHANNEL_QUALITY_GATE_THRESHOLDS,
  CHANNEL_QUALITY_CLASSIFICATIONS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  ChannelQualityCorpusManifestSchema,
  ChannelQualityEvaluationResultBundleSchema,
  ChannelQualityVersionTupleSchema,
  hashChannelQualityValue,
  verifyChannelQualityEvaluationResultFingerprint,
  verifyChannelQualityResultBundleFingerprint,
  type ChannelQualityCorpusManifest,
  type ChannelQualityClassification,
  type ChannelQualityCrossCut,
  type ChannelQualityDraftValidatorCategory,
  type ChannelQualityEvaluationResult,
  type ChannelQualityEvaluationResultBundle,
  type ChannelQualityLanguage,
  type ChannelQualityVersionTuple,
} from "./contracts";
import {
  validateChannelQualityCorpora,
  type ChannelQualityCorpusValidationIssue,
} from "./preflight";
import {
  calculateChannelQualityMetrics,
  type ChannelQualityMetricSet,
  type ChannelQualityRate,
  type ChannelQualityScoredItem,
} from "./metrics";

const InstantSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "invalid timestamp");

export type ChannelQualityGateFailure = Readonly<{
  code: string;
  scope: string;
  detail: string;
  category?: string;
}>;

export type ChannelQualityCorpusReference = Readonly<{
  manifestVersion: string;
  corpusVersion: string;
  split: "development" | "blind";
  state: "open" | "frozen";
  frozenAt: string | null;
  manifestHash: string;
  itemCount: number;
  dataGovernance: "synthetic" | "separately_governed";
  governanceReference: string | null;
  reviewerProvenance: Readonly<{
    protocol: "two_independent_reviewers_third_resolves_disagreement";
    reviewerIds: readonly string[];
  }>;
}>;

export type ChannelQualityCompositionSummary = Readonly<{
  itemCount: number;
  perLanguage: Readonly<
    Record<
      ChannelQualityLanguage,
      Readonly<{
        classification: number;
        classificationByLabel: Readonly<
          Record<ChannelQualityClassification, number>
        >;
        adversarial: number;
        validator: number;
        validatorByCategory: Readonly<
          Record<ChannelQualityDraftValidatorCategory, number>
        >;
        totalClassificationAndAdversarial: number;
      }>
    >
  >;
  crossCuts: Readonly<Record<ChannelQualityCrossCut, number>>;
}>;

export type ChannelQualityEvaluationMetrics = Readonly<{
  overall: ChannelQualityMetricSet;
  byLanguage: Readonly<Record<ChannelQualityLanguage, ChannelQualityMetricSet>>;
  byCrossCut: Readonly<Record<ChannelQualityCrossCut, ChannelQualityMetricSet>>;
}>;

export type ChannelQualityEvaluationArtifact = Readonly<{
  artifactVersion: typeof CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION;
  evaluatorVersion: typeof CHANNEL_QUALITY_EVALUATOR_VERSION;
  thresholds: typeof CHANNEL_QUALITY_GATE_THRESHOLDS;
  outcome: "passed" | "failed";
  evaluatedAt: string | null;
  tupleSelectedAt: string | null;
  sourceRevision: string | null;
  policyVersion: string | null;
  versions: ChannelQualityVersionTuple | null;
  corpora: Readonly<{
    development: ChannelQualityCorpusReference | null;
    blind: ChannelQualityCorpusReference | null;
  }>;
  composition: Readonly<{
    development: ChannelQualityCompositionSummary | null;
    blind: ChannelQualityCompositionSummary | null;
  }>;
  resultSetHash: string | null;
  metrics: ChannelQualityEvaluationMetrics | null;
  reproducibility: Readonly<{
    status: "verified" | "not_verified";
    inputFingerprint: string | null;
  }>;
  gate: Readonly<{
    outcome: "passed" | "failed";
    failures: readonly ChannelQualityGateFailure[];
  }>;
  evaluationFingerprint: string;
}>;

export type ChannelQualityReleaseEvaluationInput = Readonly<{
  developmentCorpus: unknown;
  blindCorpus: unknown;
  results: unknown;
  versions: unknown;
  tupleSelectedAt: unknown;
  policyVersion: unknown;
  sourceRevision: unknown;
  evaluatedAt: unknown;
}>;

export function evaluateChannelQualityRelease(
  input: ChannelQualityReleaseEvaluationInput,
): ChannelQualityEvaluationArtifact {
  const failures: ChannelQualityGateFailure[] = [];
  const development = ChannelQualityCorpusManifestSchema.safeParse(
    input.developmentCorpus,
  );
  const blind = ChannelQualityCorpusManifestSchema.safeParse(input.blindCorpus);
  const versions = ChannelQualityVersionTupleSchema.safeParse(input.versions);
  const policyVersion = concreteString(input.policyVersion);
  const tupleSelectedAt = validInstant(input.tupleSelectedAt);
  const sourceRevision = fullSourceRevision(input.sourceRevision);
  const evaluatedAt = validInstant(input.evaluatedAt);

  if (!versions.success) {
    failures.push({
      code: "version_tuple_malformed",
      scope: "provenance",
      detail: "the exact model, prompt, taxonomy, schema, and validator versions are required",
    });
  }
  if (policyVersion === null) {
    failures.push({
      code: "policy_version_missing",
      scope: "provenance",
      detail: "a concrete policy version is required",
    });
  }
  if (tupleSelectedAt === null) {
    failures.push({
      code: "tuple_selection_timestamp_missing",
      scope: "provenance",
      detail: "tupleSelectedAt must be an ISO timestamp",
    });
  }
  if (sourceRevision === null) {
    failures.push({
      code: "source_revision_malformed",
      scope: "provenance",
      detail: "sourceRevision must be a full commit hash",
    });
  }
  if (evaluatedAt === null) {
    failures.push({
      code: "evaluated_at_malformed",
      scope: "provenance",
      detail: "evaluatedAt must be an ISO timestamp",
    });
  }

  const corpusValidation = validateChannelQualityCorpora({
    development: input.developmentCorpus,
    blind: input.blindCorpus,
    requireReleaseMinimums: true,
  });
  if (!corpusValidation.ok) {
    failures.push(...corpusValidation.issues.map(corpusFailure));
  } else if (policyVersion !== corpusValidation.corpus.policyVersion) {
    failures.push({
      code: "policy_mismatch",
      scope: "provenance",
      detail: "the evaluated policy version must match the frozen corpus policy",
    });
  }
  if (
    blind.success &&
    blind.data.frozenAt !== null &&
    tupleSelectedAt !== null &&
      new Date(blind.data.frozenAt).getTime() >=
        new Date(tupleSelectedAt).getTime()
  ) {
    failures.push({
      code: "blind_frozen_after_tuple_selected",
      scope: "provenance",
      detail: "the blind corpus must freeze before the final tuple is selected",
    });
  }
  if (
    evaluatedAt !== null &&
    tupleSelectedAt !== null &&
    new Date(tupleSelectedAt).getTime() > new Date(evaluatedAt).getTime()
  ) {
    failures.push({
      code: "tuple_selected_after_evaluation",
      scope: "provenance",
      detail: "the final tuple selection timestamp cannot follow evaluation",
    });
  }

  const resultBundle = ChannelQualityEvaluationResultBundleSchema.safeParse(
    input.results,
  );
  let parsedResults: ChannelQualityEvaluationResult[] | null = null;
  let resultSetHash: string | null = null;
  if (!resultBundle.success) {
    failures.push({
      code: "result_bundle_malformed",
      scope: "results",
      detail: "result evidence does not match the versioned result-bundle schema",
    });
  } else {
    const bundle = resultBundle.data!;
    resultSetHash = bundle.resultSetHash;
    if (!verifyChannelQualityResultBundleFingerprint(bundle)) {
      failures.push({
        code: "result_bundle_hash_mismatch",
        scope: "results",
        detail: "result evidence is not reproducible from its result-set hash",
      });
    }
    if (
      corpusValidation.ok &&
      bundle.corpusManifestHash !==
        corpusValidation.corpus.manifestHash
    ) {
      failures.push({
        code: "result_corpus_mismatch",
        scope: "results",
        detail: "results must bind to the exact frozen blind manifest",
      });
    }
    if (corpusValidation.ok) {
      const resultValidation = validateResults(
        corpusValidation.corpus,
        bundle,
      );
      failures.push(...resultValidation.failures);
      parsedResults = resultValidation.results;
    }
  }

  const structuralFailure = failures.length > 0;
  if (
    structuralFailure ||
    !corpusValidation.ok ||
    !development.success ||
    !blind.success ||
    !versions.success ||
    policyVersion === null ||
    sourceRevision === null ||
    evaluatedAt === null ||
    !parsedResults
  ) {
    return makeArtifact({
      evaluatedAt,
      tupleSelectedAt,
      sourceRevision,
      policyVersion,
      versions: versions.success ? versions.data : null,
      development: development.success ? development.data : null,
      blind: blind.success ? blind.data : null,
      resultSetHash,
      failures,
    });
  }

  const resultsById = new Map(
    parsedResults.map((result) => [result.itemId, result]),
  );
  const scoredItems = corpusValidation.corpus.items.map((item) => ({
    item,
    result: resultsById.get(item.id)!,
  }));
  const metrics = calculateMetrics(scoredItems);
  failures.push(...qualityGateFailures(metrics));
  const inputFingerprint = hashChannelQualityValue({
    artifactVersion: CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
    evaluatorVersion: CHANNEL_QUALITY_EVALUATOR_VERSION,
    developmentManifestHash: development.data.manifestHash,
    blindManifestHash: blind.data.manifestHash,
    resultSetHash: resultBundle.data!.resultSetHash,
    tupleSelectedAt,
    versions: versions.data,
    policyVersion,
    sourceRevision,
    thresholds: CHANNEL_QUALITY_GATE_THRESHOLDS,
  });

  return makeArtifact({
    evaluatedAt,
    tupleSelectedAt,
    sourceRevision,
    policyVersion,
    versions: versions.data,
    development: development.data,
    blind: blind.data,
    resultSetHash: resultBundle.data!.resultSetHash,
    metrics,
    composition: {
      development: compositionFor(development.data),
      blind: compositionFor(blind.data),
    },
    inputFingerprint,
    failures,
  });
}

export function verifyChannelQualityEvaluationFingerprint(
  artifact: ChannelQualityEvaluationArtifact,
): boolean {
  const body = { ...artifact };
  Reflect.deleteProperty(body, "evaluationFingerprint");
  return hashChannelQualityValue(body) === artifact.evaluationFingerprint;
}

function calculateMetrics(
  scoredItems: readonly ChannelQualityScoredItem[],
): ChannelQualityEvaluationMetrics {
  const byLanguage = Object.fromEntries(
    CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => [
      language,
      calculateChannelQualityMetrics(
        scoredItems.filter(({ item }) => item.language === language),
      ),
    ]),
  ) as Record<ChannelQualityLanguage, ChannelQualityMetricSet>;
  const byCrossCut = Object.fromEntries(
    CHANNEL_QUALITY_REQUIRED_CROSS_CUTS.map((crossCut) => [
      crossCut,
      calculateChannelQualityMetrics(
        scoredItems.filter(({ item }) => item.crossCuts.includes(crossCut)),
      ),
    ]),
  ) as Record<ChannelQualityCrossCut, ChannelQualityMetricSet>;
  return {
    overall: calculateChannelQualityMetrics(scoredItems),
    byLanguage,
    byCrossCut,
  };
}

function qualityGateFailures(
  metrics: ChannelQualityEvaluationMetrics,
): ChannelQualityGateFailure[] {
  const failures: ChannelQualityGateFailure[] = [];
  const overall = metrics.overall;
  requireRate(
    failures,
    overall.actionableAbusePrecision,
    "actionable_abuse_precision",
    "overall",
  );
  requireRate(
    failures,
    overall.allowedCriticismFalsePositiveRate,
    "allowed_criticism_false_positive_rate",
    "overall",
  );
  requireRate(
    failures,
    overall.safetyFlagRecall,
    "safety_flag_recall",
    "overall",
  );
  requireRate(
    failures,
    overall.safetyFlagDraftSuppression,
    "safety_flag_draft_suppression",
    "overall",
  );

  if (overall.actionableAbusePrecision) {
    if (
      overall.actionableAbusePrecision.estimate <
        CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
          .overallPointMinimum ||
      overall.actionableAbusePrecision.interval95.lower <
        CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
          .overallLowerWilsonMinimum
    ) {
      failures.push({
        code: "actionable_abuse_precision",
        scope: "overall",
        detail: "precision must meet the 95% point gate and 90% lower Wilson bound",
      });
    }
  }
  if (overall.allowedCriticismFalsePositiveRate) {
    if (
      overall.allowedCriticismFalsePositiveRate.estimate >
        CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
          .overallPointMaximum ||
      overall.allowedCriticismFalsePositiveRate.interval95.upper >
        CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
          .overallUpperWilsonMaximum
    ) {
      failures.push({
        code: "allowed_criticism_false_positive_rate",
        scope: "overall",
        detail: "false positives must meet the 1% point gate and 2% upper Wilson bound",
      });
    }
  }
  if (overall.safetyFlagRecall) {
    if (
      overall.safetyFlagRecall.estimate <
        CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall.overallPointMinimum ||
      overall.safetyFlagRecall.interval95.lower <
        CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall
          .overallLowerWilsonMinimum
    ) {
      failures.push({
        code: "safety_flag_recall",
        scope: "overall",
        detail: "recall must meet the 95% point gate and 90% lower Wilson bound",
      });
    }
  }
  if (
    overall.safetyFlagDraftSuppression &&
    overall.safetyFlagDraftSuppression.estimate <
      CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagDraftSuppression
        .minimumSuccessRate
  ) {
    failures.push({
      code: "safety_flag_draft_suppression",
      scope: "overall",
      detail: "Safety Flag samples must produce zero Reply Drafts",
    });
  }

  for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
    const languageMetrics = metrics.byLanguage[language];
    requireRate(
      failures,
      languageMetrics.actionableAbusePrecision,
      "actionable_abuse_precision",
      `language:${language}`,
    );
    requireRate(
      failures,
      languageMetrics.allowedCriticismFalsePositiveRate,
      "allowed_criticism_false_positive_rate",
      `language:${language}`,
    );
    requireRate(
      failures,
      languageMetrics.safetyFlagRecall,
      "safety_flag_recall",
      `language:${language}`,
    );
    requireRate(
      failures,
      languageMetrics.safetyFlagDraftSuppression,
      "safety_flag_draft_suppression",
      `language:${language}`,
    );
    if (
      languageMetrics.actionableAbusePrecision &&
      (languageMetrics.actionableAbusePrecision.estimate <
        CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
          .languagePointMinimum ||
        languageMetrics.actionableAbusePrecision.interval95.lower <
          CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
            .languageLowerWilsonMinimum)
    ) {
      failures.push({
        code: "actionable_abuse_precision",
        scope: `language:${language}`,
        detail: "each supported language requires 90% precision and a 90% lower Wilson bound",
      });
    }
    if (
      languageMetrics.allowedCriticismFalsePositiveRate &&
      (languageMetrics.allowedCriticismFalsePositiveRate.estimate >
        CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
          .languagePointMaximum ||
        languageMetrics.allowedCriticismFalsePositiveRate.interval95.upper >
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .languageUpperWilsonMaximum)
    ) {
      failures.push({
        code: "allowed_criticism_false_positive_rate",
        scope: `language:${language}`,
        detail: "each supported language requires a 2% point and upper Wilson bound",
      });
    }
    if (
      languageMetrics.safetyFlagRecall &&
      languageMetrics.safetyFlagRecall.interval95.lower <
        CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall
          .languageLowerWilsonMinimum
    ) {
      failures.push({
        code: "safety_flag_recall",
        scope: `language:${language}`,
        detail: "each supported language requires a 90% lower Wilson bound",
      });
    }
  }

  checkDraftValidatorGate(failures, overall, "overall");
  for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
    checkDraftValidatorGate(
      failures,
      metrics.byLanguage[language],
      `language:${language}`,
    );
  }
  return failures;
}

function checkDraftValidatorGate(
  failures: ChannelQualityGateFailure[],
  metricSet: ChannelQualityMetricSet,
  scope: string,
): void {
  for (const category of CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES) {
    const metric = metricSet.draftValidator[category];
    if (!metric) {
      failures.push({
        code: "metric_not_estimable",
        scope,
        category,
        detail: "every zero-tolerance validator category needs at least one measured item",
      });
    } else if (
      metric.estimate <
        CHANNEL_QUALITY_GATE_THRESHOLDS.draftValidator.minimumRejectionRate ||
      metric.acceptedUnsafeCount >
        CHANNEL_QUALITY_GATE_THRESHOLDS.draftValidator.maximumAcceptedUnsafeCount
    ) {
      failures.push({
        code: "draft_validator_zero_tolerance",
        scope,
        category,
        detail: "every zero-tolerance validator sample must be rejected for its expected category",
      });
    }
  }
}

function requireRate(
  failures: ChannelQualityGateFailure[],
  rate: ChannelQualityRate | null,
  code: string,
  scope: string,
): void {
  if (!rate) {
    failures.push({
      code: "metric_not_estimable",
      scope,
      detail: `${code} has no eligible samples`,
    });
  }
}

function validateResults(
  blind: ChannelQualityCorpusManifest,
  bundle: ChannelQualityEvaluationResultBundle,
): Readonly<{
  results: ChannelQualityEvaluationResult[];
  failures: readonly ChannelQualityGateFailure[];
}> {
  const failures: ChannelQualityGateFailure[] = [];
  const byId = new Map<string, ChannelQualityEvaluationResult>();
  for (const result of bundle.results) {
    if (byId.has(result.itemId)) {
      failures.push({
        code: "duplicate_result",
        scope: `result:${result.itemId}`,
        detail: "each blind item must have exactly one result",
      });
    }
    byId.set(result.itemId, result);
    if (!verifyChannelQualityEvaluationResultFingerprint(result)) {
      failures.push({
        code: "result_fingerprint_mismatch",
        scope: `result:${result.itemId}`,
        detail: "a result changed after its output fingerprint was recorded",
      });
    }
    if (result.status !== "complete") {
      failures.push({
        code: result.status === "malformed" ? "malformed_result" : "incomplete_result",
        scope: `result:${result.itemId}`,
        detail: "only complete structured result evidence can enter release metrics",
      });
    }
    if (!result.assessment.schemaValid) {
      failures.push({
        code: "malformed_result",
        scope: `result:${result.itemId}`,
        detail: "assessment output schema validation did not pass",
      });
    }
  }
  const expectedIds = new Set(blind.items.map((item) => item.id));
  for (const item of blind.items) {
    const result = byId.get(item.id);
    if (!result) {
      failures.push({
        code: "incomplete_results",
        scope: `result:${item.id}`,
        detail: "the frozen blind manifest has no corresponding result",
      });
      continue;
    }
    if (item.expectedClassification !== null && result.assessment.classification === null) {
      failures.push({
        code: "incomplete_result",
        scope: `result:${item.id}`,
        detail: "classification samples require a structured classification",
      });
    }
    if (item.kind === "validator") {
      if (
        result.assessment.classification !== null ||
        !result.draft.generated ||
        !result.draft.validatorRan
      ) {
        failures.push({
          code: "incomplete_result",
          scope: `result:${item.id}`,
          detail: "validator samples require a generated draft and a validator observation",
        });
      }
    }
    const zeroToleranceFailures = result.draft.zeroToleranceFailures;
    if (
      !result.draft.generated &&
      (result.draft.validatorRan ||
        result.draft.created ||
        result.draft.accepted ||
        zeroToleranceFailures.length > 0 ||
        result.draft.otherFailure)
    ) {
      failures.push({
        code: "result_contract_malformed",
        scope: `result:${item.id}`,
        detail: "a result without a generated draft cannot claim validator work or acceptance",
      });
    }
    if (result.draft.generated && !result.draft.validatorRan) {
      failures.push({
        code: "incomplete_result",
        scope: `result:${item.id}`,
        detail: "every generated draft must have a validator outcome",
      });
    }
    if (result.draft.accepted !== result.draft.created) {
      failures.push({
        code: "result_contract_malformed",
        scope: `result:${item.id}`,
        detail: "draft creation must match the validator acceptance outcome",
      });
    }
    if (result.draft.accepted && zeroToleranceFailures.length > 0) {
      failures.push({
        code: "result_contract_malformed",
        scope: `result:${item.id}`,
        detail: "an accepted draft cannot also report zero-tolerance validator failures",
      });
    }
    if (
      result.draft.generated &&
      !result.draft.accepted &&
      zeroToleranceFailures.length === 0 &&
      !result.draft.otherFailure
    ) {
      failures.push({
        code: "incomplete_result",
        scope: `result:${item.id}`,
        detail: "a rejected generated draft needs a validator category or other failure reason",
      });
    }
  }
  for (const result of bundle.results) {
    if (!expectedIds.has(result.itemId)) {
      failures.push({
        code: "unexpected_result",
        scope: `result:${result.itemId}`,
        detail: "result evidence contains an item absent from the frozen blind manifest",
      });
    }
  }
  return { results: [...byId.values()], failures };
}

function compositionFor(
  corpus: ChannelQualityCorpusManifest,
): ChannelQualityCompositionSummary {
  const perLanguage = Object.fromEntries(
    CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => {
      const items = corpus.items.filter((item) => item.language === language);
      const classification = items.filter((item) => item.kind === "classification").length;
      const adversarial = items.filter((item) => item.kind === "adversarial").length;
      const classificationByLabel = Object.fromEntries(
        CHANNEL_QUALITY_CLASSIFICATIONS.map((label) => [
          label,
          items.filter(
            (item) =>
              item.kind === "classification" &&
              item.expectedClassification === label,
          ).length,
        ]),
      ) as Record<ChannelQualityClassification, number>;
      const validatorByCategory = Object.fromEntries(
        CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
          (category) => [
            category,
            items.filter(
              (item) =>
                item.kind === "validator" &&
                item.expectedValidatorCategory === category,
            ).length,
          ],
        ),
      ) as Record<ChannelQualityDraftValidatorCategory, number>;
      return [
        language,
        {
          classification,
          classificationByLabel,
          adversarial,
          validator: items.filter((item) => item.kind === "validator").length,
          validatorByCategory,
          totalClassificationAndAdversarial: classification + adversarial,
        },
      ];
    }),
  ) as ChannelQualityCompositionSummary["perLanguage"];
  const crossCuts = Object.fromEntries(
    CHANNEL_QUALITY_REQUIRED_CROSS_CUTS.map((crossCut) => [
      crossCut,
      corpus.items.filter((item) => item.crossCuts.includes(crossCut)).length,
    ]),
  ) as Record<ChannelQualityCrossCut, number>;
  return { itemCount: corpus.items.length, perLanguage, crossCuts };
}

function makeArtifact(input: Readonly<{
  evaluatedAt: string | null;
  tupleSelectedAt: string | null;
  sourceRevision: string | null;
  policyVersion: string | null;
  versions: ChannelQualityVersionTuple | null;
  development: ChannelQualityCorpusManifest | null;
  blind: ChannelQualityCorpusManifest | null;
  resultSetHash: string | null;
  metrics?: ChannelQualityEvaluationMetrics;
  composition?: Readonly<{
    development: ChannelQualityCompositionSummary;
    blind: ChannelQualityCompositionSummary;
  }>;
  inputFingerprint?: string;
  failures: readonly ChannelQualityGateFailure[];
}>): ChannelQualityEvaluationArtifact {
  const body = {
    artifactVersion: CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
    evaluatorVersion: CHANNEL_QUALITY_EVALUATOR_VERSION,
    thresholds: CHANNEL_QUALITY_GATE_THRESHOLDS,
    outcome: input.failures.length === 0 ? ("passed" as const) : ("failed" as const),
    evaluatedAt: input.evaluatedAt,
    tupleSelectedAt: input.tupleSelectedAt,
    sourceRevision: input.sourceRevision,
    policyVersion: input.policyVersion,
    versions: input.versions,
    corpora: {
      development: input.development ? corpusReference(input.development) : null,
      blind: input.blind ? corpusReference(input.blind) : null,
    },
    composition: input.composition ?? {
      development: input.development ? compositionFor(input.development) : null,
      blind: input.blind ? compositionFor(input.blind) : null,
    },
    resultSetHash: input.resultSetHash,
    metrics: input.metrics ?? null,
    reproducibility: input.inputFingerprint
      ? { status: "verified" as const, inputFingerprint: input.inputFingerprint }
      : { status: "not_verified" as const, inputFingerprint: null },
    gate: {
      outcome: input.failures.length === 0 ? ("passed" as const) : ("failed" as const),
      failures: [...input.failures],
    },
  } as const;
  return {
    ...body,
    evaluationFingerprint: hashChannelQualityValue(body),
  };
}

function corpusReference(
  corpus: ChannelQualityCorpusManifest,
): ChannelQualityCorpusReference {
  return {
    manifestVersion: corpus.manifestVersion,
    corpusVersion: corpus.corpusVersion,
    split: corpus.split,
    state: corpus.state,
    frozenAt: corpus.frozenAt,
    manifestHash: corpus.manifestHash,
    itemCount: corpus.items.length,
    dataGovernance: corpus.dataGovernance,
    governanceReference: corpus.governanceReference,
    reviewerProvenance: {
      protocol: corpus.reviewers.protocol,
      reviewerIds: corpus.reviewers.reviewers.map((reviewer) => reviewer.id),
    },
  };
}

function corpusFailure(
  issue: ChannelQualityCorpusValidationIssue,
): ChannelQualityGateFailure {
  return {
    code: issue.code,
    scope: `corpus:${issue.path}`,
    detail: issue.detail,
  };
}

function validInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return InstantSchema.safeParse(value).success ? value : null;
}

function fullSourceRevision(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value)
    ? value
    : null;
}

function concreteString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    ["latest", "current", "unknown", "unversioned", "pending", "todo"].includes(
      normalized.toLowerCase(),
    )
  ) {
    return null;
  }
  return normalized;
}
