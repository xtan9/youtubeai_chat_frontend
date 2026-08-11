import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import {
  SemanticProfileSchema,
  type SemanticProfile,
} from "./semantic-profile";

export const SEMANTIC_PROFILE_EVALUATION_TRIALS = 2;

export type ContinuationRelationship =
  | "deeper_explanation"
  | "prerequisite"
  | "practical_application"
  | "credible_alternative";

export type SemanticProfileEvaluationCase = Readonly<{
  id: string;
  language: SupportedLanguageCode;
  text: string;
  expectedSourceId?: string;
  falseNeighborFor?: string;
  relationship?: ContinuationRelationship;
  candidateSource?: boolean;
}>;

// This corpus is intentionally small, synthetic, and fixed. It is an
// activation evidence gate for one versioned prompt, not a general quality
// claim about a Gateway model.
export const SEMANTIC_PROFILE_EVALUATION_CASES: readonly SemanticProfileEvaluationCase[] = [
  {
    id: "ml-source",
    language: "en",
    text: "A visual introduction to neural networks and gradient descent.",
    candidateSource: true,
  },
  {
    id: "ml-es",
    language: "es",
    text: "Introducción visual a las redes neuronales y el descenso de gradiente.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-pt",
    language: "pt",
    text: "Introdução visual às redes neurais e à descida do gradiente.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-it",
    language: "it",
    text: "Introduzione visiva alle reti neurali e alla discesa del gradiente.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-fr",
    language: "fr",
    text: "Introduction visuelle aux réseaux neuronaux et à la descente de gradient.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-de",
    language: "de",
    text: "Visuelle Einführung in neuronale Netze und Gradientenabstieg.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-id",
    language: "id",
    text: "Pengantar visual jaringan saraf dan penurunan gradien.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-zh",
    language: "zh",
    text: "神经网络与梯度下降的可视化入门。",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-zh-tw",
    language: "zh-TW",
    text: "神經網路與梯度下降的視覺化入門。",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-ja",
    language: "ja",
    text: "ニューラルネットワークと勾配降下法の視覚的な入門。",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-ko",
    language: "ko",
    text: "신경망과 경사 하강법을 시각적으로 소개합니다.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-ar",
    language: "ar",
    text: "مقدمة مرئية للشبكات العصبية والانحدار المتدرج.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-hi",
    language: "hi",
    text: "न्यूरल नेटवर्क और ग्रेडिएंट डिसेंट का दृश्य परिचय।",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-bn",
    language: "bn",
    text: "নিউরাল নেটওয়ার্ক ও গ্রেডিয়েন্ট ডিসেন্টের দৃশ্যভিত্তিক পরিচিতি।",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-ru",
    language: "ru",
    text: "Наглядное введение в нейронные сети и градиентный спуск.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-vi",
    language: "vi",
    text: "Giới thiệu trực quan về mạng nơ-ron và hạ gradient.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-tr",
    language: "tr",
    text: "Sinir ağları ve gradyan inişine görsel bir giriş.",
    expectedSourceId: "ml-source",
  },
  {
    id: "ml-th",
    language: "th",
    text: "บทนำแบบภาพเกี่ยวกับโครงข่ายประสาทและการไล่ระดับสี",
    expectedSourceId: "ml-source",
  },
  {
    id: "relationship-deeper",
    language: "en",
    text: "A detailed visual derivation of gradient descent in neural network training.",
    expectedSourceId: "ml-source",
    relationship: "deeper_explanation",
  },
  {
    id: "relationship-deeper-es",
    language: "es",
    text: "Una derivación visual detallada del descenso de gradiente para entrenar redes neuronales.",
    expectedSourceId: "ml-source",
    relationship: "deeper_explanation",
  },
  {
    id: "relationship-prerequisite",
    language: "en",
    text: "Linear algebra and calculus foundations needed before neural networks and gradient descent.",
    expectedSourceId: "ml-source",
    relationship: "prerequisite",
  },
  {
    id: "relationship-prerequisite-ja",
    language: "ja",
    text: "ニューラルネットワークと勾配降下法を学ぶ前に必要な線形代数と微積分。",
    expectedSourceId: "ml-source",
    relationship: "prerequisite",
  },
  {
    id: "relationship-application",
    language: "en",
    text: "Apply neural networks and gradient descent to build an image classifier.",
    expectedSourceId: "ml-source",
    relationship: "practical_application",
  },
  {
    id: "relationship-application-ar",
    language: "ar",
    text: "تطبيق الشبكات العصبية والانحدار المتدرج لبناء مصنف للصور.",
    expectedSourceId: "ml-source",
    relationship: "practical_application",
  },
  {
    id: "relationship-alternative",
    language: "en",
    text: "Compare gradient descent with evolutionary optimization as an alternative for training neural networks.",
    expectedSourceId: "ml-source",
    relationship: "credible_alternative",
  },
  {
    id: "relationship-alternative-hi",
    language: "hi",
    text: "न्यूरल नेटवर्क प्रशिक्षण के लिए ग्रेडिएंट डिसेंट की तुलना विकासवादी अनुकूलन विकल्प से करें।",
    expectedSourceId: "ml-source",
    relationship: "credible_alternative",
  },
  {
    id: "false-baking",
    language: "en",
    text: "Decorating a layered chocolate cake with buttercream flowers.",
    falseNeighborFor: "ml-source",
    candidateSource: true,
  },
  {
    id: "false-gradient-network",
    language: "en",
    text: "A visual color gradient maps the bakery delivery network for layered cakes; this is not machine learning.",
    falseNeighborFor: "ml-source",
    candidateSource: true,
  },
] as const;

