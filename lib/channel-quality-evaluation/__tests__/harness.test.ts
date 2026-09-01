import { describe, expect, it } from "vitest";

import {
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  createChannelQualityCorpusItem,
  createChannelQualityEvaluationResult,
  createChannelQualityResultBundle,
  evaluateChannelQualityRelease,
  freezeChannelQualityCorpus,
  wilson95,
  verifyChannelQualityEvaluationFingerprint,
  type ChannelQualityClassification,
  type ChannelQualityCorpusItem,
  type ChannelQualityCorpusManifest,
  type ChannelQualityLanguage,
} from "../index";

const POLICY_VERSION = "youtube-community-guidelines-2026-08-31";
const SOURCE_REVISION = "a".repeat(40);
const VERSIONS = {
  modelVersion: "fixture-channel-model-v1",
  promptVersion: "interaction-assessment-prompt-v1",
  taxonomyVersion: "interaction-taxonomy-v1",
  schemaVersion: "channel-assessment-result-v1",
  validatorVersion: "reply-draft-validator-v1",
} as const;

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

const CLASSIFICATIONS: readonly ChannelQualityClassification[] = [
  "allowed_criticism",
  "actionable_abuse",
  "reviewable_interaction",
  "safety_flag",
];

function createItem(input: Readonly<{
  id: string;
  kind: "classification" | "adversarial" | "validator";
  language: ChannelQualityLanguage;
  expectedClassification: ChannelQualityClassification | null;
  expectedValidatorCategory: (typeof CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES)[number] | null;
  index: number;
}>): ChannelQualityCorpusItem {
  return createChannelQualityCorpusItem({
    id: input.id,
    kind: input.kind,
    language: input.language,
    expectedClassification: input.expectedClassification,
    expectedValidatorCategory: input.expectedValidatorCategory,
    crossCuts: [...CHANNEL_QUALITY_REQUIRED_CROSS_CUTS],
    input: {
      commentText: `Synthetic frozen comment ${input.id}`,
      videoTitle: `Synthetic frozen video ${input.index}`,
    },
    codeSwitchEvidence:
      input.language === "chinese_english_code_switch"
        ? {
            englishClause: "This explanation needs more detail",
            chineseClause: "这个解释需要更多细节",
            independentlyMeaningful: true,
            reviewedBy: "reviewer-primary",
          }
        : null,
  });
}

function createCorpus(
  split: "development" | "blind",
  prefix: string,
): ChannelQualityCorpusManifest {
  const items: ChannelQualityCorpusItem[] = [];
  for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
    let index = 0;
    const add = (
      kind: "classification" | "adversarial" | "validator",
      expectedClassification: ChannelQualityClassification | null,
      expectedValidatorCategory: (typeof CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES)[number] | null,
    ) => {
      items.push(
        createItem({
          id: `${prefix}-${language}-${kind}-${index}`,
          kind,
          language,
          expectedClassification,
          expectedValidatorCategory,
          index,
        }),
      );
      index += 1;
    };

    for (const [classification, count] of [
      ["allowed_criticism", 300],
      ["actionable_abuse", 250],
      ["reviewable_interaction", 200],
      ["safety_flag", 200],
    ] as const) {
      for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
        add(classification === "safety_flag" ? "classification" : "classification", classification, null);
      }
    }
    for (let itemIndex = 0; itemIndex < 50; itemIndex += 1) {
      add("adversarial", CLASSIFICATIONS[itemIndex % CLASSIFICATIONS.length]!, null);
    }
    for (let itemIndex = 0; itemIndex < 250; itemIndex += 1) {
      add(
        "validator",
        null,
        CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES[
          itemIndex % CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.length
        ]!,
      );
    }
  }

  return freezeChannelQualityCorpus({
    manifestVersion: "channel-quality-corpus-manifest-v1",
    corpusVersion: "channel-comment-assistance-v1",
    split,
    frozenAt: "2026-08-31T12:00:00.000Z",
    policyVersion: POLICY_VERSION,
    dataGovernance: "synthetic",
    reviewers: REVIEWERS,
    items,
  });
}

