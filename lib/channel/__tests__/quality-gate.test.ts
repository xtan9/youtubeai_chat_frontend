import { describe, expect, it } from "vitest";

import {
  CHANNEL_EVALUATION_CORPORA,
  ChannelQualityGateInputSchema,
  ChannelQualityGateTupleSchema,
  channelQualityGateTupleFingerprint,
  channelQualityGateReportFingerprint,
  evaluateChannelQualityGate,
  projectEnglishBlindCorpusForQualityGate,
} from "../quality-gate";
import type { ChannelQualityHarnessArtifact } from "../quality-gate";
import {
  createEnglishBlindEvaluationCorpus,
} from "../evaluation-corpus-governance";
import {
  CHANNEL_QUALITY_CLASSIFICATIONS,
  CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
  CHANNEL_QUALITY_EVALUATOR_VERSION,
  CHANNEL_QUALITY_GATE_THRESHOLDS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  hashChannelQualityValue,
} from "../../channel-quality-evaluation";
>>>>>>> ff6c11f (feat(channel): harden multilingual quality gate)

const CATEGORIES = [
  "Allowed Criticism",
  "Actionable Abuse",
  "Reviewable Interaction",
  "Safety Flag",
] as const;

const VALIDATORS = [
  "privacy",
  "threat",
  "impersonation",
  "diagnosis",
  "spam",
  "malicious_link",
  "instruction_echo",
] as const;

type TestLanguage = (typeof CHANNEL_EVALUATION_CORPORA)[number]["language"];

const TUPLE = {
  modelIdentifier: "channel-evaluation-model-v1",
  assessmentPromptVersion: "interaction-assessment-prompt-v1",
  assessmentSchemaVersion: "interaction-assessment-v1",
  taxonomyVersion: "channel-comment-taxonomy-v1",
  draftPromptVersion: "channel-reply-draft-prompt-v1",
  draftSchemaVersion: "channel-reply-draft-v1",
  draftValidatorVersion: "channel-reply-draft-validator-v1",
} as const;

function buildTuple() {
  return {
    ...TUPLE,
    tupleFingerprint: channelQualityGateTupleFingerprint(TUPLE),
  } as const;
}

function buildHarnessArtifact(): ChannelQualityHarnessArtifact {
  const rate = {
    successes: 1,
    trials: 1,
    estimate: 1,
    interval95: { lower: 1, upper: 1 },
  };
  const validatorRate = {
    ...rate,
    acceptedUnsafeCount: 0,
    missingExpectedRejectionCount: 0,
  };
  const metricSet = {
    actionableAbusePrecision: rate,
    allowedCriticismFalsePositiveRate: rate,
    safetyFlagRecall: rate,
    safetyFlagDraftSuppression: rate,
    draftValidator: Object.fromEntries(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
        (category) => [category, validatorRate],
      ),
    ),
  };
  const metrics = {
    overall: metricSet,
    byLanguage: Object.fromEntries(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => [language, metricSet]),
    ),
    byCrossCut: Object.fromEntries(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS.map((crossCut) => [crossCut, metricSet]),
    ),
  };
  const compositionPerLanguage = {
    classification: 1,
    classificationByLabel: Object.fromEntries(
      CHANNEL_QUALITY_CLASSIFICATIONS.map((classification) => [classification, 1]),
    ),
    adversarial: 1,
    validator: 1,
    validatorByCategory: Object.fromEntries(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
        (category) => [category, 1],
      ),
    ),
    totalClassificationAndAdversarial: 2,
  };
  const composition = {
    itemCount: 1,
    perLanguage: Object.fromEntries(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => [
        language,
        compositionPerLanguage,
      ]),
    ),
    crossCuts: Object.fromEntries(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS.map((crossCut) => [crossCut, 1]),
    ),
  };
  const corpusReference = {
    manifestVersion: "channel-quality-corpus-manifest-v1",
    corpusVersion: "channel-comment-assistance-v1",
    split: "blind" as const,
    state: "frozen" as const,
    frozenAt: "2026-09-01T13:00:00.000Z",
    manifestHash: "c".repeat(64),
    itemCount: 1,
    dataGovernance: "synthetic" as const,
    governanceReference: null,
    reviewerProvenance: {
      protocol:
        "two_independent_reviewers_third_resolves_disagreements" as const,
      reviewerIds: ["reviewer-primary", "reviewer-secondary"],
    },
  };
  const body = {
    artifactVersion: CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
    evaluatorVersion: CHANNEL_QUALITY_EVALUATOR_VERSION,
    thresholds: CHANNEL_QUALITY_GATE_THRESHOLDS,
    outcome: "passed" as const,
    evaluatedAt: "2026-09-01T15:00:00.000Z",
    tupleSelectedAt: "2026-09-01T14:00:00.000Z",
    sourceRevision: "a".repeat(40),
    policyVersion: "channel-comment-assistance-d74-v1",
    versions: {
      modelVersion: TUPLE.modelIdentifier,
      promptVersion: TUPLE.assessmentPromptVersion,
      taxonomyVersion: TUPLE.taxonomyVersion,
      schemaVersion: TUPLE.assessmentSchemaVersion,
      validatorVersion: TUPLE.draftValidatorVersion,
    },
    corpora: {
      development: { ...corpusReference, split: "development" as const },
      blind: corpusReference,
    },
    composition: { development: composition, blind: composition },
    resultSetHash: "d".repeat(64),
    metrics,
    reproducibility: {
      status: "verified" as const,
      inputFingerprint: "e".repeat(64),
    },
    gate: { outcome: "passed" as const, failures: [] },
  };
  return {
    ...body,
    evaluationFingerprint: hashChannelQualityValue(body),
  };
}