export const SEMANTIC_PROFILE_EVALUATION_THRESHOLDS = {
  schemaValidityRate: 1,
  multilingualConceptNormalization: 0.9,
  usefulNeighborRecall: 0.9,
  falseNeighborRejection: 0.95,
  representativeSourceCoverage: 1,
  relationshipCoverage: 1,
  repeatConsistency: 0.95,
  responseModelConsistency: 1,
  maximumP95LatencyMs: 30_000,
} as const;

export type SemanticProfileTokenUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}>;

export type SemanticProfileEvaluationObservation = Readonly<{
  caseId: string;
  trial: number;
  latencyMs: number;
  profile?: SemanticProfile;
  usage?: SemanticProfileTokenUsage;
  responseModel?: string;
  errorCode?: string;
}>;

export type SemanticProfileEvaluationPricing = Readonly<{
  inputMicroUsdPerMillionTokens: number;
  cachedInputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
}>;

type FailedGate =
  | "schema_validity"
  | "multilingual_concept_normalization"
  | "useful_neighbor_recall"
  | "false_neighbor_rejection"
  | "representative_source_coverage"
  | "relationship_coverage"
  | "repeat_consistency"
  | "response_model_consistency"
  | "p95_latency"
  | "usage_completeness";

type ValidObservation = SemanticProfileEvaluationObservation & Readonly<{
  profile: SemanticProfile;
}>;