function resultFor(
  corpusItem: ChannelQualityCorpusItem,
  overrides: Readonly<{
    classification?: ChannelQualityClassification | null;
    generated?: boolean;
  }> = {},
) {
  const isValidator = corpusItem.kind === "validator";
  const generated = overrides.generated ?? (isValidator ? true : false);
  const expectedValidatorCategory = corpusItem.expectedValidatorCategory;
  return createChannelQualityEvaluationResult({
    itemId: corpusItem.id,
    status: "complete",
    assessment: {
      classification:
        overrides.classification ?? corpusItem.expectedClassification,
      schemaValid: true,
    },
    draft: isValidator
      ? {
          generated,
          created: false,
          validatorRan: true,
          accepted: false,
          zeroToleranceFailures: expectedValidatorCategory
            ? [expectedValidatorCategory]
            : [],
          otherFailure: false,
        }
      : {
          generated,
          created: generated,
          validatorRan: generated,
          accepted: generated,
          zeroToleranceFailures: [],
          otherFailure: false,
        },
  });
}

function releaseInput(overrides: Readonly<Record<string, unknown>> = {}) {
  const development = createCorpus("development", "development");
  const blind = createCorpus("blind", "blind");
  const results = blind.items.map((corpusItem) => resultFor(corpusItem));
  const resultBundle = createChannelQualityResultBundle({
    corpusManifestHash: blind.manifestHash,
    results,
  });
  return {
    developmentCorpus: development,
    blindCorpus: blind,
    results: resultBundle,
    versions: VERSIONS,
    policyVersion: POLICY_VERSION,
    tupleSelectedAt: "2026-08-31T12:30:00.000Z",
    sourceRevision: SOURCE_REVISION,
    evaluatedAt: "2026-08-31T13:00:00.000Z",
    ...overrides,
  };
}