function buildHarness(status: "available" | "not_available" = "available") {
  if (status === "not_available") {
    return {
      issueNumber: 482 as const,
      status: "not_available" as const,
      blockers: ["The offline harness is not available in this fixture."],
    };
  }
  return {
    issueNumber: 482 as const,
    status: "available" as const,
    sourceRevision: "a".repeat(40),
    artifact: buildHarnessArtifact(),
  };
}

function buildSamples(language: TestLanguage) {
  const samples: Array<{
    id: string;
    language: TestLanguage;
    category: (typeof CATEGORIES)[number];
    adversarialKind: "prompt_injection" | "adversarial" | null;
    zeroToleranceValidator: (typeof VALIDATORS)[number] | null;
    protectedGroupCrossCuts: string[];
    minorSafety: boolean;
    codeSwitchEvidence: {
      englishClause: string;
      chineseClause: string;
      independentlyMeaningful: true;
      reviewedBy: string;
    } | null;
  }> = [];
  const counts = [300, 250, 200, 250];
  let index = 0;
  for (const [categoryIndex, category] of CATEGORIES.entries()) {
    for (let offset = 0; offset < counts[categoryIndex]!; offset += 1) {
      samples.push({
        id: `${language.replaceAll("_", "-")}-sample-${String(index + 1).padStart(4, "0")}`,
        language,
        category,
        adversarialKind:
          index < 50 ? (index % 2 === 0 ? "prompt_injection" : "adversarial") : null,
        zeroToleranceValidator:
          index < 250 ? VALIDATORS[index % VALIDATORS.length]! : null,
        protectedGroupCrossCuts: [
          [
            "age",
            "caste_ethnicity_or_race",
            "disability",
            "immigration_status",
            "nationality",
            "religion",
            "sex_gender_or_sexual_orientation",
            "veteran_status",
            "victims_of_major_violent_event_or_kin",
          ][index % 9]!,
        ],
        minorSafety: category === "Safety Flag" && offset < 200,
        codeSwitchEvidence:
          language === "chinese_english_code_switch"
            ? {
                englishClause: "This comment needs more context",
                chineseClause: "这个评论需要更多背景",
                independentlyMeaningful: true,
                reviewedBy: "reviewer-primary",
              }
            : null,
      });
      index += 1;
    }
  }
  return samples;
}

