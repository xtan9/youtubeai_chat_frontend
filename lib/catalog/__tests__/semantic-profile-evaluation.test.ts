import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import {
  SEMANTIC_PROFILE_EVALUATION_CASES,
  SEMANTIC_PROFILE_EVALUATION_TRIALS,
  evaluateSemanticProfileEvidence,
} from "../semantic-profile-evaluation";
import type { SemanticProfile } from "../semantic-profile";

describe("Semantic Profile evaluation corpus", () => {
  it("fixes 56 Gateway calls across every supported language and continuation relationship", () => {
    expect(
      SEMANTIC_PROFILE_EVALUATION_CASES.length *
        SEMANTIC_PROFILE_EVALUATION_TRIALS,
    ).toBe(56);
    expect(
      new Set(
        SEMANTIC_PROFILE_EVALUATION_CASES.map(
          (benchmarkCase) => benchmarkCase.language,
        ),
      ),
    ).toEqual(new Set(SUPPORTED_LANGUAGE_CODES));
    expect(
      new Set(
        SEMANTIC_PROFILE_EVALUATION_CASES.flatMap((benchmarkCase) =>
          benchmarkCase.relationship ? [benchmarkCase.relationship] : [],
        ),
      ),
    ).toEqual(
      new Set([
        "deeper_explanation",
        "prerequisite",
        "practical_application",
        "credible_alternative",
      ]),
    );
    expect(
      SEMANTIC_PROFILE_EVALUATION_CASES.filter(
        (benchmarkCase) => benchmarkCase.falseNeighborFor,
      ),
    ).toHaveLength(2);
  });
});

function profileFor(
  benchmarkCase: (typeof SEMANTIC_PROFILE_EVALUATION_CASES)[number],
): SemanticProfile {
  const isFalseNeighbor = benchmarkCase.falseNeighborFor !== undefined;
  return {
    schemaVersion: "semantic-profile-v1",
    sourceLanguage: benchmarkCase.language,
    topics: [
      isFalseNeighbor
        ? { key: "baking", label: "Baking" }
        : { key: "machine-learning", label: "Machine learning" },
    ],
    coreConcepts: isFalseNeighbor
      ? [
          { key: "cake-decoration", label: "Cake decoration" },
          { key: "delivery-routes", label: "Delivery routes" },
        ]
      : [
          { key: "gradient-descent", label: "Gradient descent" },
          { key: "neural-networks", label: "Neural networks" },
        ],
    difficulty: "beginner",
    prerequisiteConceptKeys: [],
    applicationConceptKeys: [],
    counterpointConceptKeys: [],
  };
}

describe("evaluateSemanticProfileEvidence", () => {
  it("produces activation-ledger metrics from the complete fixed evaluation", () => {
    const evidence = evaluateSemanticProfileEvidence({
      observations: completeObservations(),
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(evidence.automatedGate).toEqual({
      outcome: "passed",
      failedGates: [],
    });
    expect(evidence.metrics).toMatchObject({
      schema_validity_rate: 1,
      multilingual_concept_normalization: 1,
      useful_neighbor_recall: 1,
      false_neighbor_rejection: 1,
      representative_source_coverage: 1,
      relationship_coverage: 1,
      repeat_consistency: 1,
      token_cost_totals: {
        input_tokens: 560,
        cached_input_tokens: 0,
        output_tokens: 280,
        total_tokens: 840,
        estimated_micro_usd: 1_120,
        missing_usage_count: 0,
      },
    });
    expect(evidence.metrics.latency_ms_p95).toBe(126);
    expect(evidence.requestCount).toBe(56);
  });

  it("fails closed when a Gateway observation has invalid usage", () => {
    const observations = completeObservations();
    observations[0] = {
      ...observations[0]!,
      usage: {
        inputTokens: -1,
        cachedInputTokens: 2,
        outputTokens: Number.NaN,
        totalTokens: 1,
      },
    };

    const evidence = evaluateSemanticProfileEvidence({
      observations,
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(evidence.automatedGate.failedGates).toContain("usage_completeness");
    expect(evidence.metrics.token_cost_totals.missing_usage_count).toBe(1);
    expect(evidence.metrics.token_cost_totals.estimated_micro_usd).toBeGreaterThanOrEqual(0);
  });

  it("scores candidates in the same source-to-candidate direction as Postgres", () => {
    const observations = completeObservations().map((observation) => {
      if (observation.caseId === "ml-source") {
        return {
          ...observation,
          profile: {
            ...observation.profile,
            counterpointConceptKeys: ["evolutionary-optimization"],
          },
        };
      }
      if (observation.caseId === "relationship-alternative") {
        return {
          ...observation,
          profile: {
            ...observation.profile,
            topics: [{ key: "optimization-methods", label: "Optimization methods" }],
            coreConcepts: [
              {
                key: "evolutionary-optimization",
                label: "Evolutionary optimization",
              },
              { key: "genetic-algorithms", label: "Genetic algorithms" },
            ],
          },
        };
      }
      return observation;
    });

    const evidence = evaluateSemanticProfileEvidence({
      observations,
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(evidence.metrics.relationship_coverage).toBe(1);
    expect(evidence.automatedGate.failedGates).not.toContain(
      "relationship_coverage",
    );
  });
});

function completeObservations() {
  return SEMANTIC_PROFILE_EVALUATION_CASES.flatMap(
    (benchmarkCase, caseIndex) =>
      Array.from(
        { length: SEMANTIC_PROFILE_EVALUATION_TRIALS },
        (_, trialIndex) => ({
          caseId: benchmarkCase.id,
          trial: trialIndex + 1,
          latencyMs: 100 + caseIndex,
          profile: profileFor(benchmarkCase),
          responseModel: "fixture-model",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            totalTokens: 15,
          },
        }),
      ),
  );
}