export function evaluateSemanticProfileEvidence(input: Readonly<{
  observations: readonly SemanticProfileEvaluationObservation[];
  pricing: SemanticProfileEvaluationPricing;
}>) {
  const observations = validateObservationMatrix(input.observations);
  const validByKey = new Map<string, ValidObservation>();
  const validLanguages = new Set<SupportedLanguageCode>();

  for (const observation of observations) {
    const benchmarkCase = CASES_BY_ID.get(observation.caseId)!;
    const parsed = SemanticProfileSchema.safeParse(observation.profile);
    if (
      parsed.success &&
      parsed.data.sourceLanguage === benchmarkCase.language
    ) {
      validByKey.set(observationKey(observation.caseId, observation.trial), {
        ...observation,
        profile: parsed.data,
      });
      validLanguages.add(benchmarkCase.language);
    }
  }

  const expectedMatches = SEMANTIC_PROFILE_EVALUATION_CASES.filter(
    (benchmarkCase) => benchmarkCase.expectedSourceId,
  ).flatMap((benchmarkCase) =>
    trialNumbers().map((trial) => ({ benchmarkCase, trial })),
  );
  const usefulMatches = expectedMatches.filter(({ benchmarkCase, trial }) => {
    const query = validByKey.get(observationKey(benchmarkCase.id, trial));
    if (!query) return false;
    const ranked = SEMANTIC_PROFILE_EVALUATION_CASES.filter(
      (candidate) => candidate.candidateSource,
    )
      .flatMap((candidate) => {
        const observation = validByKey.get(observationKey(candidate.id, trial));
        return observation
          ? [
              {
                id: candidate.id,
                score: semanticProfileOverlapScore(
                  observation.profile,
                  query.profile,
                ),
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.id.localeCompare(right.id),
      );
    return (
      ranked[0]?.id === benchmarkCase.expectedSourceId &&
      ranked[0].score > 0
    );
  });

  const crossLanguageMatches = expectedMatches.filter(
    ({ benchmarkCase }) => {
      const source = CASES_BY_ID.get(benchmarkCase.expectedSourceId!);
      return source?.language !== benchmarkCase.language;
    },
  );
  const normalizedMatches = crossLanguageMatches.filter(
    ({ benchmarkCase, trial }) => {
      const query = validByKey.get(observationKey(benchmarkCase.id, trial));
      const source = validByKey.get(
        observationKey(benchmarkCase.expectedSourceId!, trial),
      );
      return (
        query !== undefined &&
        source !== undefined &&
        canonicalConceptOverlap(query.profile, source.profile) > 0
      );
    },
  );

  const relationshipMatches = expectedMatches.filter(
    ({ benchmarkCase }) => benchmarkCase.relationship,
  );
  const usefulKeys = new Set(
    usefulMatches.map(({ benchmarkCase, trial }) =>
      observationKey(benchmarkCase.id, trial),
    ),
  );
  const falseNeighborPairs = SEMANTIC_PROFILE_EVALUATION_CASES.filter(
    (benchmarkCase) => benchmarkCase.falseNeighborFor,
  ).flatMap((benchmarkCase) =>
    trialNumbers().map((trial) => ({ benchmarkCase, trial })),
  );
  const rejectedFalseNeighbors = falseNeighborPairs.filter(
    ({ benchmarkCase, trial }) => {
      const falseNeighbor = validByKey.get(
        observationKey(benchmarkCase.id, trial),
      );
      const source = validByKey.get(
        observationKey(benchmarkCase.falseNeighborFor!, trial),
      );
      return (
        falseNeighbor !== undefined &&
        source !== undefined &&
        semanticProfileOverlapScore(falseNeighbor.profile, source.profile) ===
          0 &&
        semanticProfileOverlapScore(source.profile, falseNeighbor.profile) === 0
      );
    },
  );
  const consistentCases = SEMANTIC_PROFILE_EVALUATION_CASES.filter(
    (benchmarkCase) => {
      const first = validByKey.get(observationKey(benchmarkCase.id, 1));
      const second = validByKey.get(observationKey(benchmarkCase.id, 2));
      return (
        first !== undefined &&
        second !== undefined &&
        canonicalConceptOverlap(first.profile, second.profile) > 0
      );
    },
  );

  const latencies = observations
    .map((observation) => observation.latencyMs)
    .filter((latency) => Number.isFinite(latency) && latency >= 0)
    .sort((left, right) => left - right);
  const usage = totalTokenUsage(observations, input.pricing);
  const responseModelCounts = new Map<string, number>();
  for (const observation of observations) {
    const responseModel = observation.responseModel?.trim();
    if (responseModel) {
      responseModelCounts.set(
        responseModel,
        (responseModelCounts.get(responseModel) ?? 0) + 1,
      );
    }
  }
  const responseModelConsistency = ratio(
    Math.max(0, ...responseModelCounts.values()),
    observations.length,
  );
  const metrics = {
    schema_validity_rate: ratio(validByKey.size, observations.length),
    multilingual_concept_normalization: ratio(
      normalizedMatches.length,
      crossLanguageMatches.length,
    ),
    useful_neighbor_recall: ratio(
      usefulMatches.length,
      expectedMatches.length,
    ),
    false_neighbor_rejection: ratio(
      rejectedFalseNeighbors.length,
      falseNeighborPairs.length,
    ),
    latency_ms_p95:
      latencies[Math.ceil(latencies.length * 0.95) - 1] ?? 0,
    token_cost_totals: usage,
    retry_dead_letter_behavior: {
      policy: "bounded",
      max_attempts: 4,
      unknown_request_identity: "quarantined",
      identified_failure: "retry_then_dead_letter",
      required_fixture_paths: [
        "supabase/test-fixtures/regression_structured_semantic_profiles.sql",
        "supabase/test-fixtures/regression_structured_semantic_profiles_concurrency.sql",
      ],
    },
    representative_source_coverage: ratio(
      validLanguages.size,
      SUPPORTED_LANGUAGE_CODES.length,
    ),
    relationship_coverage: ratio(
      relationshipMatches.filter(({ benchmarkCase, trial }) =>
        usefulKeys.has(observationKey(benchmarkCase.id, trial)),
      ).length,
      relationshipMatches.length,
    ),
    repeat_consistency: ratio(
      consistentCases.length,
      SEMANTIC_PROFILE_EVALUATION_CASES.length,
    ),
    response_model_consistency: responseModelConsistency,
    response_models: [...responseModelCounts.keys()].sort(),
  } as const;

  const failedGates: FailedGate[] = [];
  const thresholds = SEMANTIC_PROFILE_EVALUATION_THRESHOLDS;
  if (metrics.schema_validity_rate < thresholds.schemaValidityRate)
    failedGates.push("schema_validity");
  if (
    metrics.multilingual_concept_normalization <
    thresholds.multilingualConceptNormalization
  )
    failedGates.push("multilingual_concept_normalization");
  if (metrics.useful_neighbor_recall < thresholds.usefulNeighborRecall)
    failedGates.push("useful_neighbor_recall");
  if (metrics.false_neighbor_rejection < thresholds.falseNeighborRejection)
    failedGates.push("false_neighbor_rejection");
  if (
    metrics.representative_source_coverage <
    thresholds.representativeSourceCoverage
  )
    failedGates.push("representative_source_coverage");
  if (metrics.relationship_coverage < thresholds.relationshipCoverage)
    failedGates.push("relationship_coverage");
  if (metrics.repeat_consistency < thresholds.repeatConsistency)
    failedGates.push("repeat_consistency");
  if (
    metrics.response_model_consistency < thresholds.responseModelConsistency
  )
    failedGates.push("response_model_consistency");
  if (metrics.latency_ms_p95 > thresholds.maximumP95LatencyMs)
    failedGates.push("p95_latency");
  if (usage.missing_usage_count > 0)
    failedGates.push("usage_completeness");

  return {
    requestCount: observations.length,
    metrics,
    automatedGate: {
      outcome: failedGates.length === 0 ? "passed" : "failed",
      failedGates,
    },
  } as const;
}

const CASES_BY_ID = new Map(
  SEMANTIC_PROFILE_EVALUATION_CASES.map((benchmarkCase) => [
    benchmarkCase.id,
    benchmarkCase,
  ]),
);

function trialNumbers(): readonly number[] {
  return Array.from(
    { length: SEMANTIC_PROFILE_EVALUATION_TRIALS },
    (_, index) => index + 1,
  );
}

function observationKey(caseId: string, trial: number): string {
  return `${caseId}:${trial}`;
}

function validateObservationMatrix(
  observations: readonly SemanticProfileEvaluationObservation[],
): readonly SemanticProfileEvaluationObservation[] {
  const expectedCount =
    SEMANTIC_PROFILE_EVALUATION_CASES.length *
    SEMANTIC_PROFILE_EVALUATION_TRIALS;
  if (observations.length !== expectedCount) {
    throw new Error(
      `Semantic Profile evaluation requires exactly ${expectedCount} observations`,
    );
  }
  const seen = new Set<string>();
  for (const observation of observations) {
    const key = observationKey(observation.caseId, observation.trial);
    if (
      !CASES_BY_ID.has(observation.caseId) ||
      observation.trial < 1 ||
      observation.trial > SEMANTIC_PROFILE_EVALUATION_TRIALS ||
      !Number.isInteger(observation.trial) ||
      seen.has(key)
    ) {
      throw new Error("Semantic Profile evaluation observation matrix is invalid");
    }
    seen.add(key);
  }
  return observations;
}

function canonicalConceptOverlap(
  left: SemanticProfile,
  right: SemanticProfile,
): number {
  const leftKeys = new Set([
    ...left.topics.map((concept) => concept.key),
    ...left.coreConcepts.map((concept) => concept.key),
  ]);
  const rightKeys = new Set([
    ...right.topics.map((concept) => concept.key),
    ...right.coreConcepts.map((concept) => concept.key),
  ]);
  return [...leftKeys].filter((key) => rightKeys.has(key)).length;
}

function semanticProfileOverlapScore(
  source: SemanticProfile,
  candidate: SemanticProfile,
): number {
  return (
    intersectionCount(
      source.topics.map((concept) => concept.key),
      candidate.topics.map((concept) => concept.key),
    ) *
      3 +
    intersectionCount(
      source.coreConcepts.map((concept) => concept.key),
      candidate.coreConcepts.map((concept) => concept.key),
    ) *
      5 +
    intersectionCount(
      source.applicationConceptKeys,
      candidate.prerequisiteConceptKeys,
    ) *
      2 +
    intersectionCount(
      source.prerequisiteConceptKeys,
      candidate.applicationConceptKeys,
    ) *
      2 +
    intersectionCount(
      source.counterpointConceptKeys,
      candidate.coreConcepts.map((concept) => concept.key),
    )
  );
}

function intersectionCount(
  left: readonly string[],
  right: readonly string[],
): number {
  const rightKeys = new Set(right);
  return new Set(left.filter((key) => rightKeys.has(key))).size;
}

function totalTokenUsage(
  observations: readonly SemanticProfileEvaluationObservation[],
  pricing: SemanticProfileEvaluationPricing,
) {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let missingUsageCount = 0;
  for (const observation of observations) {
    if (!isValidTokenUsage(observation.usage)) {
      missingUsageCount += 1;
      continue;
    }
    inputTokens += observation.usage.inputTokens;
    cachedInputTokens += observation.usage.cachedInputTokens;
    outputTokens += observation.usage.outputTokens;
    totalTokens += observation.usage.totalTokens;
  }
  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  const estimatedMicroUsd = Math.round(
    (uncachedInputTokens * pricing.inputMicroUsdPerMillionTokens +
      cachedInputTokens * pricing.cachedInputMicroUsdPerMillionTokens +
      outputTokens * pricing.outputMicroUsdPerMillionTokens) /
      1_000_000,
  );
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_micro_usd: estimatedMicroUsd,
    missing_usage_count: missingUsageCount,
  } as const;
}

function isValidTokenUsage(
  usage: SemanticProfileTokenUsage | undefined,
): usage is SemanticProfileTokenUsage {
  return (
    usage !== undefined &&
    [
      usage.inputTokens,
      usage.cachedInputTokens,
      usage.outputTokens,
      usage.totalTokens,
    ].every((value) => Number.isInteger(value) && value >= 0) &&
    usage.cachedInputTokens <= usage.inputTokens &&
    usage.totalTokens >= usage.inputTokens + usage.outputTokens
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