function buildCoverage(samples: ReturnType<typeof buildSamples>) {
  const categoryCounts = {
    "Allowed Criticism": 0,
    "Actionable Abuse": 0,
    "Reviewable Interaction": 0,
    "Safety Flag": 0,
  };
  const protectedGroupCounts = {
    age: 0,
    caste_ethnicity_or_race: 0,
    disability: 0,
    immigration_status: 0,
    nationality: 0,
    religion: 0,
    sex_gender_or_sexual_orientation: 0,
    veteran_status: 0,
    victims_of_major_violent_event_or_kin: 0,
  };
  for (const sample of samples) {
    categoryCounts[sample.category] += 1;
    for (const crossCut of sample.protectedGroupCrossCuts) {
      protectedGroupCounts[crossCut as keyof typeof protectedGroupCounts] += 1;
    }
  }
  return {
    totalItems: samples.length,
    categoryCounts,
    adversarialCount: samples.filter(
      (sample) => sample.adversarialKind !== null,
    ).length,
    zeroToleranceValidatorCount: samples.filter(
      (sample) => sample.zeroToleranceValidator !== null,
    ).length,
    protectedGroupCounts,
    minorSafetyCount: samples.filter((sample) => sample.minorSafety).length,
    reviewerCompleteCount: samples.length,
  };
}

function buildCorpus(language: TestLanguage) {
  const definition = CHANNEL_EVALUATION_CORPORA.find(
    (candidate) => candidate.language === language,
  )!;
  const samples = buildSamples(language);
  const fingerprint = `${"abcdef"[CHANNEL_EVALUATION_CORPORA.indexOf(definition) % 6]}`.repeat(
    64,
  );
  return {
    issueNumber: definition.issueNumber,
    corpusId: definition.corpusId,
    language,
    corpusVersion: definition.corpusVersion,
    policyVersion: "channel-comment-assistance-d74-v1",
    fingerprint,
    blind: true as const,
    developmentCorpus: false as const,
    tuningAllowed: false as const,
    governance: {
      status: "passed" as const,
      issues: [],
      blockers: [],
    },
    coverage: buildCoverage(samples),
    approval: {
      status: "recorded" as const,
      corpusFingerprint: fingerprint,
    },
    freeze: {
      status: "recorded" as const,
      corpusFingerprint: fingerprint,
    },
    samples,
  };
}

function buildInput(options: Readonly<{
  harness?: ReturnType<typeof buildHarness>;
  corpora?: ReturnType<typeof buildCorpus>[];
  mutateObservation?: (observation: {
    sampleId: string;
    corpusId: string;
    corpusFingerprint: string;
    tupleFingerprint: string;
    status: "completed";
    predictedCategory: (typeof CATEGORIES)[number];
    draftProduced: boolean;
    validatorFailures: (typeof VALIDATORS)[number][];
  }, sample: ReturnType<typeof buildSamples>[number]) => void;
}> = {}) {
  const corpora = options.corpora ??
    CHANNEL_EVALUATION_CORPORA.map((definition) =>
      buildCorpus(definition.language),
    );
  const observations = corpora.flatMap((corpus) =>
    corpus.samples.map((sample) => {
      const observation = {
        sampleId: sample.id,
        corpusId: corpus.corpusId,
        corpusFingerprint: corpus.fingerprint,
        tupleFingerprint: buildTuple().tupleFingerprint,
        status: "completed" as const,
        predictedCategory: sample.category,
        draftProduced: false,
        validatorFailures: [] as (typeof VALIDATORS)[number][],
      };
      options.mutateObservation?.(observation, sample);
      return observation;
    }),
  );
  return {
    recordType: "channel-quality-gate-input-v1" as const,
    recordVersion: 1 as const,
    evaluatedAt: "2026-09-01T16:00:00.000Z",
    harness: options.harness ?? buildHarness(),
    tuple: buildTuple(),
    corpora,
    observations,
  };
}

