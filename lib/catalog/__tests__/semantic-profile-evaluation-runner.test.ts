import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticProfile } from "../semantic-profile";
import { SEMANTIC_PROFILE_EVALUATION_CASES } from "../semantic-profile-evaluation";

const { requestSemanticProfileWithUsage } = vi.hoisted(() => ({
  requestSemanticProfileWithUsage: vi.fn(),
}));

vi.mock("../semantic-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../semantic-profile")>()),
  requestSemanticProfileWithUsage,
}));

import {
  runSemanticProfileEvaluation,
  verifySemanticProfileEvaluationFingerprint,
} from "../semantic-profile-evaluation-runner";

function profileFor(language: string, text: string): SemanticProfile {
  const falseNeighbor = text.includes("cake") || text.includes("bakery");
  return {
    schemaVersion: "semantic-profile-v1",
    sourceLanguage: language,
    topics: [
      falseNeighbor
        ? { key: "baking", label: "Baking" }
        : { key: "machine-learning", label: "Machine learning" },
    ],
    coreConcepts: falseNeighbor
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

describe("runSemanticProfileEvaluation", () => {
  beforeEach(() => {
    requestSemanticProfileWithUsage.mockReset();
    requestSemanticProfileWithUsage.mockImplementation(async (options) => ({
      content: JSON.stringify(
        profileFor(options.sourceLanguage, options.transcript),
      ),
      responseModel: "configured-gateway-model",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        totalTokens: 15,
      },
    }));
  });

  it("runs the fixed 56 calls and returns fingerprinted evidence without activating anything", async () => {
    const artifact = await runSemanticProfileEvaluation({
      modelIdentifier: "configured-gateway-model",
      gatewayProvider: "configured-backend-gateway",
      sourceRevision: "9b09883f41cb2ae3c6dfde192f227963c0bd54a1",
      evaluatedAt: new Date("2026-08-11T18:00:00.000Z"),
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(requestSemanticProfileWithUsage).toHaveBeenCalledTimes(56);
    expect(requestSemanticProfileWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "configured-gateway-model" }),
    );
    expect(artifact.observations).toHaveLength(56);
    expect(artifact.evaluationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySemanticProfileEvaluationFingerprint(artifact)).toBe(true);
    expect(artifact.automatedGate.outcome).toBe("passed");
    expect(artifact.activation).toEqual({
      performed: false,
      evaluationLedgerRecorded: false,
      humanApprovalRecorded: false,
      humanApprovalRequired: true,
    });
    expect(JSON.stringify(artifact)).not.toContain("rawResponse");
    expect(
      new Set(artifact.observations.map((observation) => observation.caseId)),
    ).toEqual(
      new Set(SEMANTIC_PROFILE_EVALUATION_CASES.map((entry) => entry.id)),
    );
  });

  it("fails closed when the Gateway resolves a call to a different model", async () => {
    requestSemanticProfileWithUsage.mockImplementationOnce(async (options) => ({
      content: JSON.stringify(
        profileFor(options.sourceLanguage, options.transcript),
      ),
      responseModel: "unexpected-model",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        totalTokens: 15,
      },
    }));

    const artifact = await runSemanticProfileEvaluation({
      modelIdentifier: "configured-gateway-model",
      gatewayProvider: "configured-backend-gateway",
      sourceRevision: "9b09883f41cb2ae3c6dfde192f227963c0bd54a1",
      evaluatedAt: new Date("2026-08-11T18:00:00.000Z"),
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(requestSemanticProfileWithUsage).toHaveBeenCalledTimes(56);
    expect(artifact.automatedGate).toEqual(
      expect.objectContaining({
        outcome: "failed",
        failedGates: expect.arrayContaining(["response_model_consistency"]),
      }),
    );
    expect(artifact.activation.performed).toBe(false);
  });

  it("fails closed when every Gateway call consistently resolves to the wrong model", async () => {
    requestSemanticProfileWithUsage.mockImplementation(async (options) => ({
      content: JSON.stringify(
        profileFor(options.sourceLanguage, options.transcript),
      ),
      responseModel: "unexpected-model",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        totalTokens: 15,
      },
    }));

    const artifact = await runSemanticProfileEvaluation({
      modelIdentifier: "configured-gateway-model",
      gatewayProvider: "configured-backend-gateway",
      sourceRevision: "9b09883f41cb2ae3c6dfde192f227963c0bd54a1",
      evaluatedAt: new Date("2026-08-11T18:00:00.000Z"),
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(requestSemanticProfileWithUsage).toHaveBeenCalledTimes(56);
    expect(artifact.metrics.response_models).toEqual(["unexpected-model"]);
    expect(artifact.automatedGate).toEqual(
      expect.objectContaining({
        outcome: "failed",
        failedGates: expect.arrayContaining(["response_model_consistency"]),
      }),
    );
    expect(artifact.activation.performed).toBe(false);
  });

  it("retains measured usage but not raw content when schema validation fails", async () => {
    requestSemanticProfileWithUsage.mockImplementationOnce(async () => ({
      content: "not valid profile JSON",
      responseModel: "configured-gateway-model",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 3,
        totalTokens: 13,
      },
    }));

    const artifact = await runSemanticProfileEvaluation({
      modelIdentifier: "configured-gateway-model",
      gatewayProvider: "configured-backend-gateway",
      sourceRevision: "9b09883f41cb2ae3c6dfde192f227963c0bd54a1",
      evaluatedAt: new Date("2026-08-11T18:00:00.000Z"),
      pricing: {
        inputMicroUsdPerMillionTokens: 1_000_000,
        cachedInputMicroUsdPerMillionTokens: 500_000,
        outputMicroUsdPerMillionTokens: 2_000_000,
      },
    });

    expect(artifact.observations[0]).toEqual(
      expect.objectContaining({
        errorCode: "schema_validation_error",
        responseModel: "configured-gateway-model",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 3,
          totalTokens: 13,
        },
      }),
    );
    expect(artifact.observations[0]).not.toHaveProperty("profile");
    expect(JSON.stringify(artifact)).not.toContain("not valid profile JSON");
    expect(artifact.metrics.token_cost_totals.missing_usage_count).toBe(0);
    expect(artifact.automatedGate.failedGates).toContain("schema_validity");
  });
});