describe("Channel quality release evidence", { timeout: 30_000 }, () => {
  it("reports deterministic point estimates and Wilson intervals at every required slice", () => {
    const artifact = evaluateChannelQualityRelease(releaseInput());

    expect(artifact.gate).toEqual({ outcome: "passed", failures: [] });
    expect(artifact.outcome).toBe("passed");
    expect(artifact.versions).toEqual(VERSIONS);
    expect(artifact.policyVersion).toBe(POLICY_VERSION);
    expect(artifact.thresholds.actionableAbusePrecision.overallPointMinimum).toBe(
      0.95,
    );
    expect(artifact.corpora.blind?.frozenAt).toBe(
      "2026-08-31T12:00:00.000Z",
    );
    expect(artifact.corpora.blind?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.metrics?.overall.actionableAbusePrecision).toMatchObject({
      successes: 1_052,
      trials: 1_052,
      estimate: 1,
    });
    expect(
      artifact.metrics?.overall.actionableAbusePrecision?.interval95.lower,
    ).toBeGreaterThan(0.99);
    expect(artifact.metrics?.overall.allowedCriticismFalsePositiveRate).toMatchObject({
      successes: 0,
      trials: 1_252,
      estimate: 0,
      interval95: { lower: 0, upper: expect.any(Number) },
    });
    expect(artifact.metrics?.overall.safetyFlagRecall).toMatchObject({
      successes: 848,
      trials: 848,
      estimate: 1,
    });
    expect(artifact.metrics?.overall.safetyFlagDraftSuppression).toMatchObject({
      successes: 848,
      trials: 848,
      estimate: 1,
    });
    for (const category of CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES) {
      const metric = artifact.metrics?.overall.draftValidator[category];
      expect(metric).not.toBeNull();
      expect(metric?.trials).toBeGreaterThan(0);
      expect(metric?.successes).toBe(metric?.trials);
      expect(metric?.acceptedUnsafeCount).toBe(0);
    }
    for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
      for (const category of CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES) {
        expect(
          artifact.metrics?.byLanguage[language].draftValidator[category],
        ).not.toBeNull();
      }
    }
    expect(Object.keys(artifact.metrics?.byLanguage ?? {})).toEqual(
      expect.arrayContaining([...CHANNEL_QUALITY_SUPPORTED_LANGUAGES]),
    );
    expect(Object.keys(artifact.metrics?.byCrossCut ?? {})).toEqual(
      expect.arrayContaining([...CHANNEL_QUALITY_REQUIRED_CROSS_CUTS]),
    );
    for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
      expect(
        artifact.composition.blind?.perLanguage[language].classificationByLabel,
      ).toEqual({
        allowed_criticism: 300,
        reviewable_interaction: 200,
        actionable_abuse: 250,
        safety_flag: 200,
      });
      expect(
        Object.keys(
          artifact.composition.blind?.perLanguage[language]
            .validatorByCategory ?? {},
        ),
      ).toEqual(
        expect.arrayContaining([
          ...CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
        ]),
      );
      expect(
        artifact.metrics?.byLanguage[language].actionableAbusePrecision,
      ).not.toBeNull();
    }
    for (const crossCut of CHANNEL_QUALITY_REQUIRED_CROSS_CUTS) {
      expect(
        artifact.metrics?.byCrossCut[crossCut].safetyFlagRecall,
      ).not.toBeNull();
    }
    expect(artifact.reproducibility.status).toBe("verified");
    expect(verifyChannelQualityEvaluationFingerprint(artifact)).toBe(true);
    expect(
      evaluateChannelQualityRelease(releaseInput()).reproducibility.inputFingerprint,
    ).toBe(artifact.reproducibility.inputFingerprint);
  }, 30_000);

  it("fails the gate when a Safety Flag sample receives a draft", () => {
    const input = releaseInput();
    const badSafetyItem = input.blindCorpus.items.find(
      (corpusItem) => corpusItem.expectedClassification === "safety_flag",
    )!;
    const results = input.blindCorpus.items.map((corpusItem) =>
        corpusItem.id === badSafetyItem.id
        ? resultFor(corpusItem, { generated: true })
        : resultFor(corpusItem),
    );
    const artifact = evaluateChannelQualityRelease({
      ...input,
      results: createChannelQualityResultBundle({
        corpusManifestHash: input.blindCorpus.manifestHash,
        results,
      }),
    });

    expect(artifact.outcome).toBe("failed");
    expect(artifact.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "safety_flag_draft_suppression",
          scope: "overall",
        }),
      ]),
    );
    expect(artifact.metrics?.overall.safetyFlagDraftSuppression).toMatchObject({
      successes: 847,
      trials: 848,
    });
  });

  it("fails closed for missing, malformed, and non-reproducible result evidence", () => {
    const input = releaseInput();
    const incomplete = createChannelQualityResultBundle({
      corpusManifestHash: input.blindCorpus.manifestHash,
      results: input.results.results.slice(0, -1),
    });
    const incompleteArtifact = evaluateChannelQualityRelease({
      ...input,
      results: incomplete,
    });
    expect(incompleteArtifact.outcome).toBe("failed");
    expect(incompleteArtifact.metrics).toBeNull();
    expect(incompleteArtifact.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "incomplete_results" }),
      ]),
    );

    const malformedResult = createChannelQualityEvaluationResult({
      ...input.results.results[0]!,
      status: "malformed",
    });
    const malformed = createChannelQualityResultBundle({
      corpusManifestHash: input.blindCorpus.manifestHash,
      results: [malformedResult, ...input.results.results.slice(1)],
    });
    const malformedArtifact = evaluateChannelQualityRelease({
      ...input,
      results: malformed,
    });
    expect(malformedArtifact.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "malformed_result" }),
      ]),
    );

    const nonReproducible = {
      ...input.results,
      resultSetHash: "0".repeat(64),
    };
    const nonReproducibleArtifact = evaluateChannelQualityRelease({
      ...input,
      results: nonReproducible,
    });
    expect(nonReproducibleArtifact.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "result_bundle_hash_mismatch" }),
      ]),
    );
    expect(nonReproducibleArtifact.reproducibility.status).toBe("not_verified");
  });

  it("does not accept placeholder version names as exact tuple evidence", () => {
    const artifact = evaluateChannelQualityRelease(
      releaseInput({
        versions: {
          ...VERSIONS,
          modelVersion: "latest",
        },
      }),
    );

    expect(artifact.outcome).toBe("failed");
    expect(artifact.metrics).toBeNull();
    expect(artifact.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "version_tuple_malformed" }),
      ]),
    );
  });

  it("fails closed when tuple selection occurs after evaluation", () => {
    const artifact = evaluateChannelQualityRelease(
      releaseInput({
        tupleSelectedAt: "2026-08-31T13:00:01.000Z",
      }),
    );

    expect(artifact.outcome).toBe("failed");
    expect(artifact.metrics).toBeNull();
    expect(artifact.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "tuple_selected_after_evaluation" }),
      ]),
    );
  });

  it("uses the two-sided 95% Wilson interval and rejects unestimable rates", () => {
    expect(wilson95(1, 1)).toMatchObject({
      successes: 1,
      trials: 1,
      estimate: 1,
      interval95: {
        lower: expect.closeTo(0.2065, 3),
        upper: 1,
      },
    });
    expect(wilson95(0, 1)).toMatchObject({
      estimate: 0,
      interval95: { lower: 0, upper: expect.closeTo(0.7935, 3) },
    });
    expect(wilson95(0, 0)).toBeNull();
    expect(wilson95(2, 1)).toBeNull();
  });
});