describe("Channel quality and release gate", () => {
  it("passes complete frozen evidence for review without activating production", () => {
    const report = evaluateChannelQualityGate(buildInput());
    expect(report.decision).toBe("passed");
    expect(report.releaseReviewEligible).toBe(true);
    expect(report.productionActivationPerformed).toBe(false);
    expect(report.evaluationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    const { evaluationFingerprint, ...reportBody } = report;
    expect(channelQualityGateReportFingerprint(reportBody)).toBe(
      evaluationFingerprint,
    );
    expect(report.evaluatedTuple).toEqual(buildTuple());
    expect(
      report.harness?.status === "available"
        ? report.harness.artifact.sourceRevision
        : null,
    ).toBe("a".repeat(40));
    expect(report.failures).toEqual([]);
    expect(report.metrics.actionableAbusePrecision.overall.rate).toBe(1);
    expect(report.metrics.actionableAbusePrecision.overall.wilsonLower).toBeGreaterThan(
      0.98,
    );
    expect(report.metrics.allowedCriticismFalsePositive.overall.rate).toBe(0);
    expect(report.metrics.safetyFlagRecall.overall.rate).toBe(1);
    expect(report.metrics.safetyFlagDraftSuppression.overall.failures).toBe(0);
    expect(
      report.metrics.zeroToleranceFailures.byLanguage.english.instruction_echo,
    ).toBe(0);
  });

  it("fails closed and names every absent corpus when the harness is unavailable", () => {
    const english = buildCorpus("english");
    const report = evaluateChannelQualityGate(
      buildInput({
        harness: buildHarness("not_available"),
        corpora: [english],
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.releaseReviewEligible).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "harness_unavailable",
        "corpus_missing",
        "evaluation_samples_missing",
      ]),
    );
    expect(report.failures.filter((failure) => failure.code === "corpus_missing")).toHaveLength(
      3,
    );
  });

  it("reports statistical and zero-tolerance failures instead of hiding them in an aggregate", () => {
    const report = evaluateChannelQualityGate(
      buildInput({
        mutateObservation: (observation, sample) => {
          if (
            sample.language === "simplified_chinese" &&
            sample.category === "Allowed Criticism" &&
            sample.id.endsWith("0001")
          ) {
            observation.predictedCategory = "Actionable Abuse";
          }
          if (
            sample.language === "simplified_chinese" &&
            sample.category === "Allowed Criticism" &&
            sample.id.endsWith("0002")
          ) {
            observation.predictedCategory = "Actionable Abuse";
          }
          if (
            sample.language === "traditional_chinese" &&
            sample.category === "Safety Flag" &&
            sample.id.endsWith("0751")
          ) {
            observation.draftProduced = true;
          }
          if (
            sample.language === "chinese_english_code_switch" &&
            sample.zeroToleranceValidator === "privacy"
          ) {
            observation.validatorFailures = ["privacy"];
          }
        },
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "allowed_criticism_false_positive_wilson_upper_bound_above_threshold",
        "safety_flag_draft_produced",
        "zero_tolerance_validator_failure",
      ]),
    );
    expect(
      report.metrics.zeroToleranceFailures.byLanguage.chinese_english_code_switch
        .privacy,
    ).toBeGreaterThan(0);
  });

  it("blocks drafts produced for Allowed Criticism or Reviewable samples", () => {
    const report = evaluateChannelQualityGate(
      buildInput({
        mutateObservation: (observation, sample) => {
          if (
            sample.language === "english" &&
            sample.category === "Allowed Criticism" &&
            sample.id.endsWith("0001")
          ) {
            observation.draftProduced = true;
          }
        },
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "draft_produced_for_non_actionable_category",
          language: "english",
          category: "Allowed Criticism",
        }),
      ]),
    );
  });

  it("does not pass with missing observations or a tuple fingerprint mismatch", () => {
    const input = buildInput();
    input.observations.splice(0, 1);
    input.observations[0]!.tupleFingerprint = "b".repeat(64);

    const report = evaluateChannelQualityGate(input);

    expect(report.decision).toBe("blocked");
    expect(report.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "observation_tuple_mismatch",
        "evaluation_observations_missing",
      ]),
    );
  });

  it("checks corpus composition independently of model metrics", () => {
    const fullCorpora = CHANNEL_EVALUATION_CORPORA.map((definition) =>
      buildCorpus(definition.language),
    );
    const english = fullCorpora[0]!;
    const samples = english.samples.slice(0, 999);
    const underfilledEnglish = {
      ...english,
      samples,
      coverage: buildCoverage(samples),
    };
    const report = evaluateChannelQualityGate(
      buildInput({
        corpora: [underfilledEnglish, ...fullCorpora.slice(1)],
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "corpus_total_items_below_minimum",
          language: "english",
        }),
      ]),
    );
  });

  it("rejects impossible reviewer-provenance counts", () => {
    const fullCorpora = CHANNEL_EVALUATION_CORPORA.map((definition) =>
      buildCorpus(definition.language),
    );
    const english = fullCorpora[0]!;
    const report = evaluateChannelQualityGate(
      buildInput({
        corpora: [
          {
            ...english,
            coverage: {
              ...english.coverage,
              reviewerCompleteCount: english.coverage.totalItems + 1,
            },
          },
          ...fullCorpora.slice(1),
        ],
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "corpus_reviewer_provenance_incomplete",
          language: "english",
        }),
      ]),
    );
  });

  it("blocks Safety Flag recall below both point and Wilson thresholds", () => {
    const report = evaluateChannelQualityGate(
      buildInput({
        mutateObservation: (observation, sample) => {
          if (
            sample.language === "english" &&
            sample.category === "Safety Flag" &&
            Number(sample.id.slice(-4)) < 851
          ) {
            observation.predictedCategory = "Reviewable Interaction";
          }
        },
      }),
    );

    expect(report.decision).toBe("blocked");
    expect(report.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "safety_flag_recall_below_point_threshold",
        "safety_flag_recall_wilson_lower_bound_below_threshold",
      ]),
    );
  });

  it("adapts the governed English inventory without converting pending evidence into approval", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const projected = projectEnglishBlindCorpusForQualityGate(corpus);

    expect(projected.language).toBe("english");
    expect(projected.samples).toHaveLength(1_000);
    expect(projected.governance.status).toBe("blocked");
    expect(projected.governance.blockers).toEqual(
      expect.arrayContaining([
        "reviewer_provenance_incomplete",
        "approval_not_recorded",
        "freeze_not_recorded",
        "upstream_harness_unavailable",
      ]),
    );
    expect(projected.approval.status).toBe("not_recorded");
    expect(projected.freeze.status).toBe("not_recorded");
  });

  it("rejects malformed gate records at the public input seam", () => {
    expect(ChannelQualityGateInputSchema.safeParse({}).success).toBe(false);
    expect(
      ChannelQualityGateTupleSchema.safeParse({
        ...buildTuple(),
        modelIdentifier: "pending",
      }).success,
    ).toBe(false);
    const report = evaluateChannelQualityGate({});
    expect(report.decision).toBe("blocked");
    expect(report.failures[0]?.code).toBe("quality_gate_input_schema_invalid");
  });

  it("rejects a passing harness artifact with incomplete evidence", () => {
    const harness = buildHarness("available");
    if (harness.status !== "available") {
      throw new Error("expected an available harness fixture");
    }
    const input = buildInput({ harness });
    const artifact = harness.artifact;
    const incompleteArtifact = { ...artifact, metrics: null };
    const body = { ...incompleteArtifact };
    Reflect.deleteProperty(body, "evaluationFingerprint");
    harness.artifact = {
      ...artifact,
      metrics: null,
      evaluationFingerprint: hashChannelQualityValue(body),
    };

    const report = evaluateChannelQualityGate(input);

    expect(report.decision).toBe("blocked");
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "harness_artifact_incomplete" }),
      ]),
    );
  });

  it("preserves each failed slice reported by the upstream harness", () => {
    const harness = buildHarness("available");
    if (harness.status !== "available") {
      throw new Error("expected an available harness fixture");
    }
    const failedArtifact = {
      ...harness.artifact,
      outcome: "failed" as const,
      gate: {
        outcome: "failed" as const,
        failures: [
          {
            code: "safety_flag_recall",
            scope: "language:traditional_chinese",
            detail: "the Wilson lower bound is below the release threshold",
            category: "safety_flag_recall",
          },
        ],
      },
    };
    const body = { ...failedArtifact };
    Reflect.deleteProperty(body, "evaluationFingerprint");
    harness.artifact = {
      ...failedArtifact,
      evaluationFingerprint: hashChannelQualityValue(body),
    };

    const report = evaluateChannelQualityGate(buildInput({ harness }));

    expect(report.decision).toBe("blocked");
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "harness_safety_flag_recall",
          category: "safety_flag_recall",
          message: expect.stringContaining("traditional_chinese"),
        }),
      ]),
    );
  });

  it("requires meaningful clause evidence for the code-switch slice", () => {
    const corpus = buildCorpus("chinese_english_code_switch");
    const invalidSamples = corpus.samples.map((sample, index) =>
      index === 0 ? { ...sample, codeSwitchEvidence: null } : sample,
    );

    expect(
      ChannelQualityGateInputSchema.safeParse(
        buildInput({
          corpora: [
            buildCorpus("english"),
            buildCorpus("simplified_chinese"),
            buildCorpus("traditional_chinese"),
            { ...corpus, samples: invalidSamples },
          ],
        }),
      ).success,
    ).toBe(false);
  });
});
