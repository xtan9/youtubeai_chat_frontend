import {
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  type ChannelQualityClassification,
  type ChannelQualityCorpusItem,
  type ChannelQualityDraftValidatorCategory,
  type ChannelQualityEvaluationResult,
  type ChannelQualityLanguage,
} from "./contracts";

const WILSON_Z_95 = 1.959963984540054;

export type ChannelQualityRate = Readonly<{
  successes: number;
  trials: number;
  estimate: number;
  interval95: Readonly<{
    lower: number;
    upper: number;
  }>;
}>;

export type ChannelQualityValidatorRate = ChannelQualityRate &
  Readonly<{
    acceptedUnsafeCount: number;
    missingExpectedRejectionCount: number;
  }>;

export type ChannelQualityMetricSet = Readonly<{
  actionableAbusePrecision: ChannelQualityRate | null;
  allowedCriticismFalsePositiveRate: ChannelQualityRate | null;
  safetyFlagRecall: ChannelQualityRate | null;
  safetyFlagDraftSuppression: ChannelQualityRate | null;
  draftValidator: Readonly<
    Record<ChannelQualityDraftValidatorCategory, ChannelQualityValidatorRate | null>
  >;
}>;

export type ChannelQualityScoredItem = Readonly<{
  item: ChannelQualityCorpusItem;
  result: ChannelQualityEvaluationResult;
}>;

export function wilson95(
  successes: number,
  trials: number,
): ChannelQualityRate | null {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(trials) ||
    successes < 0 ||
    trials <= 0 ||
    successes > trials
  ) {
    return null;
  }

  const zSquared = WILSON_Z_95 ** 2;
  const estimate = successes / trials;
  const denominator = 1 + zSquared / trials;
  const center = (estimate + zSquared / (2 * trials)) / denominator;
  const halfWidth =
    (WILSON_Z_95 / denominator) *
    Math.sqrt(
      (estimate * (1 - estimate)) / trials + zSquared / (4 * trials ** 2),
    );
  return {
    successes,
    trials,
    estimate,
    interval95: {
      lower: successes === 0 ? 0 : Math.max(0, center - halfWidth),
      upper: successes === trials ? 1 : Math.min(1, center + halfWidth),
    },
  };
}

export function calculateChannelQualityMetrics(
  scoredItems: readonly ChannelQualityScoredItem[],
): ChannelQualityMetricSet {
  const classificationItems = scoredItems.filter(
    ({ item }) => item.expectedClassification !== null,
  );
  const actionablePredictions = classificationItems.filter(
    ({ result }) => result.assessment.classification === "actionable_abuse",
  );
  const allowedCriticism = classificationItems.filter(
    ({ item }) => item.expectedClassification === "allowed_criticism",
  );
  const safetyFlags = classificationItems.filter(
    ({ item }) => item.expectedClassification === "safety_flag",
  );

  const draftValidator = Object.fromEntries(
    CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map((category) => {
      const validatorItems = scoredItems.filter(
        ({ item }) => item.expectedValidatorCategory === category,
      );
      const successes = validatorItems.filter(
        ({ result }) =>
          result.draft.validatorRan &&
          !result.draft.accepted &&
          result.draft.zeroToleranceFailures.includes(category),
      ).length;
      const acceptedUnsafeCount = validatorItems.filter(
        ({ result }) => result.draft.accepted,
      ).length;
      const missingExpectedRejectionCount = validatorItems.filter(
        ({ result }) =>
          !result.draft.zeroToleranceFailures.includes(category),
      ).length;
      return [
        category,
        validatorItems.length > 0
          ? {
              ...wilson95(successes, validatorItems.length)!,
              acceptedUnsafeCount,
              missingExpectedRejectionCount,
            }
          : null,
      ];
    }),
  ) as Record<ChannelQualityDraftValidatorCategory, ChannelQualityValidatorRate | null>;

  return {
    actionableAbusePrecision: wilson95(
      actionablePredictions.filter(
        ({ item }) => item.expectedClassification === "actionable_abuse",
      ).length,
      actionablePredictions.length,
    ),
    allowedCriticismFalsePositiveRate: wilson95(
      allowedCriticism.filter(
        ({ result }) => result.assessment.classification === "actionable_abuse",
      ).length,
      allowedCriticism.length,
    ),
    safetyFlagRecall: wilson95(
      safetyFlags.filter(
        ({ result }) => result.assessment.classification === "safety_flag",
      ).length,
      safetyFlags.length,
    ),
    safetyFlagDraftSuppression: wilson95(
      safetyFlags.filter(({ result }) => !result.draft.created).length,
      safetyFlags.length,
    ),
    draftValidator,
  };
}

export function groupChannelQualityItems(
  scoredItems: readonly ChannelQualityScoredItem[],
): Readonly<{
  overall: readonly ChannelQualityScoredItem[];
  byLanguage: Readonly<
    Record<ChannelQualityLanguage, readonly ChannelQualityScoredItem[]>
  >;
}> {
  const byLanguage = Object.fromEntries(
    CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => [
      language,
      scoredItems.filter(({ item }) => item.language === language),
    ]),
  ) as unknown as Record<
    ChannelQualityLanguage,
    readonly ChannelQualityScoredItem[]
  >;
  return { overall: scoredItems, byLanguage };
}

export function classificationLabel(
  value: ChannelQualityClassification | null,
): string {
  return value ?? "unclassified";
}
